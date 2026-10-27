use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tower_http::cors::CorsLayer;

use crate::auth;
use crate::queue::QueueManager;
use crate::search::search_youtube;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HandoffPayload {
    pub url: String,
    pub title: Option<String>,
    pub cookies: Option<String>,
    #[serde(default)]
    pub focus_window: Option<bool>,
    pub client: Option<String>,
}

impl fmt::Debug for HandoffPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HandoffPayload")
            .field("url", &self.url)
            .field("title", &self.title)
            .field("cookies", &self.cookies.as_ref().map(|_| "[REDACTED]"))
            .field("focus_window", &self.focus_window)
            .field("client", &self.client)
            .finish()
    }
}

#[derive(Clone)]
pub struct ServerState {
    pub app: Option<AppHandle>,
    pub queue_manager: Arc<QueueManager>,
    pub auth_token: String,
}

/// Handler for `POST /handoff` (Unauthenticated for browser extension).
/// Stages URL into the desktop staging dock without focus-stealing by default.
pub async fn handle_handoff(
    State(state): State<ServerState>,
    Json(payload): Json<HandoffPayload>,
) -> impl IntoResponse {
    let url_trimmed = payload.url.trim();
    if url_trimmed.is_empty()
        || (!url_trimmed.starts_with("http://") && !url_trimmed.starts_with("https://"))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": "Invalid URL provided"
            })),
        );
    }

    if payload.focus_window == Some(true) {
        if let Some(ref app) = state.app {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                #[cfg(desktop)]
                {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        }
    }

    if let Some(ref app) = state.app {
        let _ = app.emit("browser-handoff", payload.clone());
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "received",
            "url": payload.url
        })),
    )
}

/// Handler for `GET /ping` (Unauthenticated daemon health check).
pub async fn handle_ping() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ready",
            "version": "0.1.0"
        })),
    )
}

// ---------------------------------------------------------------------------
// Authenticated API (/api/v1/*) Handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub limit: Option<usize>,
}

/// Handler for `POST /api/v1/search` (Bearer Auth Required).
pub async fn handle_api_search(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(req): Json<SearchRequest>,
) -> impl IntoResponse {
    if !auth::extract_and_verify_bearer(&headers, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "status": "error",
                "code": "AUTH_REQUIRED",
                "message": "Valid Bearer token required in Authorization header"
            })),
        );
    }

    match search_youtube(&req.query, req.limit.unwrap_or(5)).await {
        Ok(candidates) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "candidates": candidates
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": e
            })),
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRequest {
    pub url_or_id: String,
}

/// Handler for `POST /api/v1/manifest` (Bearer Auth Required).
pub async fn handle_api_manifest(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(req): Json<ManifestRequest>,
) -> impl IntoResponse {
    if !auth::extract_and_verify_bearer(&headers, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "status": "error",
                "code": "AUTH_REQUIRED",
                "message": "Valid Bearer token required in Authorization header"
            })),
        );
    }

    let target_url = if req.url_or_id.starts_with("http://")
        || req.url_or_id.starts_with("https://")
    {
        req.url_or_id
    } else {
        format!("https://www.youtube.com/watch?v={}", req.url_or_id)
    };

    match crate::extractor::extract_manifest(target_url, None).await {
        Ok(manifest) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "manifest": manifest
            })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": e
            })),
        ),
    }
}

/// Handler for `GET /api/v1/queue` (Bearer Auth Required).
pub async fn handle_api_get_queue(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !auth::extract_and_verify_bearer(&headers, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "status": "error",
                "code": "AUTH_REQUIRED",
                "message": "Valid Bearer token required in Authorization header"
            })),
        );
    }

    let items = state.queue_manager.get_items().await;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "success",
            "items": items
        })),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchQueueRequest {
    pub jobs: Vec<crate::downloader::DownloadJobRequest>,
}

/// Handler for `POST /api/v1/queue/batch` (Bearer Auth Required).
pub async fn handle_api_queue_batch(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(req): Json<BatchQueueRequest>,
) -> impl IntoResponse {
    if !auth::extract_and_verify_bearer(&headers, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "status": "error",
                "code": "AUTH_REQUIRED",
                "message": "Valid Bearer token required in Authorization header"
            })),
        );
    }

    if req.jobs.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "status": "error",
                "message": "No jobs provided in batch"
            })),
        );
    }

    let mut enqueued_ids = Vec::new();
    for job_req in req.jobs {
        let job_id = state
            .queue_manager
            .enqueue_opt(state.app.as_ref(), job_req)
            .await;
        enqueued_ids.push(job_id);
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "success",
            "enqueuedJobIds": enqueued_ids
        })),
    )
}

/// Handler for `POST /api/v1/queue/{id}/cancel` (Bearer Auth Required).
pub async fn handle_api_cancel_job(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    if !auth::extract_and_verify_bearer(&headers, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "status": "error",
                "code": "AUTH_REQUIRED",
                "message": "Valid Bearer token required in Authorization header"
            })),
        );
    }

    match state
        .queue_manager
        .cancel_opt(state.app.as_ref(), &job_id)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "message": format!("Job {} cancelled", job_id)
            })),
        ),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "status": "error",
                "message": e
            })),
        ),
    }
}

/// Handler for `GET /api/v1/capabilities` (Bearer Auth Required).
pub async fn handle_api_capabilities(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !auth::extract_and_verify_bearer(&headers, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "status": "error",
                "code": "AUTH_REQUIRED",
                "message": "Valid Bearer token required in Authorization header"
            })),
        );
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "success",
            "version": "0.1.0",
            "capabilities": {
                "search": true,
                "manifest": true,
                "batchQueue": true,
                "zeroTranscodeMuxing": true,
                "supportedContainers": ["auto", "mkv", "webm", "mp4"]
            }
        })),
    )
}

