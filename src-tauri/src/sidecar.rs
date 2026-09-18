use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarPaths {
    pub yt_dlp: PathBuf,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum YtDlpUpdateResult {
    AlreadyUpToDate { current_version: String },
    Updated { from_version: String, to_version: String, backup_path: PathBuf },
    FreshlyInstalled { version: String },
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

/// Manages sidecar binary resolution and atomic lifecycle updates for yt-dlp.
/// FFmpeg and FFprobe are pinned and strictly immutable at runtime.
pub struct SidecarManager {
    bin_dir: PathBuf,
}

impl SidecarManager {
    /// Creates a new SidecarManager given a directory for local managed binaries.
    pub fn new(bin_dir: impl Into<PathBuf>) -> Self {
        let bin_dir = bin_dir.into();
        let _ = fs::create_dir_all(&bin_dir);
        Self { bin_dir }
    }

    /// Creates a SidecarManager in default app local data or fallback directory.
    pub fn default_manager() -> Self {
        let default_dir = dirs_bin_dir().unwrap_or_else(|| PathBuf::from("./binaries"));
        Self::new(default_dir)
    }

    pub fn bin_dir(&self) -> &Path {
        &self.bin_dir
    }

    /// Target filename for yt-dlp on the current operating system.
    pub fn yt_dlp_binary_name() -> &'static str {
        if cfg!(target_os = "windows") {
            "yt-dlp.exe"
        } else if cfg!(target_os = "macos") {
            "yt-dlp_macos"
        } else {
            "yt-dlp"
        }
    }

    /// Primary path for the managed active yt-dlp binary.
    pub fn active_yt_dlp_path(&self) -> PathBuf {
        self.bin_dir.join(Self::yt_dlp_binary_name())
    }

    /// Resolves the yt-dlp executable path:
    /// 1. Check managed bin directory.
    /// 2. Fall back to system PATH if available.
    /// 3. Otherwise return the managed binary path.
    pub fn resolve_yt_dlp(&self) -> PathBuf {
        let local = self.active_yt_dlp_path();
        if local.is_file() {
            return local;
        }

        if let Some(sys) = find_in_path("yt-dlp") {
            return sys;
        }

        local
    }

    /// Resolves FFmpeg binary path.
    /// Invariant: FFmpeg is pinned; runtime replacement is prohibited.
    pub fn resolve_ffmpeg(&self) -> Result<PathBuf, String> {
        let local = self.bin_dir.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
        if local.is_file() {
            return Ok(local);
        }

        if let Some(sys) = find_in_path("ffmpeg") {
            return Ok(sys);
        }

        Err("FFmpeg binary not found. PulseStream requires FFmpeg for lossless container remuxing.".to_string())
    }

    /// Resolves FFprobe binary path.
    /// Invariant: FFprobe is pinned; runtime replacement is prohibited.
    pub fn resolve_ffprobe(&self) -> Result<PathBuf, String> {
        let local = self.bin_dir.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
        if local.is_file() {
            return Ok(local);
        }

        if let Some(sys) = find_in_path("ffprobe") {
            return Ok(sys);
        }

        Err("FFprobe binary not found. PulseStream requires FFprobe for policy audit verification.".to_string())
    }

    /// Resolves Deno binary path (optional runtime component).
    pub fn resolve_deno(&self) -> Option<PathBuf> {
        let local = self.bin_dir.join(if cfg!(windows) { "deno.exe" } else { "deno" });
        if local.is_file() {
            return Some(local);
        }

        if let Some(sys) = find_in_path("deno") {
            return Some(sys);
        }

        None
    }

    /// Resolves all three sidecars.
    pub fn resolve_all(&self) -> Result<SidecarPaths, String> {
        Ok(SidecarPaths {
            yt_dlp: self.resolve_yt_dlp(),
            ffmpeg: self.resolve_ffmpeg()?,
            ffprobe: self.resolve_ffprobe()?,
        })
    }

    /// Reads current local yt-dlp version using `--version`.
    pub fn get_local_yt_dlp_version(&self) -> Result<String, String> {
        let path = self.resolve_yt_dlp();
        if !path.exists() {
            return Err("yt-dlp binary does not exist".to_string());
        }

        let output = Command::new(&path)
            .arg("--version")
            .output()
            .map_err(|e| format!("Failed to execute {:?}: {}", path, e))?;

        if !output.status.success() {
            return Err(format!(
                "yt-dlp --version failed with exit status {:?}",
                output.status.code()
            ));
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    }

    /// Performs an atomic update check for yt-dlp:
    /// 1. Reads current version.
    /// 2. Queries GitHub Releases API for the latest release tag.
    /// 3. Downloads candidate binary to a `.tmp` file in the same directory.
    /// 4. Downloads and validates against upstream `SHA2-256SUMS`.
    /// 5. Executes `--version` on the candidate to ensure health.
    /// 6. Saves a `.bak` copy of the active binary.
    /// 7. Atomically renames the candidate into place.
    pub async fn check_and_update_yt_dlp(&self) -> Result<YtDlpUpdateResult, String> {
        let local_version = self.get_local_yt_dlp_version().ok();
        let target_binary_name = Self::yt_dlp_binary_name();

        // 1. Query GitHub Releases API
        let client = reqwest::Client::builder()
            .user_agent("PulseStream/0.1.0 (Desktop YouTube Downloader)")
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let release: GithubRelease = client
            .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
            .send()
            .await
            .map_err(|e| format!("Failed to query GitHub releases: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse release JSON: {}", e))?;

        let remote_version = release.tag_name.trim_start_matches('v').trim().to_string();

        if let Some(ref cur) = local_version {
            if cur == &remote_version {
                return Ok(YtDlpUpdateResult::AlreadyUpToDate {
                    current_version: cur.clone(),
                });
            }
        }

        // 2. Locate binary asset and checksum file
        let binary_asset = release
            .assets
            .iter()
            .find(|a| a.name == target_binary_name)
            .ok_or_else(|| format!("Could not find asset '{}' in release assets", target_binary_name))?;

        let checksum_asset = release
            .assets
            .iter()
            .find(|a| a.name == "SHA2-256SUMS")
            .ok_or_else(|| "Could not find 'SHA2-256SUMS' in release assets".to_string())?;

        // 3. Download and parse expected SHA256 checksum
        let checksums_raw = client
            .get(&checksum_asset.browser_download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download SHA2-256SUMS: {}", e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read SHA2-256SUMS text: {}", e))?;

        let expected_hash = parse_sha256sums(&checksums_raw, target_binary_name)
            .ok_or_else(|| format!("Checksum for '{}' not found in SHA2-256SUMS", target_binary_name))?;

        // 4. Download candidate binary to `.tmp` file in the managed directory
        let active_path = self.active_yt_dlp_path();
        let tmp_path = active_path.with_extension("tmp");
        let bak_path = active_path.with_extension("bak");

        let binary_bytes = client
            .get(&binary_asset.browser_download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download {}: {}", target_binary_name, e))?
            .bytes()
            .await
            .map_err(|e| format!("Failed to buffer {}: {}", target_binary_name, e))?;

        // 5. Verify candidate binary checksum
        let mut hasher = Sha256::new();
        hasher.update(&binary_bytes);
        let actual_hash = hex::encode(hasher.finalize());

        if actual_hash.to_lowercase() != expected_hash.to_lowercase() {
            return Err(format!(
                "Checksum verification mismatch for {}: expected {}, got {}",
                target_binary_name, expected_hash, actual_hash
            ));
        }

        // Write candidate to .tmp file
        fs::write(&tmp_path, &binary_bytes)
            .map_err(|e| format!("Failed to write candidate binary to {:?}: {}", tmp_path, e))?;

        // 6. Set POSIX executable permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o755)) {
                let _ = fs::remove_file(&tmp_path);
                return Err(format!("Failed to set executable mode 0755: {}", e));
            }
        }

        // 7. Health Check: Execute candidate `--version` to verify health
        let smoke_test = Command::new(&tmp_path).arg("--version").output();
        match smoke_test {
            Ok(output) if output.status.success() => {
                let verified_ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if verified_ver.is_empty() {
                    let _ = fs::remove_file(&tmp_path);
                    return Err("Candidate binary returned empty version string".to_string());
                }
            }
            Ok(output) => {
                let _ = fs::remove_file(&tmp_path);
                return Err(format!(
                    "Candidate binary failed health check with code: {:?}",
                    output.status.code()
                ));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp_path);
                return Err(format!("Candidate binary failed to execute: {}", e));
            }
        }

        // 8. Atomic replace & maintain one `.bak` rollback
        if active_path.exists() {
            if let Err(e) = fs::copy(&active_path, &bak_path) {
                eprintln!("Warning: Failed to create backup at {:?}: {}", bak_path, e);
            }
        }

        fs::rename(&tmp_path, &active_path)
            .map_err(|e| format!("Failed to atomically rename candidate into place: {}", e))?;

        if let Some(old_ver) = local_version {
            Ok(YtDlpUpdateResult::Updated {
                from_version: old_ver,
                to_version: remote_version,
                backup_path: bak_path,
            })
        } else {
            Ok(YtDlpUpdateResult::FreshlyInstalled {
                version: remote_version,
            })
        }
    }

    /// Rollback yt-dlp to the `.bak` binary if one exists.
    pub fn rollback_yt_dlp(&self) -> Result<PathBuf, String> {
        let active_path = self.active_yt_dlp_path();
        let bak_path = active_path.with_extension("bak");

        if !bak_path.exists() {
            return Err("No backup binary (.bak) found to rollback to".to_string());
        }

        fs::copy(&bak_path, &active_path)
            .map_err(|e| format!("Failed to restore backup over active binary: {}", e))?;

        Ok(active_path)
    }
}

