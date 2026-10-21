#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BIN_DIR="${HOME}/.local/share/pulsestream/bin"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT
failures=0

check_binary() {
  local name="$1"
  local path="$2"
  local args=("${@:3}")

  if [[ ! -x "$path" ]]; then
    printf 'MISSING  %-8s %s\n' "$name" "$path"
    failures=$((failures + 1))
    return
  fi
  if "$path" "${args[@]}" >"$TMP_DIR/stdout" 2>"$TMP_DIR/stderr"; then
    local version
    version="$(head -n 1 "$TMP_DIR/stdout")"
    printf 'HEALTHY  %-8s %s\n         %s\n' "$name" "$path" "$version"
  else
    printf 'ERROR    %-8s %s\n' "$name" "$path"
    sed -n '1,3p' "$TMP_DIR/stderr"
    failures=$((failures + 1))
  fi
}

printf 'PulseStream environment check (Arch Linux / CachyOS)\n'
printf 'Project: %s\n\n' "$ROOT"

check_binary ffmpeg "$APP_BIN_DIR/ffmpeg" -version
check_binary ffprobe "$APP_BIN_DIR/ffprobe" -version
check_binary deno "$APP_BIN_DIR/deno" --version

if [[ -x "$APP_BIN_DIR/yt-dlp" ]]; then
  check_binary yt-dlp "$APP_BIN_DIR/yt-dlp" --version
elif [[ -x "$ROOT/src-tauri/resources/binaries/yt-dlp" ]]; then
  check_binary yt-dlp "$ROOT/src-tauri/resources/binaries/yt-dlp" --version
elif command -v yt-dlp >/dev/null 2>&1; then
  check_binary yt-dlp "$(command -v yt-dlp)" --version
else
  printf 'MISSING  yt-dlp    No executable was found in local override, bundle, or PATH.\n'
  failures=$((failures + 1))
fi

if command -v aria2c >/dev/null 2>&1 && aria2c --version >/dev/null 2>&1; then
  printf 'HEALTHY  aria2c    %s\n' "$(command -v aria2c)"
else
  printf 'OPTIONAL aria2c    Not found; yt-dlp can still use its native downloader.\n'
fi

if [[ -f "$ROOT/src-tauri/resources/binaries/deno" ]] && \
   grep -q '^version https://git-lfs.github.com/spec/v1' "$ROOT/src-tauri/resources/binaries/deno"; then
  printf 'WARNING  Git LFS   The bundled Deno file is only an LFS pointer. Run `git lfs pull`.\n'
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  printf '\nEnvironment check reported %d required issue(s). Re-run `bash scripts/setup-arch.sh` in a Git clone.\n' "$failures"
  exit 1
fi
printf '\nAll required executable checks passed.\n'
