#!/usr/bin/env bash
# A-28 Tahap 6 (H-X-01) — latihan restore BERKALA yang benar-benar
# dijalankan: backup terbaru dipulihkan ke database UJI sekali pakai,
# isinya diverifikasi terhadap database sumber, lalu DB uji dihapus.
#
# KEAMANAN (keras):
# - Database tujuan SELALU bernama mengandung "restore_test" dan
#   dibuat baru oleh skrip ini; skrip menolak nama lain dan menolak
#   nama yang sama dengan database sumber.
# - Database sumber tidak pernah ditulis; hanya dibaca (verifikasi).
# - DB uji dihapus di akhir dalam semua keadaan (trap EXIT).
#
# Usage:
#   scripts/restore-drill.sh [berkas-dump]
# Tanpa argumen: dump terbaru di BACKUP_DIR (bawaan ./backups) dipakai.
# Hasil dicatat ke restore-drill-manifest.json di direktori backup
# yang sama — dibaca aplikasi (Pengaturan → Status sistem).
# Exit 0 = semua pemeriksaan cocok; exit 1 = ada yang tidak cocok.
set -uo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${DIRECT_URL:?DIRECT_URL is required}"

# PG_BIN dari /etc/bisa-erp/backup.conf (pola yang sama dengan
# deploy/backup-run.sh) menunjuk folder bin PostgreSQL produksi.
if [[ -n "${PG_BIN:-}" ]]; then
  export PATH="${PG_BIN}:$PATH"
fi
# Client tools PG18 di lingkungan dev tidak selalu di PATH.
if ! command -v pg_restore >/dev/null 2>&1 && [[ -x .local/pg18-client/usr/lib/postgresql/18/bin/pg_restore ]]; then
  export PATH="$PWD/.local/pg18-client/usr/lib/postgresql/18/bin:$PATH"
  export LD_LIBRARY_PATH="$PWD/.local/pg18-client/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore tidak ditemukan." >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "psql tidak ditemukan." >&2; exit 1; }

backup_dir="${BACKUP_DIR:-backups}"
file="${1:-}"
if [[ -z "$file" ]]; then
  file="$(ls -t "$backup_dir"/bisa-*.dump* 2>/dev/null | head -1 || true)"
fi
[[ -n "$file" && -f "$file" ]] || {
  echo "Berkas dump tidak ditemukan (argumen atau terbaru di $backup_dir)." >&2
  exit 1
}

# --- Turunkan URL tujuan dari DIRECT_URL (ganti nama database saja) --
url_base="${DIRECT_URL%%\?*}"
url_query=""
[[ "$DIRECT_URL" == *\?* ]] && url_query="?${DIRECT_URL#*\?}"
source_db="${url_base##*/}"
url_prefix="${url_base%/*}"
stamp="$(date +%Y%m%d-%H%M%S)"
target_db="bisa_restore_test_${stamp//-/}"
target_db="${target_db,,}"

[[ "$target_db" == *restore_test* ]] || { echo "Nama DB uji tidak aman: $target_db" >&2; exit 1; }
[[ "$target_db" != "$source_db" ]] || { echo "DB uji sama dengan DB sumber — ditolak." >&2; exit 1; }

maint_url="${url_prefix}/postgres${url_query}"
target_url="${url_prefix}/${target_db}${url_query}"

created=0
cleanup() {
  if [[ "$created" == 1 ]]; then
    psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$target_db\"" >/dev/null 2>&1 || true
    echo "DB uji $target_db dihapus."
  fi
}
trap cleanup EXIT

echo "Latihan restore: $file → DB uji $target_db (sumber: $source_db)"

exists="$(psql "$maint_url" -At -c "SELECT 1 FROM pg_database WHERE datname = '$target_db'")"
[[ "$exists" != "1" ]] || { echo "DB uji $target_db sudah ada — ditolak (nama harus unik per latihan)." >&2; exit 1; }
psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$target_db\" OWNER erp" || {
  echo "Gagal membuat DB uji." >&2
  exit 1
}
created=1

