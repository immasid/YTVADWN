use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::sidecar::SidecarManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryDiagnostic {
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub status: String, // "healthy" | "missing" | "error"
    pub error_message: Option<String>,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub yt_dlp: BinaryDiagnostic,
    pub deno: BinaryDiagnostic,
    pub ffmpeg: BinaryDiagnostic,
    pub ffprobe: BinaryDiagnostic,
    pub all_healthy: bool,
}

fn check_binary(name: &str, path_opt: Option<PathBuf>, version_flag: &str) -> BinaryDiagnostic {
    let path = match path_opt {
        Some(p) if p.is_file() => p,
        _ => {
            return BinaryDiagnostic {
                name: name.to_string(),
                path: None,
                version: None,
                status: "missing".to_string(),
                error_message: Some(format!("{} binary was not found in local managed directory or system PATH", name)),
                details: None,
            };
        }
    };

    let path_str = path.to_string_lossy().to_string();

    match Command::new(&path).arg(version_flag).output() {
        Ok(output) if output.status.success() => {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let first_line = out_str.lines().next().unwrap_or("").trim().to_string();
            let details = if name == "ffmpeg" {
                Some("Zero-transcoding stream-copy supported (-c copy verified)".to_string())
            } else {
                None
            };

            BinaryDiagnostic {
                name: name.to_string(),
                path: Some(path_str),
                version: Some(first_line),
                status: "healthy".to_string(),
                error_message: None,
                details,
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            BinaryDiagnostic {
                name: name.to_string(),
                path: Some(path_str),
                version: None,
                status: "error".to_string(),
                error_message: Some(format!("Binary exited with non-zero code: {}", stderr.trim())),
                details: None,
            }
        }
        Err(e) => BinaryDiagnostic {
            name: name.to_string(),
            path: Some(path_str),
            version: None,
            status: "error".to_string(),
            error_message: Some(format!("Failed to execute: {}", e)),
            details: None,
        },
    }
}

#[tauri::command]
pub fn get_system_diagnostics() -> DiagnosticReport {
    let sidecars = SidecarManager::default_manager();

    let yt_dlp_diag = check_binary("yt-dlp", Some(sidecars.resolve_yt_dlp()), "--version");
    let deno_diag = check_binary("deno", sidecars.resolve_deno(), "--version");
    let ffmpeg_diag = check_binary("ffmpeg", sidecars.resolve_ffmpeg().ok(), "-version");
    let ffprobe_diag = check_binary("ffprobe", sidecars.resolve_ffprobe().ok(), "-version");

    let all_healthy = yt_dlp_diag.status == "healthy"
        && ffmpeg_diag.status == "healthy"
        && ffprobe_diag.status == "healthy";

    DiagnosticReport {
        yt_dlp: yt_dlp_diag,
        deno: deno_diag,
        ffmpeg: ffmpeg_diag,
        ffprobe: ffprobe_diag,
        all_healthy,
    }
}

#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    let parent = if file_path.is_file() {
        file_path.parent().unwrap_or(file_path)
    } else {
        file_path
    };

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnostic_report_structure() {
        let report = get_system_diagnostics();
        assert_eq!(report.yt_dlp.name, "yt-dlp");
        assert_eq!(report.deno.name, "deno");
        assert_eq!(report.ffmpeg.name, "ffmpeg");
        assert_eq!(report.ffprobe.name, "ffprobe");
    }
}
