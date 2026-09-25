use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as TokioBufReader};
use tokio::process::Command as TokioCommand;

use crate::extractor::{AudioTrack, VideoTrack};
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
    pub audio_format_id: Option<String>,
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
    pub stream: String, // 'video' | 'audio' | 'overall'
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

struct DownloadProgressContext<'a> {
    job_id: &'a str,
    app: &'a tauri::AppHandle,
    percent_offset: f64,
    percent_scale: f64,
    stream_type: &'a str,
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
        let total = progress
            .total_bytes
            .or(progress.total_bytes_estimate)
            .unwrap_or(0);
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
async fn download_http_stream(
    client: &reqwest::Client,
    url: &str,
    output_path: &Path,
    progress: &DownloadProgressContext<'_>,
) -> Result<(), String> {
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Network error connecting to stream: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Stream download failed with HTTP {}",
            resp.status()
        ));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(output_path).await.map_err(|e| {
        format!(
            "Failed to create temporary output file {:?}: {}",
            output_path, e
        )
    })?;

    let mut downloaded_bytes: u64 = 0;
    let start_time = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Stream read error: {}", e))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed writing chunk to disk: {}", e))?;

        downloaded_bytes += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 200 || downloaded_bytes == total_bytes {
            last_emit = std::time::Instant::now();
            let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
            let speed = downloaded_bytes as f64 / elapsed;
            let raw_pct = if total_bytes > 0 {
                (downloaded_bytes as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };
            let eta = if speed > 0.0 && total_bytes > downloaded_bytes {
                ((total_bytes - downloaded_bytes) as f64 / speed) as u64
            } else {
                0
            };

            let scaled_pct = progress.percent_offset + (raw_pct * progress.percent_scale);
            let payload = DownloadProgressPayload {
                job_id: progress.job_id.to_string(),
                phase: "downloading".to_string(),
                stream: progress.stream_type.to_string(),
                percent: scaled_pct.min(100.0),
                speed_bytes_per_sec: speed,
                eta_seconds: eta,
                downloaded_bytes,
                total_bytes,
            };
            let _ = progress.app.emit("download-progress", payload);
        }
    }

    Ok(())
}

