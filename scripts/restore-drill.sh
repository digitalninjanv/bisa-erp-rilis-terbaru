#!/usr/bin/env bash
# A-28 Tahap 6 (H-X-01) — latihan restore BERKALA yang benar-benar
# dijalankan: backup terbaru dipulihkan ke database UJI sekali pakai,
# integritas internal hasil restore diverifikasi, lalu DB uji dihapus.
#
# KEAMANAN (keras):
# - Database tujuan SELALU bernama mengandung "restore_test" dan
#   dibuat baru oleh skrip ini; skrip menolak nama lain dan menolak
#   nama yang sama dengan database sumber.
# - Database sumber tidak pernah ditulis atau dibaca untuk verifikasi.
# - DB uji dihapus di akhir dalam semua keadaan (trap EXIT).
#
# Usage:
#   scripts/restore-drill.sh [berkas-dump]
# Tanpa argumen: dump terbaru di BACKUP_DIR (bawaan ./backups) dipakai.
# Hasil dicatat ke restore-drill-manifest.json di direktori backup
# yang sama — dibaca aplikasi (Pengaturan → Status sistem).
# Exit 0 = restore dan seluruh pemeriksaan internal lulus; exit 1 = gagal.
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# Operational settings are loaded as shell variables, not exported to the
# unit's process environment. The passphrase is supplied separately by
# systemd's credential directory when this runs as a scheduled service.
backup_conf="${BISA_BACKUP_CONF:-/etc/bisa-erp/backup.conf}"
if [[ -f "$backup_conf" ]]; then
  # shellcheck disable=SC1090
  source "$backup_conf"
fi
passphrase_file=""
if [[ -n "${CREDENTIALS_DIRECTORY:-}" ]]; then
  passphrase_file="$CREDENTIALS_DIRECTORY/backup-passphrase"
elif [[ -n "${BISA_BACKUP_PASSPHRASE_FILE:-}" ]]; then
  passphrase_file="$BISA_BACKUP_PASSPHRASE_FILE"
elif [[ -s /etc/credstore/bisa-erp-backup-passphrase ]]; then
  passphrase_file="/etc/credstore/bisa-erp-backup-passphrase"
fi
if [[ -n "$passphrase_file" ]]; then
  # The key remains available only through the credential file path.
  export -n BACKUP_PASSPHRASE 2>/dev/null || true
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
  file="$(ls -t "$backup_dir"/bisa-*.dump "$backup_dir"/bisa-*.dump.enc 2>/dev/null | head -1 || true)"
fi
[[ -n "$file" && -f "$file" ]] || {
  echo "Berkas dump tidak ditemukan (argumen atau terbaru di $backup_dir)." >&2
  exit 1
}
if ! node scripts/verify-backup-manifest.mjs "$file"; then
  echo "Latihan restore berhenti: validasi manifest/hash backup gagal." >&2
  exit 1
