use axum::http::HeaderMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

/// Path to the local control token file.
pub fn get_token_file_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from(".config"));
    base.join("pulsestream").join("control.token")
}

/// Reads the existing control token or generates a cryptographically secure 32-byte hex token.
/// On Unix, ensures the file has POSIX permissions 0600 (owner read/write only).
pub fn get_or_create_control_token() -> Result<String, String> {
    let token_path = get_token_file_path();

    if let Some(parent) = token_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config dir {:?}: {}", parent, e))?;
            #[cfg(unix)]
            {
                let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
            }
        }
    }

    if token_path.is_file() {
        if let Ok(existing) = fs::read_to_string(&token_path) {
            let trimmed = existing.trim().to_string();
            if !trimmed.is_empty() {
                #[cfg(unix)]
                {
                    let _ = fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600));
                }
                return Ok(trimmed);
            }
        }
    }

    // Generate 32 bytes from /dev/urandom
    let mut bytes = [0u8; 32];
    if let Ok(mut file) = fs::File::open("/dev/urandom") {
        let _ = file.read_exact(&mut bytes);
    } else {
        // Fallback: SHA-256 hash of system timestamp and pid
        use sha2::{Digest, Sha256};
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut hasher = Sha256::new();
        hasher.update(now.to_le_bytes());
        hasher.update(std::process::id().to_le_bytes());
        let hash = hasher.finalize();
        bytes.copy_from_slice(&hash);
    }

    let token = hex::encode(bytes);

    fs::write(&token_path, &token)
        .map_err(|e| format!("Failed to write control token to {:?}: {}", token_path, e))?;

    #[cfg(unix)]
    {
        let _ = fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600));
    }

    println!("[PulseStream] Generated new control token at {:?}", token_path);
    Ok(token)
}

/// Constant-time string equality check to prevent timing analysis attacks.
pub fn constant_time_compare(a: &str, b: &str) -> bool {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();

    if a_bytes.len() != b_bytes.len() {
        return false;
    }

    let mut result = 0u8;
    for (x, y) in a_bytes.iter().zip(b_bytes.iter()) {
        result |= x ^ y;
    }

    result == 0
}

/// Extracts Bearer token from the `Authorization` header and compares it in constant time.
pub fn extract_and_verify_bearer(headers: &HeaderMap, expected_token: &str) -> bool {
    if let Some(auth_val) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            let auth_str = auth_str.trim();
            if auth_str.len() > 7 && auth_str[..7].eq_ignore_ascii_case("bearer ") {
                let token_part = auth_str[7..].trim();
                return constant_time_compare(token_part, expected_token);
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn test_constant_time_compare() {
        let token = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
        assert!(constant_time_compare(token, token));
        assert!(!constant_time_compare(token, "wrong"));
        assert!(!constant_time_compare(token, "a1b2c3d4e5f60718293a4b5c6d7e8f91"));
        assert!(!constant_time_compare("", token));
        assert!(constant_time_compare("", ""));
    }

    #[test]
    fn test_extract_and_verify_bearer() {
        let expected = "valid_secret_token_12345";
        let mut headers = HeaderMap::new();

        // 1. Missing header
        assert!(!extract_and_verify_bearer(&headers, expected));

        // 2. Non-bearer scheme
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Basic dXNlcjpwYXNz"),
        );
        assert!(!extract_and_verify_bearer(&headers, expected));

        // 3. Incorrect bearer token
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer wrong_token"),
        );
        assert!(!extract_and_verify_bearer(&headers, expected));

        // 4. Correct bearer token (standard case)
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer valid_secret_token_12345"),
        );
        assert!(extract_and_verify_bearer(&headers, expected));

        // 5. Lowercase bearer prefix
        headers.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("bearer valid_secret_token_12345"),
        );
        assert!(extract_and_verify_bearer(&headers, expected));
    }
}
