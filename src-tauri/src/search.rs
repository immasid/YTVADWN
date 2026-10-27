use crate::sidecar::SidecarManager;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaCandidate {
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub channel_title: Option<String>,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub view_count_approx: Option<u64>,
    pub upload_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawYtDlpSearchEntry {
    id: Option<String>,
    url: Option<String>,
    title: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    view_count: Option<u64>,
    upload_date: Option<String>,
    thumbnails: Option<Vec<RawYtDlpThumbnail>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RawYtDlpThumbnail {
    url: Option<String>,
    height: Option<u32>,
    width: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct RawYtDlpSearchPlaylist {
    entries: Option<Vec<Option<RawYtDlpSearchEntry>>>,
}

/// Parses yt-dlp `--dump-single-json --flat-playlist` output.
/// Gracefully tolerates missing metadata, null entries, or partial fields.
pub fn parse_ytdlp_search_json(json_str: &str) -> Result<Vec<MediaCandidate>, String> {
    let playlist: RawYtDlpSearchPlaylist = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse yt-dlp search JSON: {}", e))?;

    let mut candidates = Vec::new();

    if let Some(entries) = playlist.entries {
        for entry_opt in entries {
            if let Some(entry) = entry_opt {
                let video_id = match entry.id {
                    Some(ref id) if !id.trim().is_empty() => id.trim().to_string(),
                    _ => continue,
                };

                let title = entry.title.unwrap_or_else(|| "Untitled Video".to_string());
                let url = entry
                    .url
                    .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", video_id));
                let channel_title = entry.channel.or(entry.uploader);

                // Select the highest-width thumbnail or fall back to standard YouTube thumbnail URL
                let thumbnail_url = entry
                    .thumbnails
                    .and_then(|thumbs| {
                        thumbs
                            .into_iter()
                            .filter_map(|t| t.url.map(|u| (t.width.unwrap_or(0), u)))
                            .max_by_key(|(w, _)| *w)
                            .map(|(_, u)| u)
                    })
                    .or_else(|| {
                        Some(format!("https://img.youtube.com/vi/{}/hqdefault.jpg", video_id))
                    });

                candidates.push(MediaCandidate {
                    video_id,
                    url,
                    title,
                    channel_title,
                    duration_seconds: entry.duration,
                    thumbnail_url,
                    view_count_approx: entry.view_count,
                    upload_date: entry.upload_date,
                });
            }
        }
    }

    Ok(candidates)
}

/// Executes yt-dlp flat search with the query and bounded limit.
pub async fn search_youtube(query: &str, limit: usize) -> Result<Vec<MediaCandidate>, String> {
    let query_trimmed = query.trim();
    if query_trimmed.is_empty() {
        return Err("Search query cannot be empty".to_string());
    }

    let limit_bounded = limit.clamp(1, 20);
    let search_spec = format!("ytsearch{}:{}", limit_bounded, query_trimmed);

    let sidecar_manager = SidecarManager::default_manager();
    let yt_dlp_bin = sidecar_manager.resolve_yt_dlp();

    if !yt_dlp_bin.exists() {
        return Err("yt-dlp sidecar binary is not available on this system".to_string());
    }

    let output = Command::new(&yt_dlp_bin)
        .args([
            "--dump-single-json",
            "--flat-playlist",
            "--no-warnings",
            "--no-check-certificates",
            &search_spec,
        ])
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp search: {}", e))?;

    if !output.status.success() {
        let err_text = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "yt-dlp search failed (exit code {:?}): {}",
            output.status.code(),
            err_text
        ));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    parse_ytdlp_search_json(&stdout_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ytdlp_search_json_valid_fixture() {
        let fixture = r#"{
            "id": "Samjhawan",
            "title": "Samjhawan",
            "_type": "playlist",
            "entries": [
                {
                    "_type": "url",
                    "id": "H2f7MZaw3Yo",
                    "url": "https://www.youtube.com/watch?v=H2f7MZaw3Yo",
                    "title": "Samjhawan Lyric Video",
                    "channel": "Sony Music India",
                    "duration": 266,
                    "view_count": 479862262,
                    "upload_date": null,
                    "thumbnails": [
                        {"url": "https://example.com/small.jpg", "width": 360, "height": 202},
                        {"url": "https://example.com/large.jpg", "width": 720, "height": 404}
                    ]
                },
                {
                    "_type": "url",
                    "id": "yQ6d627OZig",
                    "title": "Samjhawan Lyrics",
                    "uploader": "seventyskye",
                    "duration": 269.0,
                    "view_count": null,
                    "thumbnails": null
                }
            ]
        }"#;

        let results = parse_ytdlp_search_json(fixture).expect("Failed to parse fixture");
        assert_eq!(results.len(), 2);

        // Candidate 0
        assert_eq!(results[0].video_id, "H2f7MZaw3Yo");
        assert_eq!(results[0].title, "Samjhawan Lyric Video");
        assert_eq!(results[0].channel_title.as_deref(), Some("Sony Music India"));
        assert_eq!(results[0].duration_seconds, Some(266.0));
        assert_eq!(results[0].thumbnail_url.as_deref(), Some("https://example.com/large.jpg"));
        assert_eq!(results[0].view_count_approx, Some(479862262));
        assert!(results[0].upload_date.is_none());

        // Candidate 1 (missing thumbnails and views, uses uploader fallback)
        assert_eq!(results[1].video_id, "yQ6d627OZig");
        assert_eq!(results[1].channel_title.as_deref(), Some("seventyskye"));
        assert_eq!(
            results[1].thumbnail_url.as_deref(),
            Some("https://img.youtube.com/vi/yQ6d627OZig/hqdefault.jpg")
        );
        assert_eq!(results[1].url, "https://www.youtube.com/watch?v=yQ6d627OZig");
    }

    #[test]
    fn test_parse_ytdlp_search_json_empty_and_null_entries() {
        let fixture = r#"{
            "id": "Empty",
            "entries": [null, {"id": ""}, {"id": "valid123", "title": "Valid"}]
        }"#;

        let results = parse_ytdlp_search_json(fixture).expect("Failed to parse fixture");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].video_id, "valid123");
        assert_eq!(results[0].title, "Valid");
    }

    #[tokio::test]
    async fn test_live_search_smoke() {
        // Runs real yt-dlp search if sidecar binary exists
        let res = search_youtube("Samjhawan", 2).await;
        if let Ok(candidates) = res {
            assert!(!candidates.is_empty(), "Live search should return at least 1 candidate");
            assert!(!candidates[0].video_id.is_empty());
            assert!(!candidates[0].url.is_empty());
            assert!(candidates[0].url.starts_with("https://"));
        }
    }
}
