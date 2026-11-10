#!/usr/bin/env bash
# =====================================================================
# cleanup-fixture-residue.sh — pembungkus pembersihan SATU KALI residu
# fixture (AUD-001/AUD-002). Urutan yang ditegakkan skrip ini:
#   1. Backup dump SEGAR wajib (scripts/backup.sh) — gagal = batal.
#   2. cleanup-fixture-residue.sql dalam satu transaksi.
#   3. Petunjuk verifikasi: db-integrity.sql + restore-drill.sh.
# Aman dijalankan ulang (idempoten). Hanya menyentuh perusahaan yang
# TIDAK punya baris di `organization` — tenant hidup tidak tersentuh.
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

# Fallback lokasi biner klien PostgreSQL 18 lokal (pola AUD-021,
# setara backup.sh/restore-drill.sh) bila PATH induk minim.
if ! command -v psql >/dev/null 2>&1 && [ -x ".local/pg18-client/usr/lib/postgresql/18/bin/psql" ]; then
  export PATH="$ROOT/.local/pg18-client/usr/lib/postgresql/18/bin:$PATH"
  export LD_LIBRARY_PATH="$ROOT/.local/pg18-client/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

echo "== [1/2] backup wajib sebelum pembersihan =="
bash scripts/backup.sh

echo "== [2/2] pembersihan residu (satu transaksi) =="
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/audit/cleanup-fixture-residue.sql

echo
echo "Selesai. Verifikasi sekarang:"
echo "  psql \"\$DIRECT_URL\" -f scripts/audit/db-integrity.sql   # semua pemeriksaan harus 0"
echo "  bash scripts/backup.sh && bash scripts/restore-drill.sh # drill dari dump bersih harus LULUS"
