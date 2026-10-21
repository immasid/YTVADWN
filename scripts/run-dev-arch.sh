#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${HOME}/pulsestream-dev.log"
cd "$ROOT"

if [[ ! -d node_modules ]]; then
  printf 'node_modules is missing. Run `bash scripts/setup-arch.sh` first.\n' >&2
  exit 1
fi

printf 'Starting PulseStream from %s\n' "$ROOT"
printf 'Full terminal output is also appended to %s\n\n' "$LOG_FILE"
npm run tauri -- dev 2>&1 | tee -a "$LOG_FILE"
exit "${PIPESTATUS[0]}"
