use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::extractor::{VideoTrack, AudioTrack};
use crate::muxer::LosslessMuxerCommand;
use crate::sidecar::SidecarManager;
use crate::verifier::{verify_artifact, VerificationResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJobRequest {
    pub url: Option<String>,
    pub title: Option<String>,
    pub mode: String, // 'video' | 'audio'
    pub video_format_id: Option<String>,
    pub audio_format_id: String,
    pub target_container: String, // 'auto' | 'mkv' | 'webm' | 'mp4'
    pub output_directory: String,
    pub filename_template: String,
    pub expected_video: Option<VideoTrack>,
    pub expected_audio: Option<AudioTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub job_id: String,
    pub phase: String, // 'discovering' | 'downloading' | 'remuxing' | 'verifying' | 'completed' | 'failed'
    pub percent: f64,
    pub speed_bytes_per_sec: f64,
    pub eta_seconds: u64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct YtDlpProgressJson {
    status: Option<String>,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    total_bytes_estimate: Option<u64>,
    speed: Option<f64>,
    eta: Option<f64>,
}

/// Helper to sanitize filenames for OS compatibility
pub fn sanitize_filename(template: &str, title: &str, ext: &str) -> String {
    let clean_title: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();

    let formatted = template
        .replace("%(title)s", &clean_title)
        .replace("%(ext)s", ext);

    if formatted.ends_with(&format!(".{}", ext)) {
        formatted
    } else {
        format!("{}.{}", formatted, ext)
    }
}

/// Parses a line of stdout from yt-dlp using --progress-template "%(progress)j"
pub fn parse_progress_line(line: &str) -> Option<(f64, f64, u64, u64, u64)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(progress) = serde_json::from_str::<YtDlpProgressJson>(trimmed) {
        let downloaded = progress.downloaded_bytes.unwrap_or(0);
        let total = progress.total_bytes.or(progress.total_bytes_estimate).unwrap_or(0);
        let speed = progress.speed.unwrap_or(0.0);
        let eta = progress.eta.unwrap_or(0.0).max(0.0) as u64;

        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0).min(100.0)
        } else {
            0.0
        };

        return Some((percent, speed, eta, downloaded, total));
    }

    None
}

/// Spawns yt-dlp to download a specific format ID to an isolated temporary file,
/// streaming progress events line-by-line via Tauri IPC.
fn download_stream(
    yt_dlp_bin: &Path,
    url: &str,
    format_id: &str,
    output_path: &Path,
    job_id: &str,
    app: &tauri::AppHandle,
    percent_offset: f64,
    percent_scale: f64,
) -> Result<(), String> {
    let mut cmd = Command::new(yt_dlp_bin);
    cmd.args([
        "-f", format_id,
        "-o", output_path.to_str().unwrap(),
        "--newline",
        "--no-playlist",
        "--progress-template", "%(progress)j",
        url,
    ]);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp for format {}: {}", format_id, e))?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if let Some((raw_pct, speed, eta, downloaded, total)) = parse_progress_line(&line) {
                let scaled_pct = percent_offset + (raw_pct * percent_scale);
                let payload = DownloadProgressPayload {
                    job_id: job_id.to_string(),
                    phase: "downloading".to_string(),
                    percent: scaled_pct,
                    speed_bytes_per_sec: speed,
                    eta_seconds: eta,
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                };
                let _ = app.emit("download-progress", payload);
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed waiting on yt-dlp: {}", e))?;

    if !status.success() {
        return Err(format!("yt-dlp failed downloading format {}", format_id));
    }

    Ok(())
}

