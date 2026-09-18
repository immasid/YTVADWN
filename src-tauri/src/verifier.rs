use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::extractor::{VideoTrack, AudioTrack, normalize_video_codec, normalize_audio_codec};
use crate::sidecar::SidecarManager;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationAudit {
    pub operation: String, // 'DirectDownload' | 'LosslessRemux'
    pub executable: String,
    pub arguments: Vec<String>,
    pub stream_copy: bool,
    pub encoding_requested: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub status: String, // 'verified' | 'failed'
    pub policy_audit_passed: bool,
    pub codec_match: bool,
    pub dimensions_match: bool,
    pub sample_rate_match: bool,
    pub details: String,
    pub audit: Option<OperationAudit>,
}

#[derive(Debug, Deserialize)]
pub struct FfprobeStream {
    pub codec_name: Option<String>,
    pub codec_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub r_frame_rate: Option<String>,
    pub sample_rate: Option<String>,
    pub channels: Option<u32>,
    pub bit_rate: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FfprobeOutput {
    pub streams: Option<Vec<FfprobeStream>>,
}

/// Tier 1: Policy Audit.
/// Verifies the executed FFmpeg command string to confirm strict zero-transcoding compliance.
/// Re-encoding flags (-c:v, -c:a, -b:, -vf, -af, -r, etc.) are strictly forbidden.
pub fn audit_ffmpeg_policy(ffmpeg_command_executed: &str) -> Result<(), String> {
    let cmd = ffmpeg_command_executed.trim();
    if cmd.is_empty() {
        // Direct stream extraction (no FFmpeg remux required)
        return Ok(());
    }

    let forbidden_flags = [
        "-c:v", "-c:a", "-vcodec", "-acodec",
        "-b:v", "-b:a", "-b:s", "-crf",
        "-filter:v", "-filter:a", "-vf", "-af",
        "-r ", "-s ", "-aspect", "-preset",
        "-tune", "-profile:v", "-profile:a",
        "libx264", "libx265", "libvpx", "libaom", "libopus"
    ];

    for flag in &forbidden_flags {
        let pad_flag = format!(" {} ", flag.trim());
        let eq_flag = format!("={}", flag.trim());
        if cmd.contains(&pad_flag) || cmd.contains(&eq_flag) || cmd.starts_with(flag) {
            return Err(format!(
                "Policy Audit Failed: Prohibited transcoding flag detected: '{}'",
                flag.trim()
            ));
        }
    }

    if !cmd.contains("-c copy") && !cmd.contains("-codec copy") {
        return Err("Policy Audit Failed: Command must contain '-c copy' for lossless remuxing".to_string());
    }

    Ok(())
}

/// Helper to parse fractional frame rate (e.g. "60/1", "30000/1001", "24") to f64.
pub fn parse_r_frame_rate(rate: &str) -> Option<f64> {
    let parts: Vec<&str> = rate.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().ok()?;
        let den: f64 = parts[1].parse().ok()?;
        if den == 0.0 { return None; }
        Some(num / den)
    } else if parts.len() == 1 {
        parts[0].parse().ok()
    } else {
        None
    }
}

