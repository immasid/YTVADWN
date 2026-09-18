use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader as TokioBufReader};
use tokio::process::Command as TokioCommand;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;
use tauri::{AppHandle, Emitter};

use crate::downloader::{DownloadJobRequest, DownloadProgressPayload, sanitize_filename};
use crate::extractor::AudioTrack;
use crate::muxer::LosslessMuxerCommand;
use crate::sidecar::SidecarManager;
use crate::verifier::{verify_artifact, VerificationResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Active,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSettings {
    pub cookie_mode: String, // "none" | "file" | "browser"
    pub cookie_file_path: Option<String>,
    pub browser_name: Option<String>,
    pub enable_po_token: bool,
    pub po_token_value: Option<String>,
    pub custom_extractor_args: Option<String>,
}

impl Default for SessionSettings {
    fn default() -> Self {
        Self {
            cookie_mode: "none".to_string(),
            cookie_file_path: None,
            browser_name: None,
            enable_po_token: false,
            po_token_value: None,
            custom_extractor_args: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueJob {
    pub id: String,
    pub request: DownloadJobRequest,
    pub status: JobStatus,
    pub progress: DownloadProgressPayload,
    pub verification: Option<VerificationResult>,
    pub error_message: Option<String>,
    pub output_path: Option<String>,
    pub created_at: u64,
}

pub struct InternalJob {
    pub job: QueueJob,
    pub cancellation_token: CancellationToken,
}

pub struct QueueManager {
    jobs: Arc<Mutex<Vec<InternalJob>>>,
    max_concurrent: usize,
    is_paused: Arc<Mutex<bool>>,
    settings: Arc<Mutex<SessionSettings>>,
    notify: Arc<Notify>,
}

impl QueueManager {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(Vec::new())),
            max_concurrent,
            is_paused: Arc::new(Mutex::new(false)),
            settings: Arc::new(Mutex::new(SessionSettings::default())),
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn start_scheduler(&self, app: AppHandle) {
        let jobs_arc = Arc::clone(&self.jobs);
        let paused_arc = Arc::clone(&self.is_paused);
        let settings_arc = Arc::clone(&self.settings);
        let notify_arc = Arc::clone(&self.notify);
        let max_concurrent = self.max_concurrent;

        tauri::async_runtime::spawn(async move {
            loop {
                let is_paused = *paused_arc.lock().await;

                if !is_paused {
                    let mut jobs = jobs_arc.lock().await;
                    let active_count = jobs.iter().filter(|j| j.job.status == JobStatus::Active).count();

                    if active_count < max_concurrent {
                        if let Some(queued_idx) = jobs.iter().position(|j| j.job.status == JobStatus::Queued) {
                            jobs[queued_idx].job.status = JobStatus::Active;
                            let job_clone = jobs[queued_idx].job.clone();
                            let token_clone = jobs[queued_idx].cancellation_token.clone();
                            let app_clone = app.clone();
                            let jobs_inner = Arc::clone(&jobs_arc);
                            let notify_inner = Arc::clone(&notify_arc);
                            let settings_clone = settings_arc.lock().await.clone();

                            drop(jobs); // Release lock before spawning
                            let _ = app.emit("queue-updated", ());

                            tauri::async_runtime::spawn(async move {
                                let job_id = job_clone.id.clone();
                                let res = execute_job(&app_clone, &job_clone, &token_clone, &settings_clone).await;

                                let mut jobs = jobs_inner.lock().await;
                                if let Some(j) = jobs.iter_mut().find(|j| j.job.id == job_id) {
                                    // If already marked as cancelled, don't overwrite with failed
                                    if j.job.status != JobStatus::Cancelled {
                                        match res {
                                            Ok((verification, out_path)) => {
                                                j.job.status = JobStatus::Completed;
                                                j.job.verification = Some(verification);
                                                j.job.output_path = Some(out_path);
                                                j.job.progress.phase = "completed".to_string();
                                                j.job.progress.percent = 100.0;
                                            }
                                            Err(e) => {
                                                if e == "Cancelled" || token_clone.is_cancelled() {
                                                    j.job.status = JobStatus::Cancelled;
                                                } else {
                                                    j.job.status = JobStatus::Failed;
                                                    j.job.error_message = Some(e);
                                                }
                                            }
                                        }
                                    }
                                }
                                drop(jobs);

                                let _ = app_clone.emit("queue-updated", ());
                                notify_inner.notify_one();
                            });

                            continue; // Check for more slots immediately
                        }
                    }
                }

                // Wait for state change or new job
                notify_arc.notified().await;
            }
        });
    }

    pub async fn enqueue(&self, app: &AppHandle, request: DownloadJobRequest) -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();

        let audio_id_str = request.audio_format_id.as_deref().unwrap_or("mute");
        let id = format!("{}_{}", now, audio_id_str);

        let queue_job = QueueJob {
            id: id.clone(),
            request,
            status: JobStatus::Queued,
            progress: DownloadProgressPayload {
                job_id: id.clone(),
                phase: "discovering".to_string(),
                stream: "overall".to_string(),
                percent: 0.0,
                speed_bytes_per_sec: 0.0,
                eta_seconds: 0,
                downloaded_bytes: 0,
                total_bytes: 0,
            },
            verification: None,
            error_message: None,
            output_path: None,
            created_at: now as u64,
        };

        let internal = InternalJob {
            job: queue_job,
            cancellation_token: CancellationToken::new(),
        };

        {
            let mut jobs = self.jobs.lock().await;
            jobs.push(internal);
        }

        let _ = app.emit("queue-updated", ());
        self.notify.notify_one();

        id
    }

    pub async fn cancel(&self, app: &AppHandle, job_id: &str) -> Result<(), String> {
        let mut jobs = self.jobs.lock().await;
        if let Some(j) = jobs.iter_mut().find(|j| j.job.id == job_id) {
            j.cancellation_token.cancel();
            j.job.status = JobStatus::Cancelled;
            j.job.progress.phase = "failed".to_string();

            // Purge temporary directory immediately if it exists
            let temp_base = std::env::temp_dir();
            let work_dir = temp_base.join(format!("pulsestream_{}", job_id));
            let _ = fs::remove_dir_all(&work_dir);

            let _ = app.emit("job-cancelled", serde_json::json!({ "jobId": job_id }));
            let _ = app.emit("queue-updated", ());
            drop(jobs);

            self.notify.notify_one();
            Ok(())
        } else {
            Err(format!("Job {} not found", job_id))
        }
    }

    pub async fn pause(&self, app: &AppHandle) {
        let mut p = self.is_paused.lock().await;
        *p = true;
        let _ = app.emit("queue-updated", ());
    }

    pub async fn resume(&self, app: &AppHandle) {
        let mut p = self.is_paused.lock().await;
        *p = false;
        let _ = app.emit("queue-updated", ());
        self.notify.notify_one();
    }

    pub async fn get_items(&self) -> Vec<QueueJob> {
        let jobs = self.jobs.lock().await;
        jobs.iter().map(|j| j.job.clone()).collect()
    }

    pub async fn clear_completed(&self, app: &AppHandle) {
        let mut jobs = self.jobs.lock().await;
        jobs.retain(|j| {
            j.job.status != JobStatus::Completed
                && j.job.status != JobStatus::Failed
                && j.job.status != JobStatus::Cancelled
        });
        let _ = app.emit("queue-updated", ());
    }

    pub async fn get_settings(&self) -> SessionSettings {
        self.settings.lock().await.clone()
    }

    pub async fn update_settings(&self, settings: SessionSettings) {
        let mut s = self.settings.lock().await;
        *s = settings;
    }
}

/// Spawns yt-dlp to download a specific format ID with async line streaming,
/// instant cancellation support, and fragment resume via `--continue`.
async fn download_stream_async(
    yt_dlp_bin: &Path,
    url: &str,
    format_id: &str,
    output_path: &Path,
    job_id: &str,
    app: &AppHandle,
    token: &CancellationToken,
    percent_offset: f64,
    percent_scale: f64,
    stream_type: &str,
    settings: &SessionSettings,
) -> Result<(), String> {
    let mut cmd = TokioCommand::new(yt_dlp_bin);
    cmd.args([
        "-f", format_id,
        "-o", output_path.to_str().unwrap(),
        "--newline",
        "--continue", // Fragment resume support!
        "--no-playlist",
        "--progress-template", "%(progress)j",
    ]);

    // Apply Ephemeral Cookie & PO-Token settings
    if settings.cookie_mode == "file" {
        if let Some(ref path) = settings.cookie_file_path {
            cmd.arg("--cookies").arg(path);
        }
    } else if settings.cookie_mode == "browser" {
        if let Some(ref browser) = settings.browser_name {
            cmd.arg("--cookies-from-browser").arg(browser);
        }
    }

    if settings.enable_po_token {
        if let Some(ref po) = settings.po_token_value {
            cmd.arg("--extractor-args").arg(format!("youtube:po_token={}", po));
        }
    }

    if let Some(ref custom_args) = settings.custom_extractor_args {
        if !custom_args.trim().is_empty() {
            cmd.args(custom_args.split_whitespace());
        }
    }

    cmd.arg(url);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture stdout".to_string())?;
    let mut reader = TokioBufReader::new(stdout).lines();

    loop {
        tokio::select! {
            _ = token.cancelled() => {
                let _ = child.kill().await;
                return Err("Cancelled".to_string());
            }
            line_res = reader.next_line() => {
                match line_res {
                    Ok(Some(line)) => {
                        if let Some((raw_pct, speed, eta, downloaded, total)) = crate::downloader::parse_progress_line(&line) {
                            let scaled_pct = percent_offset + (raw_pct * percent_scale);
                            let payload = DownloadProgressPayload {
                                job_id: job_id.to_string(),
                                phase: "downloading".to_string(),
                                stream: stream_type.to_string(),
                                percent: scaled_pct,
                                speed_bytes_per_sec: speed,
                                eta_seconds: eta,
                                downloaded_bytes: downloaded,
                                total_bytes: total,
                            };
                            let _ = app.emit("download-progress", payload);
                        }
                    }
                    Ok(None) => break, // EOF
                    Err(_) => break,
                }
            }
        }
    }

    tokio::select! {
        _ = token.cancelled() => {
            let _ = child.kill().await;
            return Err("Cancelled".to_string());
        }
        status = child.wait() => {
            let status = status.map_err(|e| format!("Failed waiting on yt-dlp: {}", e))?;
            if !status.success() {
                return Err(format!("yt-dlp failed downloading format {}", format_id));
            }
        }
    }

    Ok(())
}

/// Executes an active job within an isolated directory with cancellation and verification
async fn execute_job(
    app: &AppHandle,
    job: &QueueJob,
    token: &CancellationToken,
    settings: &SessionSettings,
) -> Result<(VerificationResult, String), String> {
    let request = &job.request;
    let url = request
        .url
        .as_deref()
        .ok_or_else(|| "URL is required in DownloadJobRequest".to_string())?;

    let job_id = &job.id;

    // 1. ISOLATED WORKING DIRECTORY: <temp_dir>/pulsestream_<job_id>/
    let temp_base = std::env::temp_dir();
    let work_dir = temp_base.join(format!("pulsestream_{}", job_id));
    fs::create_dir_all(&work_dir)
        .map_err(|e| format!("Failed to create working directory {:?}: {}", work_dir, e))?;

    let sidecars = SidecarManager::default_manager();
    let yt_dlp_bin = sidecars.resolve_yt_dlp();
    let ffmpeg_bin = sidecars.resolve_ffmpeg()?;

    let is_video_mode = request.mode == "video" && request.video_format_id.is_some();

    // Determine final container and output destination
    let final_container = if request.target_container == "auto" {
        if is_video_mode {
            let v_codec = request.expected_video.as_ref().map(|v| v.codec.as_str()).unwrap_or("h264");
            let a_codec = request.expected_audio.as_ref().map(|a| a.codec.as_str()).unwrap_or("aac");
            if request.audio_format_id.is_none() {
                request.expected_video.as_ref().map(|v| v.container.as_str()).unwrap_or("mp4")
            } else if v_codec == "h264" && a_codec == "aac" {
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
    let final_output_path = output_dir.join(&out_filename);

    if token.is_cancelled() {
        let _ = fs::remove_dir_all(&work_dir);
        return Err("Cancelled".to_string());
    }

    // 2. DOWNLOAD SOURCE STREAMS
    let ffmpeg_command_executed: String = if is_video_mode {
        let video_fmt = request.video_format_id.as_ref().unwrap();
        let video_tmp = work_dir.join(format!("video_{}.tmp", video_fmt));

        if let Some(ref audio_fmt) = request.audio_format_id {
            let audio_tmp = work_dir.join(format!("audio_{}.tmp", audio_fmt));

            // Fetch video (0% to 50%)
            download_stream_async(
                &yt_dlp_bin,
                url,
                video_fmt,
                &video_tmp,
                job_id,
                app,
                token,
                0.0,
                0.5,
                "video",
                settings,
            ).await?;

            if token.is_cancelled() {
                let _ = fs::remove_dir_all(&work_dir);
                return Err("Cancelled".to_string());
            }

            // Fetch audio (50% to 100%)
            download_stream_async(
                &yt_dlp_bin,
                url,
                audio_fmt,
                &audio_tmp,
                job_id,
                app,
                token,
                50.0,
                0.5,
                "audio",
                settings,
            ).await?;

            if token.is_cancelled() {
                let _ = fs::remove_dir_all(&work_dir);
                return Err("Cancelled".to_string());
            }

            // 3. REMUXING PIPELINE
            let _ = app.emit(
                "download-progress",
                DownloadProgressPayload {
                    job_id: job_id.to_string(),
                    phase: "remuxing".to_string(),
                    stream: "overall".to_string(),
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

            let mut cmd = TokioCommand::new(&ffmpeg_bin);
            cmd.args(mux_cmd.to_args());
            let executed = format!("ffmpeg {}", mux_cmd.to_args().join(" "));

            let mut child = cmd.spawn().map_err(|e| format!("FFmpeg failed to spawn: {}", e))?;
            tokio::select! {
                _ = token.cancelled() => {
                    let _ = child.kill().await;
                    let _ = fs::remove_dir_all(&work_dir);
                    return Err("Cancelled".to_string());
                }
                status = child.wait() => {
                    let s = status.map_err(|e| format!("FFmpeg execution failed: {}", e))?;
                    if !s.success() {
                        return Err("FFmpeg lossless remuxing process returned non-zero exit code".to_string());
                    }
                }
            }

            executed
        } else {
            // Video-only (Muted / No Audio)
            download_stream_async(
                &yt_dlp_bin,
                url,
                video_fmt,
                &video_tmp,
                job_id,
                app,
                token,
                0.0,
                1.0,
                "video",
                settings,
            ).await?;

            if token.is_cancelled() {
                let _ = fs::remove_dir_all(&work_dir);
                return Err("Cancelled".to_string());
            }

            let source_container = request
                .expected_video
                .as_ref()
                .map(|v| v.container.as_str())
                .unwrap_or("webm");

            if source_container == final_container {
                fs::copy(&video_tmp, &final_output_path)
                    .map_err(|e| format!("Failed copying video stream: {}", e))?;
                String::new()
            } else {
                let mux_cmd = LosslessMuxerCommand::builder()
                    .video_input(&video_tmp)
                    .output_path(&final_output_path)
                    .build()?;

                let mut cmd = TokioCommand::new(&ffmpeg_bin);
                cmd.args(mux_cmd.to_args());
                let executed = format!("ffmpeg {}", mux_cmd.to_args().join(" "));

                let mut child = cmd.spawn().map_err(|e| format!("FFmpeg failed to spawn: {}", e))?;
                tokio::select! {
                    _ = token.cancelled() => {
                        let _ = child.kill().await;
                        let _ = fs::remove_dir_all(&work_dir);
                        return Err("Cancelled".to_string());
                    }
                    status = child.wait() => {
                        let s = status.map_err(|e| format!("FFmpeg execution failed: {}", e))?;
                        if !s.success() {
                            return Err("FFmpeg lossless remuxing process returned non-zero exit code".to_string());
                        }
                    }
                }

                executed
            }
        }
    } else {
        // Audio-only download
        let audio_fmt = request
            .audio_format_id
            .as_deref()
            .ok_or_else(|| "Audio format ID is required for audio mode".to_string())?;

        let audio_tmp = work_dir.join(format!("audio_{}.tmp", audio_fmt));
        download_stream_async(
            &yt_dlp_bin,
            url,
            audio_fmt,
            &audio_tmp,
            job_id,
            app,
            token,
            0.0,
            1.0,
            "audio",
            settings,
        ).await?;

        if token.is_cancelled() {
            let _ = fs::remove_dir_all(&work_dir);
            return Err("Cancelled".to_string());
        }

        let source_container = request
            .expected_audio
            .as_ref()
            .map(|a| a.container.as_str())
            .unwrap_or("webm");

        if source_container == final_container {
            fs::copy(&audio_tmp, &final_output_path)
                .map_err(|e| format!("Failed copying audio stream: {}", e))?;
            String::new()
        } else {
            let mux_cmd = LosslessMuxerCommand::builder()
                .audio_input(&audio_tmp)
                .output_path(&final_output_path)
                .build()?;

            let mut cmd = TokioCommand::new(&ffmpeg_bin);
            cmd.args(mux_cmd.to_args());
            let executed = format!("ffmpeg {}", mux_cmd.to_args().join(" "));

            let mut child = cmd.spawn().map_err(|e| format!("FFmpeg failed to spawn: {}", e))?;
            tokio::select! {
                _ = token.cancelled() => {
                    let _ = child.kill().await;
                    let _ = fs::remove_dir_all(&work_dir);
                    return Err("Cancelled".to_string());
                }
                status = child.wait() => {
                    let s = status.map_err(|e| format!("FFmpeg execution failed: {}", e))?;
                    if !s.success() {
                        return Err("FFmpeg lossless remuxing process returned non-zero exit code".to_string());
                    }
                }
            }

            executed
        }
    };

    if token.is_cancelled() {
        let _ = fs::remove_dir_all(&work_dir);
        return Err("Cancelled".to_string());
    }

    // 4. TWO-TIER VERIFICATION
    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            job_id: job_id.to_string(),
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
        codec: if final_container == "m4a" { "aac".to_string() } else { "opus".to_string() },
        container: final_container.to_string(),
        nominal_bitrate_kbps: Some(160.0),
        sample_rate_hz: Some(48000),
        channels: Some(2),
        is_default: true,
    });

    let expected_audio = request.expected_audio.as_ref().or(default_audio.as_ref());

    let verification = verify_artifact(
        &final_output_path,
        request.expected_video.as_ref(),
        expected_audio,
        &ffmpeg_command_executed,
    );

    // 5. LIFECYCLE CLEANUP
    if verification.status == "verified" {
        let _ = fs::remove_dir_all(&work_dir);
        Ok((verification, final_output_path.to_string_lossy().to_string()))
    } else {
        let failed_dir = temp_base.join(format!("pulsestream_{}_FAILED", job_id));
        let _ = fs::rename(&work_dir, &failed_dir);
        Err(format!(
            "Verification Failed:\n{}\nFragments preserved at: {:?}",
            verification.details, failed_dir
        ))
    }
}

// ================= Tauri Commands =================

#[tauri::command]
pub async fn enqueue_job(
    app: AppHandle,
    state: tauri::State<'_, Arc<QueueManager>>,
    request: DownloadJobRequest,
) -> Result<String, String> {
    Ok(state.enqueue(&app, request).await)
}

#[tauri::command]
pub async fn cancel_job(
    app: AppHandle,
    state: tauri::State<'_, Arc<QueueManager>>,
    job_id: String,
) -> Result<(), String> {
    state.cancel(&app, &job_id).await
}

#[tauri::command]
pub async fn pause_queue(
    app: AppHandle,
    state: tauri::State<'_, Arc<QueueManager>>,
) -> Result<(), String> {
    state.pause(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn resume_queue(
    app: AppHandle,
    state: tauri::State<'_, Arc<QueueManager>>,
) -> Result<(), String> {
    state.resume(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn get_queue_items(
    state: tauri::State<'_, Arc<QueueManager>>,
) -> Result<Vec<QueueJob>, String> {
    Ok(state.get_items().await)
}

#[tauri::command]
pub async fn clear_completed_jobs(
    app: AppHandle,
    state: tauri::State<'_, Arc<QueueManager>>,
) -> Result<(), String> {
    state.clear_completed(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn get_session_settings(
    state: tauri::State<'_, Arc<QueueManager>>,
) -> Result<SessionSettings, String> {
    Ok(state.get_settings().await)
}

#[tauri::command]
pub async fn update_session_settings(
    state: tauri::State<'_, Arc<QueueManager>>,
    settings: SessionSettings,
) -> Result<(), String> {
    state.update_settings(settings).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_status_serialization() {
        let status = JobStatus::Active;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"active\"");

        let parsed: JobStatus = serde_json::from_str("\"cancelled\"").unwrap();
        assert_eq!(parsed, JobStatus::Cancelled);
    }

    #[test]
    fn test_cancellation_token_behavior() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }

    #[test]
    fn test_session_settings_defaults() {
        let settings = SessionSettings::default();
        assert_eq!(settings.cookie_mode, "none");
        assert!(!settings.enable_po_token);
        assert!(settings.cookie_file_path.is_none());
    }

    #[test]
    fn test_queue_manager_new_without_tokio_runtime() {
        // Runs on a standard OS thread without Tokio runtime context.
        // Must succeed without panicking ("there is no reactor running").
        let qm = QueueManager::new(2);
        assert_eq!(qm.max_concurrent, 2);
    }
}