fi

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
decrypted=""
cleanup() {
  if [[ "$created" == 1 ]]; then
    psql "$maint_url" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$target_db\"" >/dev/null 2>&1 || true
    echo "DB uji $target_db dihapus."
  fi
  if [[ -n "$decrypted" ]]; then
    rm -f -- "$decrypted" || true
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
if [[ "$file" == *.enc ]]; then
  if [[ -n "$passphrase_file" ]]; then
    [[ -r "$passphrase_file" && -s "$passphrase_file" ]] || { echo "Credential backup-passphrase tidak dapat dibaca atau kosong." >&2; exit 1; }
  elif [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
    echo "Berkas terenkripsi: atur BACKUP_PASSPHRASE_FILE atau BACKUP_PASSPHRASE." >&2
    exit 1
  fi
  decrypted="$(mktemp /tmp/bisa-drill-XXXXXX.dump)"
  if node scripts/backup-crypto.mjs is-v1 "$file"; then
    if [[ -n "$passphrase_file" ]]; then
      BACKUP_PASSPHRASE_FILE="$passphrase_file" node scripts/backup-crypto.mjs decrypt "$file" "$decrypted"
    else
      BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" node scripts/backup-crypto.mjs decrypt "$file" "$decrypted"
    fi
  elif node scripts/backup-crypto.mjs is-legacy-cbc "$file" && [[ "${RESTORE_ALLOW_LEGACY_CBC:-}" == "1" ]]; then
    # Compatibility path for historical AES-CBC archives without authentication.
    if [[ -n "$passphrase_file" ]]; then
      openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass "file:$passphrase_file" -in "$file" -out "$decrypted"
    else
      openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" -out "$decrypted"
    fi
  elif node scripts/backup-crypto.mjs is-legacy-cbc "$file"; then
    echo "Drill CBC lama ditolak secara default; setelah memverifikasi arsip, set RESTORE_ALLOW_LEGACY_CBC=1 untuk latihan ini." >&2
    exit 1
  else
    echo "Format backup terenkripsi tidak dikenal; drill dihentikan." >&2
    exit 1
  fi || {
    rm -f "$decrypted"
    echo "Dekripsi gagal." >&2
    exit 1
  }
  restore_file="$decrypted"
fi

pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$target_url" "$restore_file" || {
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

# --- Verifikasi mandiri pada snapshot hasil restore -----------------
# Jangan bandingkan dengan database sumber yang sudah terus menerima
# transaksi setelah waktu backup. pg_dump adalah snapshot konsisten pada
# waktunya; kesetaraan dengan source live akan gagal palsu setelah ada
# penjualan/pembayaran baru dan tidak membuktikan snapshot yang sama.
q_accounts='SELECT count(*) FROM accounts'
q_products='SELECT count(*) FROM products'
q_inventory='SELECT coalesce(sum(soh.qty * p.cost_price), 0) FROM stock_on_hand soh JOIN products p ON p.id = soh.product_id'
q_posted_journals="SELECT count(*) FROM journal_entries WHERE status = 'posted'"
q_unbalanced_journals="SELECT count(*) FROM (SELECT je.id FROM journal_entries je LEFT JOIN journal_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id WHERE je.status = 'posted' GROUP BY je.id HAVING abs(coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0)) > 0.0001) unbalanced"
q_orphan_journal_lines="SELECT count(*) FROM journal_lines jl LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id WHERE je.id IS NULL"

run_q() { psql "$1" -At -v ON_ERROR_STOP=1 -c "$2"; }

tgt_accounts="$(run_q "$target_url" "$q_accounts")"
tgt_products="$(run_q "$target_url" "$q_products")"
tgt_inventory="$(run_q "$target_url" "$q_inventory")"
posted_journals="$(run_q "$target_url" "$q_posted_journals")"
unbalanced_journals="$(run_q "$target_url" "$q_unbalanced_journals")"
orphan_journal_lines="$(run_q "$target_url" "$q_orphan_journal_lines")"

ok=1
check_zero() { # nama, jumlah temuan
  if [[ "$2" == "0" ]]; then
    echo "  COCOK  $1: tidak ada"
  else
    echo "  GAGAL  $1: $2" >&2
    ok=0
  fi
}
echo "Pemeriksaan internal hasil restore (bukan perbandingan source live):"
echo "  INFO   jumlah akun: $tgt_accounts"
echo "  INFO   jumlah produk: $tgt_products"
echo "  INFO   nilai persediaan: $tgt_inventory"
echo "  INFO   jurnal posted: $posted_journals"
check_zero "jurnal posted tidak seimbang" "$unbalanced_journals"
check_zero "baris jurnal tanpa header yang cocok" "$orphan_journal_lines"

# --- Manifest latihan (dibaca halaman Status sistem) ------------------
mkdir -p "$backup_dir"
manifest="$backup_dir/restore-drill-manifest.json"
manifest_tmp="${manifest}.tmp"
at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DRILL_AT="$at" \
DRILL_SOURCE_FILE="$(basename "$file")" \
DRILL_TARGET_DB="$target_db" \
DRILL_OK="$ok" \
DRILL_ACCOUNTS="$tgt_accounts" \
DRILL_PRODUCTS="$tgt_products" \
DRILL_INVENTORY_VALUE="$tgt_inventory" \
DRILL_POSTED_JOURNALS="$posted_journals" \
DRILL_UNBALANCED_JOURNALS="$unbalanced_journals" \
DRILL_ORPHAN_JOURNAL_LINES="$orphan_journal_lines" \
node --input-type=module -e '
const number = (name) => Number(process.env[name]);
const manifest = {
  version: 2,
  at: process.env.DRILL_AT,
  sourceFile: process.env.DRILL_SOURCE_FILE,
  targetDatabase: process.env.DRILL_TARGET_DB,
  ok: process.env.DRILL_OK === "1",
  checks: {
    accounts: number("DRILL_ACCOUNTS"),
    products: number("DRILL_PRODUCTS"),
    inventoryValue: process.env.DRILL_INVENTORY_VALUE,
    postedJournals: number("DRILL_POSTED_JOURNALS"),
    unbalancedJournals: number("DRILL_UNBALANCED_JOURNALS"),
    orphanJournalLines: number("DRILL_ORPHAN_JOURNAL_LINES"),
  },
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
' > "$manifest_tmp"
if [[ -n "${BACKUP_STATUS_GROUP:-}" ]]; then
  chgrp "$BACKUP_STATUS_GROUP" "$manifest_tmp"
  chmod 640 "$manifest_tmp"
fi
mv "$manifest_tmp" "$manifest"
echo "Manifest latihan diperbarui: $manifest"

if [[ "$ok" == 1 ]]; then
  echo "Latihan restore BERHASIL — semua angka cocok."
  exit 0
fi
echo "Latihan restore GAGAL verifikasi." >&2
exit 1
