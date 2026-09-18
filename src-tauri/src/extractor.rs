use std::collections::HashMap;
use std::process::Command;
use serde::{Deserialize, Serialize};
use crate::sidecar::SidecarManager;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrack {
    pub format_id: String,
    pub resolution: String,
    pub label: String,
    pub fps: Option<f64>,
    pub codec: String, // 'av1' | 'vp9' | 'h264' | string
    pub container: String, // 'webm' | 'mp4'
    pub filesize_bytes: Option<u64>,
    pub is_hdr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub format_id: String,
    pub language: String, // ISO string e.g. "en"
    pub language_label: String,
    pub role: String, // 'original' | 'dub' | 'descriptive' | 'unspecified'
    pub codec: String, // 'opus' | 'aac' | string
    pub container: String, // 'webm' | 'm4a'
    pub nominal_bitrate_kbps: Option<f64>,
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u32>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedManifest {
    pub video_id: String,
    pub title: String,
    pub duration_seconds: f64,
    pub thumbnail_url: String,
    pub video_tracks: Vec<VideoTrack>,
    pub audio_tracks: Vec<AudioTrack>,
}

// Raw yt-dlp schema representation
#[derive(Debug, Clone, Deserialize)]
pub struct RawYtDlpFormat {
    pub format_id: Option<String>,
    pub ext: Option<String>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub filesize: Option<u64>,
    pub filesize_approx: Option<u64>,
    pub abr: Option<f64>,
    pub vbr: Option<f64>,
    pub tbr: Option<f64>,
    pub asr: Option<u32>,
    pub audio_channels: Option<u32>,
    pub language: Option<String>,
    pub format_note: Option<String>,
    pub dynamic_range: Option<String>,
    pub color_primaries: Option<String>,
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawYtDlpManifest {
    pub id: Option<String>,
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub formats: Option<Vec<RawYtDlpFormat>>,
}

/// Normalizes raw video codec string into canonical 'h264', 'vp9', 'av1', or passthrough.
pub fn normalize_video_codec(codec: &str) -> String {
    let c = codec.trim().to_lowercase();
    if c.starts_with("avc") || c.contains("h264") || c.contains("x264") {
        "h264".to_string()
    } else if c.starts_with("vp09") || c.starts_with("vp9") {
        "vp9".to_string()
    } else if c.starts_with("av01") || c.starts_with("av1") {
        "av1".to_string()
    } else {
        c
    }
}

/// Normalizes raw audio codec string into canonical 'opus', 'aac', or passthrough.
pub fn normalize_audio_codec(codec: &str) -> String {
    let c = codec.trim().to_lowercase();
    if c.contains("opus") {
        "opus".to_string()
    } else if c.starts_with("mp4a") || c.contains("aac") || c == "m4a" {
        "aac".to_string()
    } else {
        c
    }
}

/// Resolves standard ISO language code to human-readable label.
pub fn resolve_language_label(code: &str) -> String {
    let base = code.split('-').next().unwrap_or(code).to_lowercase();
    match base.as_str() {
        "en" => "English".to_string(),
        "es" => "Spanish".to_string(),
        "fr" => "French".to_string(),
        "de" => "German".to_string(),
        "ja" => "Japanese".to_string(),
        "ko" => "Korean".to_string(),
        "pt" => "Portuguese".to_string(),
        "ru" => "Russian".to_string(),
        "it" => "Italian".to_string(),
        "hi" => "Hindi".to_string(),
        "zh" => "Chinese".to_string(),
        "ar" => "Arabic".to_string(),
        "id" => "Indonesian".to_string(),
        "tr" => "Turkish".to_string(),
        "vi" => "Vietnamese".to_string(),
        "nl" => "Dutch".to_string(),
        "pl" => "Polish".to_string(),
        "uk" => "Ukrainian".to_string(),
        "" => "Original".to_string(),
        other => other.to_uppercase(),
    }
}

/// Parses track role from format notes and metadata.
pub fn parse_audio_role(note: Option<&str>, format_id: Option<&str>) -> String {
    let n = note.unwrap_or("").to_lowercase();
    let fid = format_id.unwrap_or("").to_lowercase();

    if n.contains("dub") || fid.contains("dub") {
        "dub".to_string()
    } else if n.contains("desc") || n.contains("descriptive") {
        "descriptive".to_string()
    } else if n.contains("orig") || n.contains("default") {
        "original".to_string()
    } else {
        "unspecified".to_string()
    }
}

/// Normalizes raw yt-dlp JSON output into a clean, deduplicated NormalizedManifest.
pub fn normalize_manifest(raw: RawYtDlpManifest) -> NormalizedManifest {
    let video_id = raw.id.unwrap_or_default();
    let title = raw.title.unwrap_or_else(|| "Unknown Title".to_string());
    let duration_seconds = raw.duration.unwrap_or(0.0);
    let thumbnail_url = raw.thumbnail.unwrap_or_default();

    let formats = raw.formats.unwrap_or_default();

    // 1. FILTER STORYBOARDS & SPECIAL FORMATS
    let valid_formats: Vec<RawYtDlpFormat> = formats
        .into_iter()
        .filter(|f| {
            let ext = f.ext.as_deref().unwrap_or("");
            let proto = f.protocol.as_deref().unwrap_or("");
            let fid = f.format_id.as_deref().unwrap_or("");
            let note = f.format_note.as_deref().unwrap_or("").to_lowercase();

            if ext == "mhtml" || proto == "mhtml" || fid.contains("sb") || note.contains("storyboard") {
                return false;
            }
            true
        })
        .collect();

    // 2. EXTRACT AND NORMALIZE VIDEO TRACKS
    // Group by unique (resolution, fps, codec, is_hdr) and keep best quality
    let mut video_groups: HashMap<(String, u32, String, bool), (RawYtDlpFormat, u64)> = HashMap::new();

    for f in valid_formats.iter() {
        let vcodec_raw = f.vcodec.as_deref().unwrap_or("");
        if vcodec_raw.is_empty() || vcodec_raw == "none" {
            continue;
        }

        let height = f.height.unwrap_or(0);
        let width = f.width.unwrap_or(0);
        if height == 0 && width == 0 {
            continue;
        }

        let resolution = if width > 0 && height > 0 {
            format!("{}x{}", width, height)
        } else {
            format!("{}p", height)
        };

        let fps = f.fps.unwrap_or(30.0);
        let fps_round = fps.round() as u32;
        let norm_codec = normalize_video_codec(vcodec_raw);

        // HDR Detection
        let dr = f.dynamic_range.as_deref().unwrap_or("").to_uppercase();
        let cp = f.color_primaries.as_deref().unwrap_or("").to_lowercase();
        let fnote = f.format_note.as_deref().unwrap_or("").to_uppercase();
        let is_hdr = dr.contains("HDR") || dr.contains("HLG") || dr.contains("PQ") || cp.contains("bt2020") || fnote.contains("HDR");

        let key = (resolution.clone(), fps_round, norm_codec.clone(), is_hdr);

        // Bitrate / quality metric for deduplication
        let quality_score = f.filesize
            .or(f.filesize_approx)
            .or_else(|| f.tbr.map(|t| (t * 1000.0) as u64))
            .or_else(|| f.vbr.map(|v| (v * 1000.0) as u64))
            .unwrap_or(0);

        if let Some((_, existing_score)) = video_groups.get(&key) {
            if quality_score > *existing_score {
                video_groups.insert(key, (f.clone(), quality_score));
            }
        } else {
            video_groups.insert(key, (f.clone(), quality_score));
        }
    }

    let mut video_tracks: Vec<VideoTrack> = video_groups
        .into_iter()
        .map(|((resolution, fps_round, norm_codec, is_hdr), (f, _))| {
            let height = f.height.unwrap_or(0);
            let ext = f.ext.as_deref().unwrap_or("");
            let container = if ext == "mp4" {
                "mp4".to_string()
            } else if ext == "webm" {
                "webm".to_string()
            } else if norm_codec == "h264" {
                "mp4".to_string()
            } else {
                "webm".to_string()
            };

            let fps_val = f.fps.unwrap_or(fps_round as f64);
            let fps_str = if fps_round > 30 {
                format!("{}", fps_round)
            } else {
                "".to_string()
            };

            let hdr_str = if is_hdr { " HDR" } else { "" };
            let label = if height > 0 {
                format!("{}p{}{}", height, fps_str, hdr_str)
            } else {
                format!("{}{}", resolution, hdr_str)
            };

            VideoTrack {
                format_id: f.format_id.unwrap_or_default(),
                resolution,
                label,
                fps: Some(fps_val),
                codec: norm_codec,
                container,
                filesize_bytes: f.filesize.or(f.filesize_approx),
                is_hdr,
            }
        })
        .collect();

    // Sort video tracks: highest resolution first, then highest fps, then AV1 > VP9 > H264
    video_tracks.sort_by(|a, b| {
        let h_a: u32 = a.resolution.split('x').nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        let h_b: u32 = b.resolution.split('x').nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);

        h_b.cmp(&h_a)
            .then_with(|| b.fps.unwrap_or(0.0).partial_cmp(&a.fps.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| a.codec.cmp(&b.codec))
    });

    // 3. EXTRACT AND NORMALIZE AUDIO TRACKS
    // Keep distinct highest-quality streams per (codec, language, role) to eliminate duplicate synthetic tiers
    let mut audio_groups: HashMap<(String, String, String), RawYtDlpFormat> = HashMap::new();

    for f in valid_formats.iter() {
        let acodec_raw = f.acodec.as_deref().unwrap_or("");
        let vcodec_raw = f.vcodec.as_deref().unwrap_or("");

        // Audio-only streams
        if acodec_raw.is_empty() || acodec_raw == "none" {
            continue;
        }
        if !vcodec_raw.is_empty() && vcodec_raw != "none" {
            continue; // Skip muxed preview formats, keep raw DASH streams
        }

        let norm_codec = normalize_audio_codec(acodec_raw);
        let lang_code = f.language.as_deref().unwrap_or("en").to_lowercase();
        let role = parse_audio_role(f.format_note.as_deref(), f.format_id.as_deref());

        let key = (norm_codec, lang_code, role);

        let bitrate = f.abr.or(f.tbr).unwrap_or(0.0);

        if let Some(existing) = audio_groups.get(&key) {
            let existing_bitrate = existing.abr.or(existing.tbr).unwrap_or(0.0);
            if bitrate > existing_bitrate {
                audio_groups.insert(key, f.clone());
            }
        } else {
            audio_groups.insert(key, f.clone());
        }
    }

    let mut audio_tracks: Vec<AudioTrack> = audio_groups
        .into_iter()
        .map(|((norm_codec, lang_code, role), f)| {
            let container = if norm_codec == "opus" {
                "webm".to_string()
            } else {
                "m4a".to_string()
            };

            let nominal_bitrate_kbps = f.abr.or(f.tbr);
            let sample_rate_hz = f.asr.or(Some(if norm_codec == "opus" { 48000 } else { 44100 }));
            let channels = f.audio_channels;
            let language_label = resolve_language_label(&lang_code);

            AudioTrack {
                format_id: f.format_id.unwrap_or_default(),
                language: lang_code,
                language_label,
                role,
                codec: norm_codec,
                container,
                nominal_bitrate_kbps,
                sample_rate_hz,
                channels,
                is_default: false, // will assign to best stream below
            }
        })
        .collect();

    // Sort audio tracks: highest bitrate first, then Opus before AAC
    audio_tracks.sort_by(|a, b| {
        b.nominal_bitrate_kbps
            .unwrap_or(0.0)
            .partial_cmp(&a.nominal_bitrate_kbps.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.codec.cmp(&b.codec))
    });

    // Mark the highest bitrate original/English track as default
    if let Some(best) = audio_tracks.iter_mut().find(|a| a.role == "original") {
        best.is_default = true;
    } else if let Some(first) = audio_tracks.first_mut() {
        first.is_default = true;
    }

    NormalizedManifest {
        video_id,
        title,
        duration_seconds,
        thumbnail_url,
        video_tracks,
        audio_tracks,
    }
}

/// Tauri command to extract and normalize a YouTube media manifest.
#[tauri::command]
pub async fn extract_manifest(
    url: String,
    cookie_path: Option<String>,
) -> Result<NormalizedManifest, String> {
    if url.trim().is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    let sidecar_manager = SidecarManager::default_manager();
    let yt_dlp_bin = sidecar_manager.resolve_yt_dlp();

    let mut cmd = Command::new(&yt_dlp_bin);
    cmd.args(["--dump-json", "--no-playlist", "--skip-download"]);

    if let Some(cookies) = cookie_path {
        if !cookies.trim().is_empty() {
            cmd.arg("--cookies").arg(cookies);
        }
    }

    cmd.arg(&url);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp at {:?}: {}", yt_dlp_bin, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp extraction failed: {}", stderr.trim()));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let raw: RawYtDlpManifest = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Failed to deserialize yt-dlp JSON: {}", e))?;

    Ok(normalize_manifest(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_manifest_filters_storyboards_and_deduplicates() {
        let raw_json = r#"{
            "id": "test_video_123",
            "title": "PulseStream Zero-Transcoding Test",
            "duration": 180.5,
            "thumbnail": "https://img.youtube.com/vi/test/maxres.jpg",
            "formats": [
                {
                    "format_id": "sb0",
                    "ext": "mhtml",
                    "protocol": "mhtml",
                    "vcodec": "none",
                    "acodec": "none",
                    "format_note": "storyboard"
                },
                {
                    "format_id": "137",
                    "ext": "mp4",
                    "vcodec": "avc1.640028",
                    "acodec": "none",
                    "width": 1920,
                    "height": 1080,
                    "fps": 30.0,
                    "filesize": 50000000,
                    "dynamic_range": "SDR"
                },
                {
                    "format_id": "399",
                    "ext": "webm",
                    "vcodec": "av01.0.08m.08",
                    "acodec": "none",
                    "width": 1920,
                    "height": 1080,
                    "fps": 60.0,
                    "filesize": 60000000,
                    "dynamic_range": "HDR"
                },
                {
                    "format_id": "248",
                    "ext": "webm",
                    "vcodec": "vp09.00.51.08",
                    "acodec": "none",
                    "width": 1920,
                    "height": 1080,
                    "fps": 60.0,
                    "filesize": 55000000,
                    "dynamic_range": "HDR"
                },
                {
                    "format_id": "251",
                    "ext": "webm",
                    "vcodec": "none",
                    "acodec": "opus",
                    "abr": 160.0,
                    "asr": 48000,
                    "language": "en",
                    "format_note": "original"
                },
                {
                    "format_id": "250",
                    "ext": "webm",
                    "vcodec": "none",
                    "acodec": "opus",
                    "abr": 70.0,
                    "asr": 48000,
                    "language": "en",
                    "format_note": "original"
                },
                {
                    "format_id": "140",
                    "ext": "m4a",
                    "vcodec": "none",
                    "acodec": "mp4a.40.2",
                    "abr": 128.0,
                    "asr": 44100,
                    "language": "en"
                }
            ]
        }"#;

        let raw: RawYtDlpManifest = serde_json::from_str(raw_json).unwrap();
        let manifest = normalize_manifest(raw);

        assert_eq!(manifest.video_id, "test_video_123");
        assert_eq!(manifest.title, "PulseStream Zero-Transcoding Test");

        // Storyboard sb0 must be filtered out
        assert!(!manifest.video_tracks.iter().any(|v| v.format_id == "sb0"));

        // Video tracks: should contain 1080p60 HDR (AV1), 1080p60 HDR (VP9), 1080p (H264)
        assert_eq!(manifest.video_tracks.len(), 3);
        let av1 = manifest.video_tracks.iter().find(|v| v.codec == "av1").unwrap();
        assert_eq!(av1.resolution, "1920x1080");
        assert_eq!(av1.fps, Some(60.0));
        assert!(av1.is_hdr);
        assert_eq!(av1.container, "webm");

        let h264 = manifest.video_tracks.iter().find(|v| v.codec == "h264").unwrap();
        assert_eq!(h264.container, "mp4");
        assert!(!h264.is_hdr);

        // Audio tracks: should deduplicate synthetic tiers (keep 160k Opus, drop 70k Opus, keep 128k AAC)
        assert_eq!(manifest.audio_tracks.len(), 2);
        let opus = manifest.audio_tracks.iter().find(|a| a.codec == "opus").unwrap();
        assert_eq!(opus.format_id, "251");
        assert_eq!(opus.nominal_bitrate_kbps, Some(160.0));
        assert_eq!(opus.language, "en");
        assert_eq!(opus.language_label, "English");
        assert_eq!(opus.role, "original");
        assert!(opus.is_default);

        let aac = manifest.audio_tracks.iter().find(|a| a.codec == "aac").unwrap();
        assert_eq!(aac.format_id, "140");
        assert_eq!(aac.nominal_bitrate_kbps, Some(128.0));
        assert_eq!(aac.container, "m4a");
    }
}