/// Tauri command to trigger an atomic yt-dlp update check.
#[tauri::command]
pub async fn check_yt_dlp_update() -> Result<YtDlpUpdateResult, String> {
    let manager = SidecarManager::default_manager();
    manager.check_and_update_yt_dlp().await
}

/// Tauri command to retrieve sidecar binary paths.
#[tauri::command]
pub fn get_sidecar_status() -> Result<SidecarPaths, String> {
    let manager = SidecarManager::default_manager();
    manager.resolve_all()
}

/// Parses standard `SHA2-256SUMS` text format to find the SHA256 hex string for a given filename.
pub fn parse_sha256sums(content: &str, target_filename: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 {
            let hash = parts[0];
            let raw_file = parts[1].trim_start_matches('*');
            if raw_file == target_filename {
                return Some(hash.to_string());
            }
        }
    }
    None
}

/// Helper to search system PATH for a binary name.
fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for p in std::env::split_paths(&path_var) {
        let full = p.join(binary);
        if full.is_file() {
            return Some(full);
        }
        #[cfg(windows)]
        {
            let exe = p.join(format!("{}.exe", binary));
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

/// Computes the default application binaries directory.
fn dirs_bin_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|h| h.join(".local/share/pulsestream/bin"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sha256sums() {
        let sample = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  yt-dlp\n\
                      4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 *yt-dlp.exe\n\
                      ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  yt-dlp_macos";

        assert_eq!(
            parse_sha256sums(sample, "yt-dlp"),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string())
        );
        assert_eq!(
            parse_sha256sums(sample, "yt-dlp.exe"),
            Some("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945".to_string())
        );
        assert_eq!(
            parse_sha256sums(sample, "yt-dlp_macos"),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".to_string())
        );
        assert_eq!(parse_sha256sums(sample, "non_existent"), None);
    }

    #[test]
    fn test_sidecar_manager_resolution() {
        let temp = tempfile::tempdir().unwrap();
        let manager = SidecarManager::new(temp.path());

        // FFmpeg should resolve to system /usr/bin/ffmpeg if installed on host
        let ffmpeg = manager.resolve_ffmpeg();
        assert!(ffmpeg.is_ok(), "Expected ffmpeg to resolve on system");
    }
}
