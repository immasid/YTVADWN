use crate::sidecar::SidecarManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrack {
    pub format_id: String,
    pub resolution: String,
    pub label: String,
    pub fps: Option<f64>,
    pub codec: String,     // 'av1' | 'vp9' | 'h264' | string
    pub container: String, // 'webm' | 'mp4'
    pub filesize_bytes: Option<u64>,
    pub is_hdr: bool,
    #[serde(default)]
    pub direct_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub format_id: String,
    pub language: String, // ISO string e.g. "en"
    pub language_label: String,
    pub role: String,      // 'original' | 'dub' | 'descriptive' | 'unspecified'
    pub codec: String,     // 'opus' | 'aac' | string
    pub container: String, // 'webm' | 'm4a'
    pub nominal_bitrate_kbps: Option<f64>,
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u32>,
    pub is_default: bool,
    #[serde(default)]
    pub direct_url: Option<String>,
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
    pub url: Option<String>,
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

            if ext == "mhtml"
                || proto == "mhtml"
                || fid.contains("sb")
                || note.contains("storyboard")
            {
                return false;
            }
            true
        })
        .collect();

    // 2. EXTRACT AND NORMALIZE VIDEO TRACKS
    // Group by unique (resolution, fps, codec, is_hdr) and keep best quality
    let mut video_groups: HashMap<(String, u32, String, bool), (RawYtDlpFormat, u64)> =
        HashMap::new();

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
        let is_hdr = dr.contains("HDR")
            || dr.contains("HLG")
            || dr.contains("PQ")
            || cp.contains("bt2020")
            || fnote.contains("HDR");

        let key = (resolution.clone(), fps_round, norm_codec.clone(), is_hdr);

        // Bitrate / quality metric for deduplication
        let quality_score = f
            .filesize
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
                direct_url: f.url.clone(),
            }
        })
        .collect();

    // Sort video tracks: highest resolution first, then highest fps, then AV1 > VP9 > H264
    video_tracks.sort_by(|a, b| {
        let h_a: u32 = a
            .resolution
            .split('x')
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let h_b: u32 = b
            .resolution
            .split('x')
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        h_b.cmp(&h_a)
            .then_with(|| {
                b.fps
                    .unwrap_or(0.0)
                    .partial_cmp(&a.fps.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
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
            let sample_rate_hz = f
                .asr
                .or(Some(if norm_codec == "opus" { 48000 } else { 44100 }));
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
                direct_url: f.url.clone(),
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

/// Extracts the 11-character video ID from common YouTube URL formats.
pub fn extract_video_id(input: &str) -> Option<String> {
    let s = input.trim();
    if s.len() == 11 && !s.contains('/') && !s.contains('?') && !s.contains('&') {
        return Some(s.to_string());
    }

    if let Some(pos) = s.find("v=") {
        let after = &s[pos + 2..];
        let id: String = after
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if id.len() == 11 {
            return Some(id);
        }
    }

    if let Some(pos) = s.find("youtu.be/") {
        let after = &s[pos + 9..];
        let id: String = after
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if id.len() == 11 {
            return Some(id);
        }
    }

    if let Some(pos) = s.find("/shorts/") {
        let after = &s[pos + 8..];
        let id: String = after
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if id.len() == 11 {
            return Some(id);
        }
    }

    None
}

/// Native Rust YouTube manifest extractor using InnerTube VisionOS API.
/// Runs without external processes, Python, or command-line dependencies.
pub async fn extract_manifest_native(video_id: &str) -> Result<NormalizedManifest, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // 1. First visit the watch page to establish session cookies and extract visitorData / signatureTimestamp (sts)
    let watch_url = format!("https://www.youtube.com/watch?v={}", video_id);
    let watch_resp = client
        .get(&watch_url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch YouTube watch page: {}", e))?;

    let html = watch_resp.text().await.unwrap_or_default();

    let visitor_data = if let Some(pos) = html.find("VISITOR_DATA\":\"") {
        let after = &html[pos + 15..];
        after.split('"').next().map(|s| s.to_string())
    } else if let Some(pos) = html.find("visitorData\":\"") {
        let after = &html[pos + 14..];
        after.split('"').next().map(|s| s.to_string())
    } else {
        None
    };

    let sts = if let Some(pos) = html.find("\"sts\":") {
        let after = &html[pos + 6..];
        let num_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        num_str.parse::<u64>().unwrap_or(20717)
    } else {
        20717
    };

    // 2. Query InnerTube player API with VisionOS context, visitorData, and signatureTimestamp
    let mut client_obj = serde_json::json!({
        "clientName": "VISIONOS",
        "clientVersion": "1.02",
        "deviceMake": "Apple",
        "deviceModel": "RealityDevice17,1",
        "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        "osName": "visionOS",
        "osVersion": "26.5.23O471",
        "hl": "en",
        "timeZone": "UTC",
        "utcOffsetMinutes": 0
    });

    if let Some(ref vd) = visitor_data {
        client_obj["visitorData"] = serde_json::Value::String(vd.clone());
    }

    let payload = serde_json::json!({
        "context": {
            "client": client_obj
        },
        "videoId": video_id,
        "playbackContext": {
            "contentPlaybackContext": {
                "html5Preference": "HTML5_PREF_WANTS",
                "signatureTimestamp": sts
            }
        },
        "contentCheckOk": true,
        "racyCheckOk": true
    });

    let mut req = client
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15")
        .header("X-YouTube-Client-Name", "101")
        .header("X-YouTube-Client-Version", "1.02")
        .header("Origin", "https://www.youtube.com")
        .json(&payload);

    if let Some(ref vd) = visitor_data {
        req = req.header("X-Goog-Visitor-Id", vd);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Network error querying YouTube player API: {}", e))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse YouTube player response: {}", e))?;

    if let Some(status) = body
        .get("playabilityStatus")
        .and_then(|p| p.get("status"))
        .and_then(|s| s.as_str())
    {
        if status != "OK" {
            let reason = body
                .get("playabilityStatus")
                .and_then(|p| p.get("reason"))
                .and_then(|r| r.as_str())
                .unwrap_or(status);
            return Err(format!("YouTube stream unplayable: {}", reason));
        }
    }

    let title = body
        .get("videoDetails")
        .and_then(|v| v.get("title"))
        .and_then(|t| t.as_str())
        .unwrap_or("YouTube Media")
        .to_string();

    let duration_seconds = body
        .get("videoDetails")
        .and_then(|v| v.get("lengthSeconds"))
        .and_then(|l| l.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let thumbnail_url = format!("https://i.ytimg.com/vi/{}/maxresdefault.jpg", video_id);

    let mut raw_formats: Vec<RawYtDlpFormat> = Vec::new();

    let sd = body.get("streamingData");
    let formats = sd.and_then(|s| s.get("formats")).and_then(|f| f.as_array());
    let adaptive = sd
        .and_then(|s| s.get("adaptiveFormats"))
        .and_then(|f| f.as_array());

    let all_streams = formats
        .into_iter()
        .flatten()
        .chain(adaptive.into_iter().flatten());

    for item in all_streams {
        let itag = match item.get("itag").and_then(|i| i.as_i64()) {
            Some(i) => i.to_string(),
            None => continue,
        };

        let mime = item.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
        let url = item
            .get("url")
            .and_then(|u| u.as_str())
            .map(|s| s.to_string());

        let is_video = mime.starts_with("video/");
        let is_audio = mime.starts_with("audio/");

        let ext = if mime.contains("webm") {
            "webm".to_string()
        } else if mime.contains("mp4") || mime.contains("m4a") {
            if is_audio {
                "m4a".to_string()
            } else {
                "mp4".to_string()
            }
        } else {
            "mp4".to_string()
        };

        let (vcodec, acodec) = if is_video {
            let codec = if let Some(pos) = mime.find("codecs=\"") {
                let after = &mime[pos + 8..];
                after.split('"').next().unwrap_or("h264")
            } else {
                "h264"
            };
            (Some(codec.to_string()), None)
        } else if is_audio {
            let codec = if let Some(pos) = mime.find("codecs=\"") {
                let after = &mime[pos + 8..];
                after.split('"').next().unwrap_or("opus")
            } else {
                "opus"
            };
            (None, Some(codec.to_string()))
        } else {
            (None, None)
        };

        let width = item.get("width").and_then(|w| w.as_u64()).map(|w| w as u32);
        let height = item
            .get("height")
            .and_then(|h| h.as_u64())
            .map(|h| h as u32);
        let fps = item.get("fps").and_then(|f| f.as_f64());
        let filesize = item
            .get("contentLength")
            .and_then(|c| c.as_str())
            .and_then(|s| s.parse::<u64>().ok());
        let bitrate = item
            .get("bitrate")
            .and_then(|b| b.as_f64())
            .map(|b| b / 1000.0);
        let asr = item
            .get("audioSampleRate")
            .and_then(|a| a.as_str())
            .and_then(|s| s.parse::<u32>().ok());
        let audio_channels = item
            .get("audioChannels")
            .and_then(|c| c.as_u64())
            .map(|c| c as u32);

        raw_formats.push(RawYtDlpFormat {
            format_id: Some(itag),
            ext: Some(ext),
            vcodec,
            acodec,
            width,
            height,
            fps,
            filesize,
            filesize_approx: None,
            abr: if is_audio { bitrate } else { None },
            vbr: if is_video { bitrate } else { None },
            tbr: bitrate,
            asr,
            audio_channels,
            language: Some("en".to_string()),
            format_note: if is_video {
                height.map(|h| format!("{}p", h))
            } else {
                Some("Audio".to_string())
            },
            dynamic_range: Some("SDR".to_string()),
            color_primaries: None,
            protocol: Some("https".to_string()),
            url,
        });
    }

    if raw_formats.is_empty() {
        return Err("No playable video or audio streams found in response".to_string());
    }

    let raw_manifest = RawYtDlpManifest {
        id: Some(video_id.to_string()),
        title: Some(title),
        duration: Some(duration_seconds),
        thumbnail: Some(thumbnail_url),
        formats: Some(raw_formats),
    };

    Ok(normalize_manifest(raw_manifest))
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

    // 1. If yt-dlp binary is available on the system, try it first
    if yt_dlp_bin.is_file() {
        let mut cmd = Command::new(&yt_dlp_bin);
        cmd.args(["--dump-json", "--no-playlist", "--skip-download"]);

        if let Some(ref cookies) = cookie_path {
            if !cookies.trim().is_empty() {
                cmd.arg("--cookies").arg(cookies);
            }
        }

        cmd.arg(&url);

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout_str = String::from_utf8_lossy(&output.stdout);
                if let Ok(raw) = serde_json::from_str::<RawYtDlpManifest>(&stdout_str) {
                    return Ok(normalize_manifest(raw));
                }
            }
        }
    }

    // 2. Native direct extraction fallback (Android or when yt-dlp is unavailable/challenged)
    if let Some(video_id) = extract_video_id(&url) {
        match extract_manifest_native(&video_id).await {
            Ok(manifest) => return Ok(manifest),
            Err(e) => {
                if !yt_dlp_bin.is_file() {
                    return Err(format!("Extraction failed: {}", e));
                }
            }
        }
    }

    Err("Failed to extract YouTube manifest via yt-dlp and native extractor. Please check the URL or configure cookies in Settings.".to_string())
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
        let av1 = manifest
            .video_tracks
            .iter()
            .find(|v| v.codec == "av1")
            .unwrap();
        assert_eq!(av1.resolution, "1920x1080");
        assert_eq!(av1.fps, Some(60.0));
        assert!(av1.is_hdr);
        assert_eq!(av1.container, "webm");

        let h264 = manifest
            .video_tracks
            .iter()
            .find(|v| v.codec == "h264")
            .unwrap();
        assert_eq!(h264.container, "mp4");
        assert!(!h264.is_hdr);

        // Audio tracks: should deduplicate synthetic tiers (keep 160k Opus, drop 70k Opus, keep 128k AAC)
        assert_eq!(manifest.audio_tracks.len(), 2);
        let opus = manifest
            .audio_tracks
            .iter()
            .find(|a| a.codec == "opus")
            .unwrap();
        assert_eq!(opus.format_id, "251");
        assert_eq!(opus.nominal_bitrate_kbps, Some(160.0));
        assert_eq!(opus.language, "en");
        assert_eq!(opus.language_label, "English");
        assert_eq!(opus.role, "original");
        assert!(opus.is_default);

        let aac = manifest
            .audio_tracks
            .iter()
            .find(|a| a.codec == "aac")
            .unwrap();
        assert_eq!(aac.format_id, "140");
        assert_eq!(aac.nominal_bitrate_kbps, Some(128.0));
        assert_eq!(aac.container, "m4a");
    }

    #[test]
    fn test_extract_video_id() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/watch?v=6x5xtNhOts0&t=186s"),
            Some("6x5xtNhOts0".to_string())
        );
        assert_eq!(
            extract_video_id("https://youtu.be/6x5xtNhOts0?si=abcdef123"),
            Some("6x5xtNhOts0".to_string())
        );
        assert_eq!(
            extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_video_id("6x5xtNhOts0"),
            Some("6x5xtNhOts0".to_string())
        );
        assert_eq!(extract_video_id("not-a-valid-url"), None);
    }

    #[tokio::test]
    async fn test_live_native_extraction() {
        let res = extract_manifest_native("6x5xtNhOts0").await;
        println!(
            "Live extraction result for 6x5xtNhOts0: {:?}",
            res.as_ref()
                .map(|m| (&m.title, m.video_tracks.len(), m.audio_tracks.len()))
        );
        if let Ok(m) = res {
            assert!(
                !m.video_tracks.is_empty(),
                "video tracks should not be empty"
            );
            assert!(
                !m.audio_tracks.is_empty(),
                "audio tracks should not be empty"
            );
            println!(
                "First video track direct_url: {:?}",
                m.video_tracks[0].direct_url.is_some()
            );
            println!(
                "First audio track direct_url: {:?}",
                m.audio_tracks[0].direct_url.is_some()
            );
        }
    }
}
