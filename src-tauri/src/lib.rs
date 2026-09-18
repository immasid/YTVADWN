use std::sync::Arc;

pub mod sidecar;
pub mod extractor;
pub mod muxer;
pub mod verifier;
pub mod downloader;
pub mod queue;
pub mod diagnostics;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let queue_manager = Arc::new(queue::QueueManager::new(2));
    let qm_clone = Arc::clone(&queue_manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(queue_manager)
        .setup(move |app| {
            qm_clone.start_scheduler(app.handle().clone());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