/// Main Download State Machine:
/// 1. Initializes isolated job working directory: <temp_dir>/pulsestream_<job_id>/
/// 2. Downloads source streams via yt-dlp (never storing raw URLs)
/// 3. Remuxes losslessly via LosslessMuxerCommand (-c copy)
/// 4. Executes Two-Tier Verification
/// 5. Lifecycle Cleanup: Deletes temp dir on success, preserves as _FAILED on failure.
#[tauri::command]
pub async fn start_download(
    app: tauri::AppHandle,
    request: DownloadJobRequest,
) -> Result<VerificationResult, String> {
    let url = request
        .url
        .as_deref()
        .ok_or_else(|| "URL is required in DownloadJobRequest".to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let job_id = format!("{}_{}", now, request.audio_format_id);

    // 1. ISOLATED WORKING DIRECTORY: <temp_dir>/pulsestream_<job_id>/
    let temp_base = std::env::temp_dir();
    let work_dir = temp_base.join(format!("pulsestream_{}", job_id));
    fs::create_dir_all(&work_dir)
        .map_err(|e| format!("Failed to create working directory {:?}: {}", work_dir, e))?;

    // Initial discovering progress
    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            job_id: job_id.clone(),
            phase: "discovering".to_string(),
            percent: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );

    let sidecars = SidecarManager::default_manager();
    let yt_dlp_bin = sidecars.resolve_yt_dlp();
    let ffmpeg_bin = sidecars.resolve_ffmpeg()?;

    let is_video_mode = request.mode == "video" && request.video_format_id.is_some();

    // Determine final container and output destination
    let final_container = if request.target_container == "auto" {
        if is_video_mode {
            let v_codec = request.expected_video.as_ref().map(|v| v.codec.as_str()).unwrap_or("h264");
            let a_codec = request.expected_audio.as_ref().map(|a| a.codec.as_str()).unwrap_or("aac");
            if v_codec == "h264" && a_codec == "aac" {
                "mp4"
            } else if (v_codec == "av1" || v_codec == "vp9") && a_codec == "opus" {
                "webm"
            } else {
                "mkv"
            }
        } else {
            let a_codec = request.expected_audio.as_ref().map(|a| a.codec.as_str()).unwrap_or("opus");
            if a_codec == "opus" { "webm" } else { "m4a" }
        }
    } else {
        request.target_container.as_str()
    };

    let title = request.title.as_deref().unwrap_or("PulseStream_Media");
    let out_filename = sanitize_filename(&request.filename_template, title, final_container);
    let output_dir = PathBuf::from(&request.output_directory);
    let _ = fs::create_dir_all(&output_dir);
    let final_output_path = output_dir.join(out_filename);

    // 2. DOWNLOAD SOURCE STREAMS
    let ffmpeg_command_executed: String = if is_video_mode {
        let video_fmt = request.video_format_id.as_ref().unwrap();
        let video_tmp = work_dir.join(format!("video_{}.tmp", video_fmt));
        let audio_tmp = work_dir.join(format!("audio_{}.tmp", request.audio_format_id));

        // Fetch video (0% to 50%)
        download_stream(
            &yt_dlp_bin,
            url,
            video_fmt,
            &video_tmp,
            &job_id,
            &app,
            0.0,
            0.5,
        )?;

        // Fetch audio (50% to 100%)
        download_stream(
            &yt_dlp_bin,
            url,
            &request.audio_format_id,
            &audio_tmp,
            &job_id,
            &app,
            50.0,
            0.5,
        )?;

        // 3. REMUXING PIPELINE
        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                job_id: job_id.clone(),
                phase: "remuxing".to_string(),
                percent: 100.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: 0,
                downloaded_bytes: 0,
                total_bytes: 0,
            },
        );

        let mux_cmd = LosslessMuxerCommand::builder()
            .video_input(&video_tmp)
            .audio_input(&audio_tmp)
            .output_path(&final_output_path)
            .build()?;

        let mut cmd = mux_cmd.to_command(&ffmpeg_bin);
        let executed = format!("ffmpeg {}", mux_cmd.to_args().join(" "));

        let status = cmd
            .status()
            .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

        if !status.success() {
            return Err("FFmpeg lossless remuxing process returned non-zero exit code".to_string());
        }

        executed
    } else {
        // Audio-only download
        let audio_tmp = work_dir.join(format!("audio_{}.tmp", request.audio_format_id));
        download_stream(
            &yt_dlp_bin,
            url,
            &request.audio_format_id,
            &audio_tmp,
            &job_id,
            &app,
            0.0,
            1.0,
        )?;

        // Remux or Direct Copy
        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                job_id: job_id.clone(),
                phase: "remuxing".to_string(),
                percent: 100.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: 0,
                downloaded_bytes: 0,
                total_bytes: 0,
            },
        );

        let source_container = request
            .expected_audio
            .as_ref()
            .map(|a| a.container.as_str())
            .unwrap_or("webm");

        if source_container == final_container {
            // Direct Stream Extraction (lossless zero-remux copy)
            fs::copy(&audio_tmp, &final_output_path)
                .map_err(|e| format!("Failed copying audio stream to destination: {}", e))?;
            String::new() // Direct copy without FFmpeg
        } else {
            // Lossless container change (e.g. into MKV)
            let mux_cmd = LosslessMuxerCommand::builder()
                .audio_input(&audio_tmp)
                .output_path(&final_output_path)
                .build()?;

            let mut cmd = mux_cmd.to_command(&ffmpeg_bin);
            let executed = format!("ffmpeg {}", mux_cmd.to_args().join(" "));

            let status = cmd
                .status()
                .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

            if !status.success() {
                return Err("FFmpeg lossless remuxing process returned non-zero exit code".to_string());
            }

            executed
        }
    };

    // 4. TWO-TIER VERIFICATION
    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            job_id: job_id.clone(),
            phase: "verifying".to_string(),
            percent: 100.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );

    let default_audio = AudioTrack {
        format_id: request.audio_format_id.clone(),
        language: "en".to_string(),
        language_label: "English".to_string(),
        role: "original".to_string(),
        codec: if final_container == "m4a" { "aac".to_string() } else { "opus".to_string() },
        container: final_container.to_string(),
        nominal_bitrate_kbps: 160.0,
        sample_rate_hz: 48000,
        is_default: true,
    };

    let expected_audio = request.expected_audio.as_ref().unwrap_or(&default_audio);

    let verification = verify_artifact(
        &final_output_path,
        request.expected_video.as_ref(),
        expected_audio,
        &ffmpeg_command_executed,
    );

    // 5. LIFECYCLE CLEANUP
    if verification.status == "verified" {
        // Success: safely remove isolated temporary working directory
        let _ = fs::remove_dir_all(&work_dir);

        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                job_id: job_id.clone(),
                phase: "completed".to_string(),
                percent: 100.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: 0,
                downloaded_bytes: 0,
                total_bytes: 0,
            },
        );

        Ok(verification)
    } else {
        // Failure: preserve intermediate files for inspection at <temp_dir>/pulsestream_<job_id>_FAILED
        let failed_dir = temp_base.join(format!("pulsestream_{}_FAILED", job_id));
        let _ = fs::rename(&work_dir, &failed_dir);

        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                job_id: job_id.clone(),
                phase: "failed".to_string(),
                percent: 100.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: 0,
                downloaded_bytes: 0,
                total_bytes: 0,
            },
        );

        Err(format!(
            "Verification Failed. Discrepancy details:\n{}\nIntermediate stream fragments preserved at: {:?}",
            verification.details, failed_dir
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        let title = "Never Gonna Give You Up: Official / Video *4K*";
        let filename = sanitize_filename("%(title)s [%(ext)s]", title, "webm");
        assert_eq!(filename, "Never Gonna Give You Up_ Official _ Video _4K_ [webm].webm");
    }

    #[test]
    fn test_parse_progress_line() {
        let json_line = r#"{"status":"downloading","downloaded_bytes":1048576,"total_bytes":10485760,"speed":524288.0,"eta":18.0}"#;
        let res = parse_progress_line(json_line);
        assert!(res.is_some());
        let (pct, speed, eta, dl, total) = res.unwrap();
        assert_eq!(pct, 10.0);
        assert_eq!(speed, 524288.0);
        assert_eq!(eta, 18);
        assert_eq!(dl, 1048576);
        assert_eq!(total, 10485760);
    }
}
