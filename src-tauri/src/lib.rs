pub mod sidecar;
pub mod extractor;
pub mod muxer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            extractor::extract_manifest,
            sidecar::check_yt_dlp_update,
            sidecar::get_sidecar_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
