use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Emitter};

use crate::verifier::{OperationAudit, VerificationResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub id: String,
    pub video_id: String,
    pub title: String,
    pub thumbnail_url: String,
    pub completed_at: i64,
    pub file_path: String,
    pub file_size_bytes: u64,
    pub media_type: String, // "video" | "audio"
    pub video_codec: Option<String>,
    pub audio_codec: String,
    pub container: String,
    pub audit: OperationAudit,
    pub verification: VerificationResult,
}

/// Resolves the storage path for `history.json`.
pub fn get_history_file_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|h| h.join(".local/share/pulsestream"))
                .unwrap_or_else(|| PathBuf::from("./data"))
        });

    let _ = fs::create_dir_all(&dir);
    dir.join("history.json")
}

// Global in-process mutex to prevent concurrent file write collisions
static HISTORY_MUTEX: Mutex<()> = Mutex::new(());

/// Loads the history records from disk.
pub fn load_history_from_path(file_path: &Path) -> Vec<HistoryRecord> {
    let _lock = HISTORY_MUTEX.lock().unwrap();
    if !file_path.exists() {
        return Vec::new();
    }

    match fs::read_to_string(file_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Saves the history records to disk.
pub fn save_history_to_path(file_path: &Path, records: &[HistoryRecord]) -> Result<(), String> {
    let _lock = HISTORY_MUTEX.lock().unwrap();
    if let Some(parent) = file_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let json = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;

    fs::write(file_path, json)
        .map_err(|e| format!("Failed to write history to {:?}: {}", file_path, e))?;

    Ok(())
}

/// Appends a new history record to disk.
pub fn add_history_record(app: &AppHandle, record: HistoryRecord) -> Result<(), String> {
    let path = get_history_file_path(app);
    let mut records = load_history_from_path(&path);

    // Filter out if record with same ID already exists, then prepend new record
    records.retain(|r| r.id != record.id);
    records.insert(0, record);

    save_history_to_path(&path, &records)?;
    let _ = app.emit("history-updated", ());
    Ok(())
}

/// Tauri command: returns all completed download history records.
#[tauri::command]
pub async fn get_history(app: AppHandle) -> Result<Vec<HistoryRecord>, String> {
    let path = get_history_file_path(&app);
    Ok(load_history_from_path(&path))
}

/// Tauri command: clears all history records.
#[tauri::command]
pub async fn clear_history(app: AppHandle) -> Result<(), String> {
    let path = get_history_file_path(&app);
    save_history_to_path(&path, &[])?;
    let _ = app.emit("history-updated", ());
    Ok(())
}

/// Tauri command: deletes a specific history record by ID.
#[tauri::command]
pub async fn delete_history_item(app: AppHandle, id: String) -> Result<(), String> {
    let path = get_history_file_path(&app);
    let mut records = load_history_from_path(&path);
    records.retain(|r| r.id != id);
    save_history_to_path(&path, &records)?;
    let _ = app.emit("history-updated", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_record(id: &str) -> HistoryRecord {
        HistoryRecord {
            id: id.to_string(),
            video_id: "test12345".to_string(),
            title: "Test Video".to_string(),
            thumbnail_url: "https://example.com/thumb.jpg".to_string(),
            completed_at: 1710000000,
            file_path: "/tmp/test.mp4".to_string(),
            file_size_bytes: 1048576,
            media_type: "video".to_string(),
            video_codec: Some("h264".to_string()),
            audio_codec: "aac".to_string(),
            container: "mp4".to_string(),
            audit: OperationAudit {
                operation: "LosslessRemux".to_string(),
                executable: "ffmpeg".to_string(),
                arguments: vec!["-c".to_string(), "copy".to_string()],
                stream_copy: true,
                encoding_requested: false,
            },
            verification: VerificationResult {
                status: "verified".to_string(),
                policy_audit_passed: true,
                codec_match: true,
                dimensions_match: true,
                sample_rate_match: true,
                details: "Verified".to_string(),
                audit: None,
            },
        }
    }

    #[test]
    fn test_history_serialization() {
        let record = sample_record("rec1");
        let json = serde_json::to_string(&record).unwrap();
        assert!(json.contains(r#""id":"rec1""#));
        assert!(json.contains(r#""mediaType":"video""#));

        let parsed: HistoryRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "rec1");
        assert_eq!(parsed.video_codec.as_deref(), Some("h264"));
    }

    #[test]
    fn test_history_file_persistence() {
        let temp = tempfile::tempdir().unwrap();
        let history_file = temp.path().join("history.json");

        let rec1 = sample_record("rec1");
        let rec2 = sample_record("rec2");

        let records = vec![rec1.clone(), rec2.clone()];
        save_history_to_path(&history_file, &records).unwrap();

        let loaded = load_history_from_path(&history_file);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "rec1");
        assert_eq!(loaded[1].id, "rec2");

        // Delete rec1
        let mut filtered = loaded;
        filtered.retain(|r| r.id != "rec1");
        save_history_to_path(&history_file, &filtered).unwrap();

        let loaded_after = load_history_from_path(&history_file);
        assert_eq!(loaded_after.len(), 1);
        assert_eq!(loaded_after[0].id, "rec2");
    }
}
