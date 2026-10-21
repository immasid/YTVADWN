#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BIN_DIR="${HOME}/.local/share/pulsestream/bin"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -eq 0 ]]; then
  fail "Run this script as your normal desktop user, not with sudo. It invokes sudo only for pacman."
fi

command -v pacman >/dev/null 2>&1 || fail "This setup script is for Arch Linux and Arch-based systems such as CachyOS."
command -v sudo >/dev/null 2>&1 || fail "sudo is required to install Arch packages."
[[ -f "$ROOT/package.json" && -f "$ROOT/src-tauri/Cargo.toml" ]] || fail "Run this script from a YTVADWN/PulseStream source checkout."

IS_GIT_CHECKOUT=0
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  IS_GIT_CHECKOUT=1
else
  printf 'WARNING: this is not a Git clone (likely a GitHub ZIP). Local development can use system Deno, but clone with Git LFS before making a complete distributable build.\n' >&2
fi

printf '\n==> Installing Arch packages for Tauri, media tools, and Git LFS...\n'
sudo pacman -Syu --needed \
  appmenu-gtk-module \
  aria2 \
  base-devel \
  curl \
  deno \
  ffmpeg \
  file \
  git \
  git-lfs \
  libappindicator-gtk3 \
  librsvg \
  nodejs \
  npm \
  openssl \
  patchelf \
  pkgconf \
  rustup \
  webkit2gtk-4.1 \
  wget \
  xdotool

DENO_RESOURCE="$ROOT/src-tauri/resources/binaries/deno"
if (( IS_GIT_CHECKOUT )); then
  printf '\n==> Restoring Git LFS assets...\n'
  git lfs install
  git -C "$ROOT" lfs pull
  if [[ ! -f "$DENO_RESOURCE" ]] || grep -q '^version https://git-lfs.github.com/spec/v1' "$DENO_RESOURCE"; then
    fail "The bundled Deno file is still an LFS pointer. Check Git LFS/network access, then run: git lfs pull"
  fi
elif [[ -f "$DENO_RESOURCE" ]] && grep -q '^version https://git-lfs.github.com/spec/v1' "$DENO_RESOURCE"; then
  printf 'NOTE: ZIP extraction leaves bundled Deno as an LFS pointer. The system Deno override below supports local development, but use a Git clone with LFS for a complete source tree.\n' >&2
fi

printf '\n==> Ensuring the stable Rust toolchain is installed...\n'
if [[ ! -x "$HOME/.cargo/bin/rustup" ]] && ! command -v rustup >/dev/null 2>&1; then
  fail "rustup is missing after package installation."
fi
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
RUSTUP_BIN="$HOME/.cargo/bin/rustup"
if [[ ! -x "$RUSTUP_BIN" ]]; then
  RUSTUP_BIN="$(command -v rustup || true)"
fi
[[ -n "$RUSTUP_BIN" && -x "$RUSTUP_BIN" ]] || fail "rustup could not be found."
"$RUSTUP_BIN" toolchain install stable --profile minimal
"$RUSTUP_BIN" default stable

printf '\n==> Checking the system Deno installation...\n'
DENO_BIN="$(command -v deno || true)"
[[ -n "$DENO_BIN" && -x "$DENO_BIN" ]] || fail "Deno was not found after installing the deno package."
"$DENO_BIN" --version >/dev/null 2>&1 || fail "The system Deno executable does not run: $DENO_BIN"

printf '\n==> Configuring per-user binary overrides...\n'
mkdir -p "$APP_BIN_DIR"
link_binary() {
  local source="$1"
  local target="$2"
  local backup

  [[ -x "$source" ]] || fail "Required executable is missing or not runnable: $source"
  source="$(readlink -f "$source")"
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ "$target" -ef "$source" ]]; then
      printf '  OK  %s already points to %s\n' "$target" "$source"
      return
    fi
    backup="${target}.backup.$(date +%Y%m%d%H%M%S)"
    mv -- "$target" "$backup"
    printf '  Backed up previous override: %s\n' "$backup"
  fi
  ln -s -- "$source" "$target"
  printf '  Linked %s -> %s\n' "$target" "$source"
}

FFMPEG_BIN="$(command -v ffmpeg || true)"
FFPROBE_BIN="$(command -v ffprobe || true)"
ARIA2_BIN="$(command -v aria2c || true)"
[[ -n "$FFMPEG_BIN" ]] || fail "ffmpeg was not found after installing ffmpeg."
[[ -n "$FFPROBE_BIN" ]] || fail "ffprobe was not found after installing ffmpeg."
[[ -n "$ARIA2_BIN" ]] || fail "aria2c was not found after installing aria2."

"$FFMPEG_BIN" -version >/dev/null 2>&1 || fail "The system ffmpeg does not run."
"$FFPROBE_BIN" -version >/dev/null 2>&1 || fail "The system ffprobe does not run."
"$ARIA2_BIN" --version >/dev/null 2>&1 || fail "aria2c does not run."

link_binary "$FFMPEG_BIN" "$APP_BIN_DIR/ffmpeg"
link_binary "$FFPROBE_BIN" "$APP_BIN_DIR/ffprobe"
link_binary "$DENO_BIN" "$APP_BIN_DIR/deno"

printf '\n==> Installing the locked JavaScript dependencies...\n'
cd "$ROOT"
npm ci

printf '\n==> Setup complete. Tool versions:\n'
node --version
npm --version
rustc --version
cargo --version
"$APP_BIN_DIR/ffmpeg" -version | head -n 1
"$APP_BIN_DIR/ffprobe" -version | head -n 1
"$APP_BIN_DIR/deno" --version | head -n 1
"$ARIA2_BIN" --version | head -n 1

printf '\nNext: run `bash scripts/check-arch.sh`, then `bash scripts/run-dev-arch.sh`.\n'
