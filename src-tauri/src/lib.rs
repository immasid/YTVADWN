use std::sync::Arc;
use tauri::Manager;

pub mod sidecar;
pub mod extractor;
pub mod muxer;
pub mod verifier;
pub mod downloader;
pub mod queue;
pub mod diagnostics;
pub mod history;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let queue_manager = Arc::new(queue::QueueManager::new(2));
            queue_manager.start_scheduler(app.handle().clone());
            app.manage(queue_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            extractor::extract_manifest,
            sidecar::check_yt_dlp_update,
            sidecar::get_sidecar_status,
            downloader::start_download,
            queue::enqueue_job,
            queue::cancel_job,
            queue::pause_queue,
            queue::resume_queue,
            queue::get_queue_items,
            queue::clear_completed_jobs,
            queue::get_session_settings,
            queue::update_session_settings,
            diagnostics::get_system_diagnostics,
            diagnostics::show_in_folder,
            history::get_history,
            history::clear_history,
            history::delete_history_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