/// Builds the Axum router with CORS and authentication layers.
pub fn build_router(state: ServerState) -> Router {
    let client_header = HeaderName::from_static("x-pulsestream-client");

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            client_header,
        ])
        .allow_origin(tower_http::cors::AllowOrigin::predicate(
            |origin: &HeaderValue, _| {
                if let Ok(s) = origin.to_str() {
                    s.starts_with("chrome-extension://")
                        || s.starts_with("moz-extension://")
                        || s.starts_with("http://127.0.0.1")
                        || s.starts_with("http://localhost")
                        || s.starts_with("tauri://")
                } else {
                    false
                }
            },
        ));

    Router::new()
        // Unauthenticated browser-extension endpoints
        .route("/handoff", post(handle_handoff))
        .route("/ping", get(handle_ping))
        // Authenticated AI Control endpoints
        .route("/api/v1/search", post(handle_api_search))
        .route("/api/v1/manifest", post(handle_api_manifest))
        .route("/api/v1/queue", get(handle_api_get_queue))
        .route("/api/v1/queue/batch", post(handle_api_queue_batch))
        .route("/api/v1/queue/{id}/cancel", post(handle_api_cancel_job))
        .route("/api/v1/capabilities", get(handle_api_capabilities))
        .layer(cors)
        .with_state(state)
}

/// Starts the loopback HTTP daemon bound exclusively to `127.0.0.1:48125`.
pub async fn start_server(app: AppHandle, queue_manager: Arc<QueueManager>, auth_token: String) {
    let addr = SocketAddr::from(([127, 0, 0, 1], 48125));
    let state = ServerState {
        app: Some(app),
        queue_manager,
        auth_token,
    };
    let router = build_router(state);

    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            println!("[PulseStream] Loopback server bound to http://{}", addr);
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[PulseStream] Loopback server error: {}", e);
            }
        }
        Err(e) => {
            eprintln!(
                "[PulseStream] Failed to bind loopback daemon to {}: {}. Extension/AI integration may be unavailable.",
                addr, e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt; // for oneshot

    fn create_test_state(token: &str) -> ServerState {
        ServerState {
            app: None,
            queue_manager: Arc::new(QueueManager::new(2)),
            auth_token: token.to_string(),
        }
    }

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
        assert_eq!(payload.focus_window, None);
    }

    #[test]
    fn test_handoff_payload_cookie_redaction_in_debug() {
        let payload = HandoffPayload {
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
            title: Some("Test".to_string()),
            cookies: Some("SECRET_SESSION_TOKEN=12345".to_string()),
            focus_window: Some(false),
            client: Some("browser-extension".to_string()),
        };

        let debug_str = format!("{:?}", payload);
        assert!(!debug_str.contains("SECRET_SESSION_TOKEN"));
        assert!(debug_str.contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn test_unauthenticated_ping_and_handoff_preserved() {
        let state = create_test_state("secret_123");
        let app = build_router(state);

        // GET /ping should succeed with 200 without auth
        let req = axum::http::Request::builder()
            .method("GET")
            .uri("/ping")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // POST /handoff should succeed with 200 without auth (browser extension compatibility)
        let handoff_body = serde_json::json!({
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "title": "Test Title"
        });
        let req = axum::http::Request::builder()
            .method("POST")
            .uri("/handoff")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&handoff_body).unwrap()))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_api_v1_auth_enforcement() {
        let state = create_test_state("super_secret_token_abc");
        let app = build_router(state);

        // 1. Missing Authorization header -> 401
        let req = axum::http::Request::builder()
            .method("GET")
            .uri("/api/v1/capabilities")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        // 2. Invalid Bearer token -> 401
        let req = axum::http::Request::builder()
            .method("GET")
            .uri("/api/v1/capabilities")
            .header(header::AUTHORIZATION, "Bearer invalid_token")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

        // 3. Valid Bearer token -> 200 OK
        let req = axum::http::Request::builder()
            .method("GET")
            .uri("/api/v1/capabilities")
            .header(header::AUTHORIZATION, "Bearer super_secret_token_abc")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let body_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(body_json["status"], "success");
        assert_eq!(body_json["capabilities"]["search"], true);
    }

    #[tokio::test]
    async fn test_api_v1_queue_and_cancellation() {
        let state = create_test_state("token_xyz");
        let app = build_router(state);

        // Batch Enqueue Request
        let batch_body = serde_json::json!({
            "jobs": [
                {
                    "url": "https://www.youtube.com/watch?v=test1",
                    "title": "Item 1",
                    "mode": "audio",
                    "videoFormatId": null,
                    "audioFormatId": "251",
                    "targetContainer": "auto",
                    "outputDirectory": "/tmp",
                    "filenameTemplate": "%(title)s.%(ext)s"
                }
            ]
        });

        let req = axum::http::Request::builder()
            .method("POST")
            .uri("/api/v1/queue/batch")
            .header(header::AUTHORIZATION, "Bearer token_xyz")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&batch_body).unwrap()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let body_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(body_json["status"], "success");
        let enqueued_ids = body_json["enqueuedJobIds"].as_array().unwrap();
        assert_eq!(enqueued_ids.len(), 1);
        let job_id = enqueued_ids[0].as_str().unwrap();

        // Query Queue
        let req = axum::http::Request::builder()
            .method("GET")
            .uri("/api/v1/queue")
            .header(header::AUTHORIZATION, "Bearer token_xyz")
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Cancel Job
        let req = axum::http::Request::builder()
            .method("POST")
            .uri(format!("/api/v1/queue/{}/cancel", job_id))
            .header(header::AUTHORIZATION, "Bearer token_xyz")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
