use std::sync::Arc;
use tauri::Manager;

pub mod diagnostics;
pub mod downloader;
pub mod extractor;
pub mod history;
pub mod muxer;
pub mod queue;
pub mod server;
pub mod sidecar;
pub mod verifier;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let queue_manager = Arc::new(queue::QueueManager::new(2));
            queue_manager.start_scheduler(app.handle().clone());
            app.manage(queue_manager);

            // Spawn loopback daemon on 127.0.0.1:48125 for browser extension handoff
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                server::start_server(app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            extractor::extract_manifest,
            sidecar::check_yt_dlp_update,
            sidecar::get_sidecar_status,
            downloader::start_download,
            downloader::get_default_download_directory,
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
