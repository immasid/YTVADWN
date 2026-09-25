use axum::{
    extract::State,
    http::{header, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tauri::{AppHandle, Emitter, Manager};
use tower_http::cors::CorsLayer;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HandoffPayload {
    pub url: String,
    pub title: Option<String>,
    pub cookies: Option<String>,
}

#[derive(Clone)]
pub struct ServerState {
    pub app: AppHandle,
}

/// Handler for `POST /handoff`
/// Brings the application window to the foreground and emits a `browser-handoff` event to the frontend.
pub async fn handle_handoff(
    State(state): State<ServerState>,
    Json(payload): Json<HandoffPayload>,
) -> impl IntoResponse {
    // 1. Bring desktop window to foreground
    if let Some(window) = state.app.get_webview_window("main") {
        let _ = window.show();
        #[cfg(desktop)]
        {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    // 2. Emit event to frontend
    let _ = state.app.emit("browser-handoff", payload.clone());

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "received",
            "url": payload.url
        })),
    )
}

/// Handler for `GET /ping`
/// Returns daemon readiness status for browser extension health checks.
pub async fn handle_ping() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ready",
            "version": "0.1.0"
        })),
    )
}

/// Builds the Axum router with security and CORS constraints.
pub fn build_router(app: AppHandle) -> Router {
    let state = ServerState { app };

    // Restrict CORS strictly to extension origins and local loopback
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT])
        .allow_origin(tower_http::cors::AllowOrigin::predicate(
            |origin: &HeaderValue, _| {
                if let Ok(s) = origin.to_str() {
                    s.starts_with("chrome-extension://")
                        || s.starts_with("moz-extension://")
                        || s.starts_with("http://127.0.0.1")
                        || s.starts_with("http://localhost")
                } else {
                    false
                }
            },
        ));

    Router::new()
        .route("/handoff", post(handle_handoff))
        .route("/ping", get(handle_ping))
        .layer(cors)
        .with_state(state)
}

/// Starts the loopback HTTP daemon bound exclusively to `127.0.0.1:48125`.
pub async fn start_server(app: AppHandle) {
    let addr = SocketAddr::from(([127, 0, 0, 1], 48125));
    let router = build_router(app);

    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            println!("[PulseStream] Loopback server bound to http://{}", addr);
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[PulseStream] Loopback server error: {}", e);
            }
        }
        Err(e) => {
            eprintln!(
                "[PulseStream] Failed to bind loopback daemon to {}: {}. Extension integration may be unavailable.",
                addr, e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handoff_payload_deserialization() {
        let json = r#"{
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "title": "Rick Astley",
            "cookies": "SID=abc; HSID=def;"
        }"#;

        let payload: HandoffPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        assert_eq!(payload.title.as_deref(), Some("Rick Astley"));
        assert_eq!(payload.cookies.as_deref(), Some("SID=abc; HSID=def;"));
    }

    #[test]
    fn test_handoff_payload_optional_fields() {
        let json = r#"{"url": "https://www.youtube.com/watch?v=test"}"#;
        let payload: HandoffPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.url, "https://www.youtube.com/watch?v=test");
        assert!(payload.title.is_none());
        assert!(payload.cookies.is_none());
    }
}
