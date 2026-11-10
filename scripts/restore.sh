#!/usr/bin/env bash
# Restore a custom-format dump created by scripts/backup.sh.
# Usage: scripts/restore.sh backups/bisa-YYYYMMDD-HHMMSS.dump --yes
# Encrypted backups (*.dump.enc) need the same BACKUP_PASSPHRASE that
# created them in the environment.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${DIRECT_URL:?DIRECT_URL is required}"

file="${1:-}"
confirm="${2:-}"

if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: scripts/restore.sh <dump-file> --yes" >&2
  exit 1
fi

if [[ "$confirm" != "--yes" ]]; then
  echo "Restore akan menimpa data pada database tujuan." >&2
  echo "Jalankan ulang dengan --yes setelah yakin: scripts/restore.sh $file --yes" >&2
  exit 1
fi

# Encrypted backups are decrypted to a temp file that is always removed.
restore_file="$file"
cleanup() { if [[ "$restore_file" != "$file" ]]; then rm -f "$restore_file"; fi; }
trap cleanup EXIT
if [[ "$file" == *.enc ]]; then
  if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
    echo "Berkas terenkripsi: atur BACKUP_PASSPHRASE yang sama dengan saat backup dibuat." >&2
    exit 1
  fi
  restore_file="$(mktemp ./backups/.restore-XXXXXX.dump)"
  openssl enc -d -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$file" -out "$restore_file"
fi

echo "Memulihkan $file ke database tujuan..."
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DIRECT_URL" "$restore_file"
elif command -v podman >/dev/null 2>&1 && podman container exists "${BISA_PG_CONTAINER:-bisa-pg}"; then
  podman exec -i "${BISA_PG_CONTAINER:-bisa-pg}" pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DIRECT_URL" < "$restore_file"
else
  echo "pg_restore tidak ditemukan. Pasang postgresql-client atau jalankan PostgreSQL di container ${BISA_PG_CONTAINER:-bisa-pg}." >&2
  exit 1
fi
echo "Restore selesai."
