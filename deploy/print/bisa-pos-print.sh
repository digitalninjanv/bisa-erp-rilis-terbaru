#!/usr/bin/env bash
# Buka Bisa POS di Chromium/Chrome dengan cetak otomatis (tanpa dialog)
# ke printer default OS. Set printer thermal sebagai default di sistem.
#
# Pakai:
#   ./bisa-pos-print.sh [URL]
# Contoh LAN:
#   ./bisa-pos-print.sh http://192.168.18.253:3000/app/pos
set -euo pipefail
URL="${1:-${BISA_POS_URL:-http://localhost:3000/app/pos}}"
BROWSER="${BISA_BROWSER:-}"
if [[ -z "$BROWSER" ]]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
    if command -v "$candidate" >/dev/null 2>&1; then BROWSER="$candidate"; break; fi
  done
fi
if [[ -z "$BROWSER" ]]; then
  echo "Chrome/Edge/Chromium tidak ditemukan. Set BISA_BROWSER=/path/ke/chrome" >&2
  exit 1
fi
PROFILE="${BISA_PRINT_PROFILE:-$HOME/.config/bisa-pos-print}"
exec "$BROWSER" \
  --kiosk-printing \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --app="$URL"
