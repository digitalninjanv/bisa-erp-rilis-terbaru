#!/usr/bin/env bash
# Restore a custom-format dump created by scripts/backup.sh.
# Safe usage: RESTORE_TARGET_URL=... RESTORE_CONFIRM_TARGET=host:port/db scripts/restore.sh <dump>
# In-place recovery additionally requires RESTORE_ALLOW_IN_PLACE=1.
# Encrypted backups (*.dump.enc) need the same BACKUP_PASSPHRASE_FILE
# credential (preferred) or manual BACKUP_PASSPHRASE used at creation.
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${DIRECT_URL:?DIRECT_URL is required}"
: "${RESTORE_TARGET_URL:?RESTORE_TARGET_URL is required; restore will not default to DIRECT_URL}"

file="${1:-}"

if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: RESTORE_TARGET_URL=<target-url> RESTORE_CONFIRM_TARGET=<host:port/database> scripts/restore.sh <dump-file>" >&2
  exit 1
fi

url_identity() {
  node -e 'const u = new URL(process.argv[1]); const database = decodeURIComponent(u.pathname.slice(1)); if (!database) process.exit(2); process.stdout.write(`${u.hostname.toLowerCase()}\t${u.port || "5432"}\t${database}`)' "$1"
}

source_identity="$(url_identity "$DIRECT_URL")" || { echo "DIRECT_URL tidak valid untuk identifikasi database." >&2; exit 1; }
target_identity="$(url_identity "$RESTORE_TARGET_URL")" || { echo "RESTORE_TARGET_URL tidak valid untuk identifikasi database." >&2; exit 1; }
IFS=$'\t' read -r source_host source_port source_db <<< "$source_identity"
IFS=$'\t' read -r target_host target_port target_db <<< "$target_identity"
target_label="${target_host}:${target_port}/${target_db}"

if [[ "${RESTORE_CONFIRM_TARGET:-}" != "$target_label" ]]; then
  echo "Restore ditolak: ketik target yang tepat pada RESTORE_CONFIRM_TARGET=$target_label setelah memeriksa tujuan." >&2
  exit 1
fi

in_place=0
if [[ "$source_identity" == "$target_identity" ]]; then
  if [[ "${RESTORE_ALLOW_IN_PLACE:-}" != "1" ]]; then
    echo "Restore ke database sumber ditolak. Untuk pemulihan in-place, set RESTORE_ALLOW_IN_PLACE=1 setelah backup dan rencana pemulihan diverifikasi." >&2
    exit 1
  fi
  in_place=1
elif [[ "${RESTORE_ALLOW_IN_PLACE:-}" == "1" ]]; then
  echo "RESTORE_ALLOW_IN_PLACE=1 tidak diperlukan untuk target yang berbeda dan ditolak." >&2
  exit 1
fi

node scripts/verify-backup-manifest.mjs "$file"

# Encrypted backups are decrypted to a temp file that is always removed.
restore_file="$file"
cleanup() { if [[ "$restore_file" != "$file" ]]; then rm -f -- "$restore_file"; fi; }
trap cleanup EXIT
if [[ "$file" == *.enc ]]; then
  passphrase_file="${BACKUP_PASSPHRASE_FILE:-}"
  if [[ -n "$passphrase_file" ]]; then
    [[ -r "$passphrase_file" && -s "$passphrase_file" ]] || {
      echo "BACKUP_PASSPHRASE_FILE tidak dapat dibaca atau kosong." >&2
      exit 1
    }
  elif [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
    echo "Berkas terenkripsi: atur BACKUP_PASSPHRASE_FILE atau BACKUP_PASSPHRASE yang sama dengan saat backup dibuat." >&2
    exit 1
  fi
  restore_file="$(mktemp "${TMPDIR:-/tmp}/bisa-restore-XXXXXX.dump")"
  if node scripts/backup-crypto.mjs is-v1 "$file"; then
    if [[ -n "$passphrase_file" ]]; then
      BACKUP_PASSPHRASE_FILE="$passphrase_file" node scripts/backup-crypto.mjs decrypt "$file" "$restore_file"
    else
      BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" node scripts/backup-crypto.mjs decrypt "$file" "$restore_file"
    fi
  elif node scripts/backup-crypto.mjs is-legacy-cbc "$file" && [[ "${RESTORE_ALLOW_LEGACY_CBC:-}" == "1" ]]; then
    # Compatibility path for historical AES-CBC backups. These archives
    # predate authenticated encryption and must be replaced by a fresh backup.
    if [[ -n "$passphrase_file" ]]; then
      openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass "file:$passphrase_file" -in "$file" -out "$restore_file"
    else
      openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" -out "$restore_file"
    fi
  elif node scripts/backup-crypto.mjs is-legacy-cbc "$file"; then
    echo "Restore CBC lama ditolak secara default; setelah memverifikasi asal/hash arsip, set RESTORE_ALLOW_LEGACY_CBC=1 untuk pemulihan satu kali." >&2
    exit 1
  else
    echo "Format backup terenkripsi tidak dikenal; restore dihentikan." >&2
    exit 1
  fi
fi

echo "Memverifikasi arsip $file..."
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$restore_file" >/dev/null
elif command -v podman >/dev/null 2>&1 && podman container exists "${BISA_PG_CONTAINER:-bisa-pg}"; then
  podman exec -i "${BISA_PG_CONTAINER:-bisa-pg}" pg_restore --list < "$restore_file" >/dev/null
else
  echo "pg_restore tidak ditemukan. Pasang postgresql-client atau jalankan PostgreSQL di container ${BISA_PG_CONTAINER:-bisa-pg}." >&2
  exit 1
fi

restore_args=(--exit-on-error --single-transaction --no-owner --no-privileges)
if [[ "$in_place" == 1 ]]; then
  restore_args+=(--clean --if-exists)
fi

echo "Memulihkan $file ke $target_label..."
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore "${restore_args[@]}" --dbname="$RESTORE_TARGET_URL" "$restore_file"
elif command -v podman >/dev/null 2>&1 && podman container exists "${BISA_PG_CONTAINER:-bisa-pg}"; then
  podman exec -i "${BISA_PG_CONTAINER:-bisa-pg}" pg_restore "${restore_args[@]}" --dbname="$RESTORE_TARGET_URL" < "$restore_file"
else
  echo "pg_restore tidak ditemukan. Pasang postgresql-client atau jalankan PostgreSQL di container ${BISA_PG_CONTAINER:-bisa-pg}." >&2
  exit 1
fi
echo "Restore selesai. Verifikasi aplikasi dan rekonsiliasi data sebelum mengalihkan layanan ke $target_label."