async fn download_stream(
    yt_dlp_bin: &Path,
    url: &str,
    format_id: &str,
    output_path: &Path,
    progress: &DownloadProgressContext<'_>,
) -> Result<(), String> {
    let mut cmd = TokioCommand::new(yt_dlp_bin);
    cmd.args([
        "-f",
        format_id,
        "-o",
        output_path.to_str().unwrap(),
        "--newline",
        "--no-playlist",
        "--progress-template",
        "%(progress)j",
        url,
    ]);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp for format {}: {}", format_id, e))?;

    if let Some(stdout) = child.stdout.take() {
        let mut reader = TokioBufReader::new(stdout).lines();
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| format!("Failed reading yt-dlp progress: {}", e))?
        {
            if let Some((raw_pct, speed, eta, downloaded, total)) = parse_progress_line(&line) {
                let scaled_pct = progress.percent_offset + (raw_pct * progress.percent_scale);
                let payload = DownloadProgressPayload {
                    job_id: progress.job_id.to_string(),
                    phase: "downloading".to_string(),
                    stream: progress.stream_type.to_string(),
                    percent: scaled_pct,
                    speed_bytes_per_sec: speed,
                    eta_seconds: eta,
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                };
                let _ = progress.app.emit("download-progress", payload);
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed waiting on yt-dlp: {}", e))?;

    if !status.success() {
        return Err(format!("yt-dlp failed downloading format {}", format_id));
    }

    Ok(())
}

async fn download_stream_flexible(
    client: &reqwest::Client,
    yt_dlp_bin: &Path,
    url: &str,
    format_id: &str,
    direct_url: Option<&str>,
    output_path: &Path,
    progress: &DownloadProgressContext<'_>,
) -> Result<(), String> {
    if let Some(durl) = direct_url {
        if !durl.is_empty() {
            return download_http_stream(client, durl, output_path, progress).await;
        }
    }

    if yt_dlp_bin.is_file() {
        return download_stream(yt_dlp_bin, url, format_id, output_path, progress).await;
    }

    Err(
        "No direct stream URL available and yt-dlp binary is not installed on this device."
            .to_string(),
    )
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

    let audio_id_str = request.audio_format_id.as_deref().unwrap_or("mute");
    let job_id = format!("{}_{}", now, audio_id_str);

    // 1. ISOLATED WORKING DIRECTORY: <temp_dir>/pulsestream_<job_id>/
    let temp_base = std::env::temp_dir();
    let work_dir = temp_base.join(format!("pulsestream_{}", job_id));
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|e| format!("Failed to create working directory {:?}: {}", work_dir, e))?;

    // Initial discovering progress
    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            job_id: job_id.clone(),
            phase: "discovering".to_string(),
            stream: "overall".to_string(),
            percent: 0.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );

    let sidecars = SidecarManager::default_manager();
    let yt_dlp_bin = sidecars.resolve_yt_dlp();
    let ffmpeg_bin = sidecars.resolve_ffmpeg().ok();
    let http_client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let is_video_mode = request.mode == "video" && request.video_format_id.is_some();

    // Determine final container and output destination
    let final_container = if request.target_container == "auto" {
        if is_video_mode {
            let v_codec = request
                .expected_video
                .as_ref()
                .map(|v| v.codec.as_str())
                .unwrap_or("h264");
            let a_codec = request
                .expected_audio
                .as_ref()
                .map(|a| a.codec.as_str())
                .unwrap_or("aac");
            if request.audio_format_id.is_none() {
                // Video only
                request
                    .expected_video
                    .as_ref()
                    .map(|v| v.container.as_str())
                    .unwrap_or("mp4")
            } else if v_codec == "h264" && a_codec == "aac" {
                "mp4"
            } else if (v_codec == "av1" || v_codec == "vp9") && a_codec == "opus" {
                "webm"
            } else {
                "mkv"
            }
        } else {
            let a_codec = request
                .expected_audio
                .as_ref()
                .map(|a| a.codec.as_str())
                .unwrap_or("opus");
            if a_codec == "opus" {
                "webm"
            } else {
                "m4a"
            }
        }
    } else {
        request.target_container.as_str()
    };

    let title = request.title.as_deref().unwrap_or("PulseStream_Media");
    let out_filename = sanitize_filename(&request.filename_template, title, final_container);
    let output_dir = PathBuf::from(&request.output_directory);
    let _ = tokio::fs::create_dir_all(&output_dir).await;
    let final_output_path = output_dir.join(out_filename);

    let mut video_direct_url = request
        .expected_video
        .as_ref()
        .and_then(|v| v.direct_url.clone());
    let mut audio_direct_url = request
        .expected_audio
        .as_ref()
        .and_then(|a| a.direct_url.clone());

    // If direct URLs are missing or yt-dlp is not present, resolve fresh direct URLs using native extractor
    if !yt_dlp_bin.is_file()
        || (is_video_mode && video_direct_url.is_none())
        || (request.audio_format_id.is_some() && audio_direct_url.is_none())
    {
        if let Some(vid) = crate::extractor::extract_video_id(url) {
            if let Ok(manifest) = crate::extractor::extract_manifest_native(&vid).await {
                if video_direct_url.is_none() {
                    if let Some(ref vfmt) = request.video_format_id {
                        video_direct_url = manifest
                            .video_tracks
                            .iter()
                            .find(|t| &t.format_id == vfmt)
                            .and_then(|t| t.direct_url.clone())
                            .or_else(|| {
                                manifest
                                    .video_tracks
                                    .first()
                                    .and_then(|t| t.direct_url.clone())
                            });
                    } else {
                        video_direct_url = manifest
                            .video_tracks
                            .first()
                            .and_then(|t| t.direct_url.clone());
                    }
                }
                if audio_direct_url.is_none() {
                    if let Some(ref afmt) = request.audio_format_id {
                        audio_direct_url = manifest
                            .audio_tracks
                            .iter()
                            .find(|t| &t.format_id == afmt)
                            .and_then(|t| t.direct_url.clone())
                            .or_else(|| {
                                manifest
                                    .audio_tracks
                                    .first()
                                    .and_then(|t| t.direct_url.clone())
                            });
                    } else {
                        audio_direct_url = manifest
                            .audio_tracks
                            .first()
                            .and_then(|t| t.direct_url.clone());
                    }
                }
            }
        }
    }

    // 2. DOWNLOAD SOURCE STREAMS
    let ffmpeg_command_executed: String = if is_video_mode {
        let video_fmt = request.video_format_id.as_ref().unwrap();
        let video_tmp = work_dir.join(format!("video_{}.tmp", video_fmt));

        if let Some(ref audio_fmt) = request.audio_format_id {
            let audio_tmp = work_dir.join(format!("audio_{}.tmp", audio_fmt));

            // Fetch video (0% to 50%)
            let progress = DownloadProgressContext {
                job_id: &job_id,
                app: &app,
                percent_offset: 0.0,
                percent_scale: 0.5,
                stream_type: "video",
            };
            download_stream_flexible(
                &http_client,
                &yt_dlp_bin,
                url,
                video_fmt,
                video_direct_url.as_deref(),
                &video_tmp,
                &progress,
            )
            .await?;

            // Fetch audio (50% to 100%)
            let progress = DownloadProgressContext {
                job_id: &job_id,
                app: &app,
                percent_offset: 50.0,
                percent_scale: 0.5,
                stream_type: "audio",
            };
            download_stream_flexible(
                &http_client,
                &yt_dlp_bin,
                url,
                audio_fmt,
                audio_direct_url.as_deref(),
                &audio_tmp,
                &progress,
            )
            .await?;

            // 3. REMUXING PIPELINE
            let _ = app.emit(
                "download-progress",
                DownloadProgressPayload {
                    job_id: job_id.clone(),
                    phase: "remuxing".to_string(),
                    stream: "overall".to_string(),
                    percent: 100.0,
                    speed_bytes_per_sec: 0.0,
                    eta_seconds: 0,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                },
            );

            if let Some(ref ff) = ffmpeg_bin {
                let mux_cmd = LosslessMuxerCommand::builder()
                    .video_input(&video_tmp)
                    .audio_input(&audio_tmp)
                    .output_path(&final_output_path)
                    .build()?;

                let args = mux_cmd.to_args();
                let mut cmd = TokioCommand::new(ff);
                cmd.args(&args);
                let executed = format!("ffmpeg {}", args.join(" "));

                let status = cmd
                    .status()
                    .await
                    .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

                if !status.success() {
                    return Err(
                        "FFmpeg lossless remuxing process returned non-zero exit code".to_string(),
                    );
                }

                executed
            } else {
                // Standalone / mobile mode without FFmpeg: save primary video stream directly
                tokio::fs::copy(&video_tmp, &final_output_path)
                    .await
                    .map_err(|e| format!("Failed copying video stream to destination: {}", e))?;
                "direct_stream_copy".to_string()
            }
        } else {
            // Video Only (No Audio / Muted)
            let progress = DownloadProgressContext {
                job_id: &job_id,
                app: &app,
                percent_offset: 0.0,
                percent_scale: 1.0,
                stream_type: "video",
            };
            download_stream_flexible(
                &http_client,
                &yt_dlp_bin,
                url,
                video_fmt,
                video_direct_url.as_deref(),
                &video_tmp,
                &progress,
            )
            .await?;

            let _ = app.emit(
                "download-progress",
                DownloadProgressPayload {
                    job_id: job_id.clone(),
                    phase: "remuxing".to_string(),
                    stream: "overall".to_string(),
                    percent: 100.0,
                    speed_bytes_per_sec: 0.0,
                    eta_seconds: 0,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                },
            );

            let source_container = request
                .expected_video
                .as_ref()
                .map(|v| v.container.as_str())
                .unwrap_or("webm");

            if source_container == final_container {
                // Direct stream copy
                tokio::fs::copy(&video_tmp, &final_output_path)
                    .await
                    .map_err(|e| format!("Failed copying video stream to destination: {}", e))?;
                String::new()
            } else if let Some(ff) = ffmpeg_bin.as_ref() {
                // Lossless remux video into target container
                let mux_cmd = LosslessMuxerCommand::builder()
                    .video_input(&video_tmp)
                    .output_path(&final_output_path)
                    .build()?;

                let args = mux_cmd.to_args();
                let mut cmd = TokioCommand::new(ff);
                cmd.args(&args);
                let executed = format!("ffmpeg {}", args.join(" "));

                let status = cmd
                    .status()
                    .await
                    .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

                if !status.success() {
                    return Err(
                        "FFmpeg lossless remuxing process returned non-zero exit code".to_string(),
                    );
                }

                executed
            } else {
                // Preserve original fallback: copy when FFmpeg is unavailable.
                tokio::fs::copy(&video_tmp, &final_output_path)
                    .await
                    .map_err(|e| format!("Failed copying video stream to destination: {}", e))?;
                String::new()
            }
        }
    } else {
        // Audio-only download
        let audio_fmt = request
            .audio_format_id
            .as_deref()
            .ok_or_else(|| "Audio format ID is required for audio mode".to_string())?;

        let audio_tmp = work_dir.join(format!("audio_{}.tmp", audio_fmt));
        let progress = DownloadProgressContext {
            job_id: &job_id,
            app: &app,
            percent_offset: 0.0,
            percent_scale: 1.0,
            stream_type: "audio",
        };
        download_stream_flexible(
            &http_client,
            &yt_dlp_bin,
            url,
            audio_fmt,
            audio_direct_url.as_deref(),
            &audio_tmp,
            &progress,
        )
        .await?;

        // Remux or Direct Copy
        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                job_id: job_id.clone(),
                phase: "remuxing".to_string(),
                stream: "overall".to_string(),
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
            tokio::fs::copy(&audio_tmp, &final_output_path)
                .await
                .map_err(|e| format!("Failed copying audio stream to destination: {}", e))?;
            String::new() // Direct copy without FFmpeg
        } else if let Some(ff) = ffmpeg_bin.as_ref() {
            let mux_cmd = LosslessMuxerCommand::builder()
                .audio_input(&audio_tmp)
                .output_path(&final_output_path)
                .build()?;

            let mut cmd = mux_cmd.to_command(ff);
            let executed = format!("ffmpeg {}", mux_cmd.to_args().join(" "));

            let status = cmd
                .status()
                .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

            if !status.success() {
                return Err(
                    "FFmpeg lossless remuxing process returned non-zero exit code".to_string(),
                );
            }

            executed
        } else {
            // Preserve original fallback: copy when FFmpeg is unavailable.
            tokio::fs::copy(&audio_tmp, &final_output_path)
                .await
                .map_err(|e| format!("Failed copying audio stream to destination: {}", e))?;
            String::new()
        }
    };

    // 4. TWO-TIER VERIFICATION
    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            job_id: job_id.clone(),
            phase: "verifying".to_string(),
            stream: "overall".to_string(),
            percent: 100.0,
            speed_bytes_per_sec: 0.0,
            eta_seconds: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );

    let default_audio = request.audio_format_id.as_ref().map(|fid| AudioTrack {
        format_id: fid.clone(),
        language: "en".to_string(),
        language_label: "English".to_string(),
        role: "original".to_string(),
        codec: if final_container == "m4a" {
            "aac".to_string()
        } else {
            "opus".to_string()
        },
        container: final_container.to_string(),
        nominal_bitrate_kbps: Some(160.0),
        sample_rate_hz: Some(48000),
        channels: Some(2),
        is_default: true,
        direct_url: None,
    });

    let expected_video = request.expected_video.clone();
    let expected_audio = request.expected_audio.clone().or(default_audio);

    let verification = tokio::task::spawn_blocking({
        let output_file = final_output_path.clone();
        let ffmpeg_command_executed = ffmpeg_command_executed.clone();
        move || {
            verify_artifact(
                &output_file,
                expected_video.as_ref(),
                expected_audio.as_ref(),
                &ffmpeg_command_executed,
            )
        }
    })
    .await
    .map_err(|e| format!("Verification task failed: {}", e))?;

    // 5. LIFECYCLE CLEANUP
    if verification.status == "verified" {
        // Success: safely remove isolated temporary working directory
        let _ = tokio::fs::remove_dir_all(&work_dir).await;

        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                job_id: job_id.clone(),
                phase: "completed".to_string(),
                stream: "overall".to_string(),
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
        let _ = tokio::fs::rename(&work_dir, &failed_dir).await;

        let _ = app.emit(
            "download-progress",
            DownloadProgressPayload {
                job_id: job_id.clone(),
                phase: "failed".to_string(),
                stream: "overall".to_string(),
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

/// Tauri command to return the OS-specific default download directory.
#[tauri::command]
pub fn get_default_download_directory() -> String {
    #[cfg(target_os = "android")]
    {
        let std_download = PathBuf::from("/storage/emulated/0/Download");
        if std_download.is_dir() || fs::create_dir_all(&std_download).is_ok() {
            return std_download.to_string_lossy().to_string();
        }
        let fallback = PathBuf::from("/sdcard/Download");
        if fallback.is_dir() || fs::create_dir_all(&fallback).is_ok() {
            return fallback.to_string_lossy().to_string();
        }
    }

    if let Some(down) = dirs::download_dir() {
        let p = down.join("PulseStream");
        let _ = fs::create_dir_all(&p);
        return p.to_string_lossy().to_string();
    }

    if let Some(home) = dirs::home_dir() {
        let p = home.join("Downloads").join("PulseStream");
        let _ = fs::create_dir_all(&p);
        return p.to_string_lossy().to_string();
    }

    "./downloads".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        let title = "Never Gonna Give You Up: Official / Video *4K*";
        let filename = sanitize_filename("%(title)s [%(ext)s]", title, "webm");
        assert_eq!(
            filename,
            "Never Gonna Give You Up_ Official _ Video _4K_ [webm].webm"
        );
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

    #[test]
    fn test_download_job_request_nullable_audio_format() {
        let json_with_null = r#"{
            "url": "https://www.youtube.com/watch?v=example",
            "title": "Test Video",
            "mode": "video",
            "videoFormatId": "137",
            "audioFormatId": null,
            "targetContainer": "auto",
            "outputDirectory": "/tmp",
            "filenameTemplate": "%(title)s.%(ext)s"
        }"#;

        let parsed: DownloadJobRequest = serde_json::from_str(json_with_null).unwrap();
        assert_eq!(parsed.mode, "video");
        assert_eq!(parsed.video_format_id.as_deref(), Some("137"));
        assert!(parsed.audio_format_id.is_none());
    }

    #[test]
    fn test_download_progress_payload_stream_field() {
        let payload = DownloadProgressPayload {
            job_id: "test_job".to_string(),
            phase: "downloading".to_string(),
            stream: "video".to_string(),
            percent: 50.0,
            speed_bytes_per_sec: 1048576.0,
            eta_seconds: 5,
            downloaded_bytes: 5242880,
            total_bytes: 10485760,
        };

        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains(r#""stream":"video""#));
        assert!(json.contains(r#""jobId":"test_job""#));

        let deserialized: DownloadProgressPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.stream, "video");
    }

    #[tokio::test]
    async fn test_live_stream_chunk_download() {
        let manifest = crate::extractor::extract_manifest_native("6x5xtNhOts0")
            .await
            .unwrap();
        let audio_track = manifest.audio_tracks.first().expect("audio track exists");
        let direct_url = audio_track.direct_url.as_ref().expect("direct URL exists");

        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15")
            .build()
            .unwrap();

        let resp = client
            .get(direct_url)
            .header("Range", "bytes=0-32767")
            .send()
            .await
            .expect("stream response");

        assert!(
            resp.status().is_success(),
            "stream HTTP status should be success (200 or 206)"
        );
        let bytes = resp.bytes().await.expect("read chunk bytes");
        assert_eq!(bytes.len(), 32768, "should have downloaded 32KB chunk");
        println!("Successfully downloaded 32KB real audio stream chunk from Google Video CDN!");
    }
}