/// Tier 2: Structural validation of parsed ffprobe streams against expected tracks.
/// NOTE: Strict equality on audio bitrate is NOT performed to prevent false-positive
/// failures on Variable Bitrate (VBR) Opus/AAC streams.
pub fn inspect_streams(
    streams: &[FfprobeStream],
    expected_video: Option<&VideoTrack>,
    expected_audio: Option<&AudioTrack>,
    policy_passed: bool,
) -> VerificationResult {
    let mut codec_match = true;
    let mut dimensions_match = true;
    let mut sample_rate_match = true;
    let mut audit_logs = Vec::new();

    if policy_passed {
        audit_logs.push("Tier 1 Policy Audit: PASSED (-c copy confirmed, zero re-encoding flags).".to_string());
    } else {
        audit_logs.push("Tier 1 Policy Audit: FAILED (forbidden transcode parameter detected).".to_string());
    }

    // 1. Audio Stream Structural Inspection
    if let Some(expected_audio) = expected_audio {
        let audio_stream = streams.iter().find(|s| s.codec_type.as_deref() == Some("audio"));
        match audio_stream {
            Some(stream) => {
                let actual_raw_codec = stream.codec_name.as_deref().unwrap_or("unknown");
                let actual_codec = normalize_audio_codec(actual_raw_codec);
                let expected_codec = normalize_audio_codec(&expected_audio.codec);

                if actual_codec != expected_codec {
                    codec_match = false;
                    audit_logs.push(format!(
                        "Audio Codec Mismatch: Expected '{}', ffprobe detected '{}'.",
                        expected_codec, actual_codec
                    ));
                } else {
                    audit_logs.push(format!("Audio Codec Match: '{}' verified.", actual_codec));
                }

                let actual_rate: u32 = stream
                    .sample_rate
                    .as_deref()
                    .and_then(|r| r.parse().ok())
                    .unwrap_or(0);

                if let Some(exp_rate) = expected_audio.sample_rate_hz {
                    if actual_rate > 0 && actual_rate != exp_rate {
                        sample_rate_match = false;
                        audit_logs.push(format!(
                            "Audio Sample Rate Mismatch: Expected {} Hz, ffprobe detected {} Hz.",
                            exp_rate, actual_rate
                        ));
                    } else {
                        audit_logs.push(format!("Audio Sample Rate Match: {} Hz verified.", exp_rate));
                    }
                }

                // Explicit VBR Note: Bitrate is certified via Policy Audit, not strict equality
                audit_logs.push("Audio Bitrate Integrity: VBR tolerance active (verified via lossless policy audit).".to_string());
            }
            None => {
                codec_match = false;
                sample_rate_match = false;
                audit_logs.push("Error: No audio stream found in output artifact.".to_string());
            }
        }
    } else {
        audit_logs.push("Audio Stream: None expected (Video Only / Muted download).".to_string());
    }

    // 2. Video Stream Structural Inspection (if video expected)
    if let Some(exp_video) = expected_video {
        let video_stream = streams.iter().find(|s| s.codec_type.as_deref() == Some("video"));
        match video_stream {
            Some(stream) => {
                let actual_raw_codec = stream.codec_name.as_deref().unwrap_or("unknown");
                let actual_codec = normalize_video_codec(actual_raw_codec);
                let expected_codec = normalize_video_codec(&exp_video.codec);

                if actual_codec != expected_codec {
                    codec_match = false;
                    audit_logs.push(format!(
                        "Video Codec Mismatch: Expected '{}', ffprobe detected '{}'.",
                        expected_codec, actual_codec
                    ));
                } else {
                    audit_logs.push(format!("Video Codec Match: '{}' verified.", actual_codec));
                }

                // Dimension check
                let exp_dims: Vec<&str> = exp_video.resolution.split('x').collect();
                if exp_dims.len() == 2 {
                    let exp_w: u32 = exp_dims[0].parse().unwrap_or(0);
                    let exp_h: u32 = exp_dims[1].parse().unwrap_or(0);

                    let actual_w = stream.width.unwrap_or(0);
                    let actual_h = stream.height.unwrap_or(0);

                    if (exp_w > 0 && actual_w > 0 && exp_w != actual_w)
                        || (exp_h > 0 && actual_h > 0 && exp_h != actual_h)
                    {
                        dimensions_match = false;
                        audit_logs.push(format!(
                            "Video Dimensions Mismatch: Expected {}x{}, ffprobe detected {}x{}.",
                            exp_w, exp_h, actual_w, actual_h
                        ));
                    } else {
                        audit_logs.push(format!(
                            "Video Dimensions Match: {}x{} verified.",
                            actual_w, actual_h
                        ));
                    }
                }

                // Frame rate tolerance (allow fractional NTSC delta e.g. 59.94 vs 60)
                if let Some(exp_fps) = exp_video.fps {
                    if let Some(r_rate) = stream.r_frame_rate.as_deref() {
                        if let Some(actual_fps) = parse_r_frame_rate(r_rate) {
                            if (actual_fps - exp_fps).abs() > 1.5 {
                                audit_logs.push(format!(
                                    "Video FPS Warning: Expected {:.2} fps, ffprobe detected {:.2} fps.",
                                    exp_fps, actual_fps
                                ));
                            }
                        }
                    }
                }
            }
            None => {
                codec_match = false;
                dimensions_match = false;
                audit_logs.push("Error: Expected video stream, but none found in output artifact.".to_string());
            }
        }
    }

    let all_passed = policy_passed && codec_match && dimensions_match && sample_rate_match;
    let status = if all_passed { "verified" } else { "failed" }.to_string();

    VerificationResult {
        status,
        policy_audit_passed: policy_passed,
        codec_match,
        dimensions_match,
        sample_rate_match,
        details: audit_logs.join("\n"),
        audit: None,
    }
}