# Dekripsi bila perlu (pola yang sama dengan scripts/restore.sh).
restore_file="$file"
decrypted=""
if [[ "$file" == *.enc ]]; then
  [[ -n "${BACKUP_PASSPHRASE:-}" ]] || { echo "Berkas terenkripsi: atur BACKUP_PASSPHRASE." >&2; exit 1; }
  decrypted="$(mktemp /tmp/bisa-drill-XXXXXX.dump)"
  openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" -out "$decrypted" || {
    rm -f "$decrypted"
    echo "Dekripsi gagal." >&2
    exit 1
  }
  restore_file="$decrypted"
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$target_url" "$restore_file" || {
  [[ -n "$decrypted" ]] && rm -f "$decrypted"
  echo "pg_restore GAGAL." >&2
  exit 1
}
[[ -n "$decrypted" ]] && rm -f "$decrypted"

# Grant peran aplikasi (blok yang sama dengan runbook DR langkah 3) —
# latihan ini juga membuktikan langkah grant bekerja pada DB baru.
psql "$target_url" -v ON_ERROR_STOP=1 -q <<'SQL' || { echo "Penerapan grant GAGAL." >&2; exit 1; }
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
SQL

# --- Verifikasi: angka sumber vs angka hasil restore -----------------
q_accounts='SELECT count(*) FROM accounts'
q_products='SELECT count(*) FROM products'
q_inventory='SELECT coalesce(sum(soh.qty * p.cost_price), 0) FROM stock_on_hand soh JOIN products p ON p.id = soh.product_id'
q_trial='SELECT coalesce(sum(jl.debit) - sum(jl.credit), 0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.status = '"'"'posted'"'"''

run_q() { psql "$1" -At -v ON_ERROR_STOP=1 -c "$2"; }

src_accounts="$(run_q "$DIRECT_URL" "$q_accounts")"
tgt_accounts="$(run_q "$target_url" "$q_accounts")"
src_products="$(run_q "$DIRECT_URL" "$q_products")"
tgt_products="$(run_q "$target_url" "$q_products")"
src_inventory="$(run_q "$DIRECT_URL" "$q_inventory")"
tgt_inventory="$(run_q "$target_url" "$q_inventory")"
src_trial="$(run_q "$DIRECT_URL" "$q_trial")"
tgt_trial="$(run_q "$target_url" "$q_trial")"

ok=1
check() { # nama, sumber, target
  if [[ "$2" == "$3" ]]; then
    echo "  COCOK  $1: $2"
  else
    echo "  BEDA   $1: sumber=$2 restore=$3" >&2
    ok=0
  fi
}
echo "Verifikasi isi:"
check "jumlah akun" "$src_accounts" "$tgt_accounts"
check "jumlah produk" "$src_products" "$tgt_products"
check "nilai persediaan" "$src_inventory" "$tgt_inventory"
check "selisih neraca saldo" "$src_trial" "$tgt_trial"
# Neraca saldo sumber sendiri harus 0 — restore yang cocok dengan
# sumber yang tidak seimbang tetap dicatat tidak ok.
if [[ "$src_trial" != "0" && "$src_trial" != "0.0000" ]]; then
  echo "  BEDA   neraca saldo sumber tidak nol: $src_trial" >&2
  ok=0
fi

# --- Manifest latihan (dibaca halaman Status sistem) ------------------
mkdir -p "$backup_dir"
manifest="$backup_dir/restore-drill-manifest.json"
manifest_tmp="${manifest}.tmp"
at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ok_json="true"; [[ "$ok" == 1 ]] || ok_json="false"
printf '{\n  "version": 1,\n  "at": "%s",\n  "sourceFile": "%s",\n  "targetDatabase": "%s",\n  "ok": %s,\n  "checks": {\n    "accounts": { "source": %s, "restored": %s },\n    "products": { "source": %s, "restored": %s },\n    "inventoryValue": { "source": "%s", "restored": "%s" },\n    "trialBalanceDifference": { "source": "%s", "restored": "%s" }\n  }\n}\n' \
  "$at" "$(basename "$file")" "$target_db" "$ok_json" \
  "$src_accounts" "$tgt_accounts" "$src_products" "$tgt_products" \
  "$src_inventory" "$tgt_inventory" "$src_trial" "$tgt_trial" > "$manifest_tmp"
mv "$manifest_tmp" "$manifest"
echo "Manifest latihan diperbarui: $manifest"

if [[ "$ok" == 1 ]]; then
  echo "Latihan restore BERHASIL — semua angka cocok."
  exit 0
fi
echo "Latihan restore GAGAL verifikasi." >&2
exit 1