/// Executes Two-Tier Verification on an output media artifact.
pub fn verify_artifact(
    output_file: &Path,
    expected_video: Option<&VideoTrack>,
    expected_audio: Option<&AudioTrack>,
    ffmpeg_command_executed: &str,
) -> VerificationResult {
    // 1. Tier 1: Policy Audit
    let policy_res = audit_ffmpeg_policy(ffmpeg_command_executed);
    let policy_passed = policy_res.is_ok();
    let mut initial_error = String::new();
    if let Err(ref e) = policy_res {
        initial_error = format!("{}\n", e);
    }

    let operation_audit = if !ffmpeg_command_executed.trim().is_empty() {
        let args: Vec<String> = ffmpeg_command_executed
            .split_whitespace()
            .skip(1)
            .map(String::from)
            .collect();
        Some(OperationAudit {
            operation: "LosslessRemux".to_string(),
            executable: "ffmpeg".to_string(),
            arguments: args,
            stream_copy: policy_passed,
            encoding_requested: !policy_passed,
        })
    } else {
        Some(OperationAudit {
            operation: "DirectDownload".to_string(),
            executable: "yt-dlp".to_string(),
            arguments: vec!["--progress-template".to_string(), "%(progress)j".to_string()],
            stream_copy: true,
            encoding_requested: false,
        })
    };

    // 2. Tier 2: ffprobe Artifact Inspection
    if !output_file.is_file() {
        return VerificationResult {
            status: "failed".to_string(),
            policy_audit_passed: policy_passed,
            codec_match: false,
            dimensions_match: false,
            sample_rate_match: false,
            details: format!("{}Artifact file does not exist: {:?}", initial_error, output_file),
            audit: operation_audit,
        };
    }

    let sidecars = SidecarManager::default_manager();
    let ffprobe_bin = match sidecars.resolve_ffprobe() {
        Ok(p) => p,
        Err(e) => {
            return VerificationResult {
                status: "failed".to_string(),
                policy_audit_passed: policy_passed,
                codec_match: false,
                dimensions_match: false,
                sample_rate_match: false,
                details: format!("{}Failed to resolve ffprobe: {}", initial_error, e),
                audit: operation_audit,
            };
        }
    };

    let probe_output = Command::new(&ffprobe_bin)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(output_file)
        .output();

    let output = match probe_output {
        Ok(out) if out.status.success() => out,
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return VerificationResult {
                status: "failed".to_string(),
                policy_audit_passed: policy_passed,
                codec_match: false,
                dimensions_match: false,
                sample_rate_match: false,
                details: format!("{}ffprobe inspection failed: {}", initial_error, stderr.trim()),
                audit: operation_audit,
            };
        }
        Err(e) => {
            return VerificationResult {
                status: "failed".to_string(),
                policy_audit_passed: policy_passed,
                codec_match: false,
                dimensions_match: false,
                sample_rate_match: false,
                details: format!("{}Failed to execute ffprobe: {}", initial_error, e),
                audit: operation_audit,
            };
        }
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let parsed: FfprobeOutput = match serde_json::from_str(&stdout_str) {
        Ok(p) => p,
        Err(e) => {
            return VerificationResult {
                status: "failed".to_string(),
                policy_audit_passed: policy_passed,
                codec_match: false,
                dimensions_match: false,
                sample_rate_match: false,
                details: format!("{}Failed to parse ffprobe JSON output: {}", initial_error, e),
                audit: operation_audit,
            };
        }
    };

    let streams = parsed.streams.unwrap_or_default();
    let mut result = inspect_streams(&streams, expected_video, expected_audio, policy_passed);
    result.audit = operation_audit;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier1_policy_audit_accepts_clean_stream_copy() {
        let valid_cmd = "ffmpeg -y -i v.webm -i a.opus -c copy -movflags +faststart out.webm";
        assert!(audit_ffmpeg_policy(valid_cmd).is_ok());

        let empty_cmd = ""; // Direct stream copy without ffmpeg
        assert!(audit_ffmpeg_policy(empty_cmd).is_ok());
    }

    #[test]
    fn test_tier1_policy_audit_rejects_reencoding_flags() {
        let forbidden_commands = [
            "ffmpeg -y -i v.webm -i a.opus -c:v libx264 -c copy out.mp4",
            "ffmpeg -y -i v.webm -i a.opus -c copy -b:a 320k out.mp4",
            "ffmpeg -y -i v.webm -i a.opus -c copy -vf scale=1280:720 out.mp4",
            "ffmpeg -y -i v.webm -i a.opus -c copy -r 60 out.mp4",
            "ffmpeg -y -i v.webm -i a.opus -c:a aac out.mp4",
            "ffmpeg -y -i v.webm -i a.opus out.mp4", // missing -c copy
        ];

        for cmd in &forbidden_commands {
            assert!(
                audit_ffmpeg_policy(cmd).is_err(),
                "Expected command to fail policy audit: {}",
                cmd
            );
        }
    }

    #[test]
    fn test_tier2_inspection_success_and_vbr_tolerance() {
        let streams = vec![
            FfprobeStream {
                codec_name: Some("vp09.00.51.08".to_string()),
                codec_type: Some("video".to_string()),
                width: Some(1920),
                height: Some(1080),
                r_frame_rate: Some("60/1".to_string()),
                sample_rate: None,
                channels: None,
                bit_rate: Some("2500000".to_string()),
            },
            FfprobeStream {
                codec_name: Some("opus".to_string()),
                codec_type: Some("audio".to_string()),
                width: None,
                height: None,
                r_frame_rate: None,
                sample_rate: Some("48000".to_string()),
                channels: Some(2),
                bit_rate: Some("142381".to_string()), // VBR bitrate differing from nominal 160k
            },
        ];

        let exp_video = VideoTrack {
            format_id: "248".to_string(),
            resolution: "1920x1080".to_string(),
            label: "1080p60".to_string(),
            fps: Some(60.0),
            codec: "vp9".to_string(),
            container: "webm".to_string(),
            filesize_bytes: Some(50000000),
            is_hdr: false,
        };

        let exp_audio = AudioTrack {
            format_id: "251".to_string(),
            language: "en".to_string(),
            language_label: "English".to_string(),
            role: "original".to_string(),
            codec: "opus".to_string(),
            container: "webm".to_string(),
            nominal_bitrate_kbps: Some(160.0), // nominal differs from actual 142k due to VBR
            sample_rate_hz: Some(48000),
            channels: Some(2),
            is_default: true,
        };

        let result = inspect_streams(&streams, Some(&exp_video), Some(&exp_audio), true);
        assert_eq!(result.status, "verified");
        assert!(result.policy_audit_passed);
        assert!(result.codec_match);
        assert!(result.dimensions_match);
        assert!(result.sample_rate_match);
        assert!(result.details.contains("VBR tolerance active"));
    }

    #[test]
    fn test_tier2_inspection_fails_on_dimension_mismatch() {
        let streams = vec![
            FfprobeStream {
                codec_name: Some("h264".to_string()),
                codec_type: Some("video".to_string()),
                width: Some(1280), // Mismatch: 1280 instead of 1920
                height: Some(720),
                r_frame_rate: Some("30/1".to_string()),
                sample_rate: None,
                channels: None,
                bit_rate: None,
            },
            FfprobeStream {
                codec_name: Some("aac".to_string()),
                codec_type: Some("audio".to_string()),
                width: None,
                height: None,
                r_frame_rate: None,
                sample_rate: Some("44100".to_string()),
                channels: Some(2),
                bit_rate: None,
            },
        ];

        let exp_video = VideoTrack {
            format_id: "137".to_string(),
            resolution: "1920x1080".to_string(),
            label: "1080p".to_string(),
            fps: Some(30.0),
            codec: "h264".to_string(),
            container: "mp4".to_string(),
            filesize_bytes: None,
            is_hdr: false,
        };

        let exp_audio = AudioTrack {
            format_id: "140".to_string(),
            language: "en".to_string(),
            language_label: "English".to_string(),
            role: "original".to_string(),
            codec: "aac".to_string(),
            container: "m4a".to_string(),
            nominal_bitrate_kbps: Some(128.0),
            sample_rate_hz: Some(44100),
            channels: Some(2),
            is_default: true,
        };

        let result = inspect_streams(&streams, Some(&exp_video), Some(&exp_audio), true);
        assert_eq!(result.status, "failed");
        assert!(!result.dimensions_match);
    }

    #[test]
    fn test_tier2_inspection_video_only_muted() {
        let streams = vec![
            FfprobeStream {
                codec_name: Some("h264".to_string()),
                codec_type: Some("video".to_string()),
                width: Some(1920),
                height: Some(1080),
                r_frame_rate: Some("30/1".to_string()),
                sample_rate: None,
                channels: None,
                bit_rate: None,
            },
        ];

        let exp_video = VideoTrack {
            format_id: "137".to_string(),
            resolution: "1920x1080".to_string(),
            label: "1080p".to_string(),
            fps: Some(30.0),
            codec: "h264".to_string(),
            container: "mp4".to_string(),
            filesize_bytes: None,
            is_hdr: false,
        };

        let result = inspect_streams(&streams, Some(&exp_video), None, true);
        assert_eq!(result.status, "verified");
        assert!(result.policy_audit_passed);
        assert!(result.codec_match);
        assert!(result.dimensions_match);
        assert!(result.sample_rate_match);
        assert!(result.details.contains("Video Only / Muted"));
    }
}
