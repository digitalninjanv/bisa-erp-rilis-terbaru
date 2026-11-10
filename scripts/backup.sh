#!/usr/bin/env bash
# Dump the Bisa ERP database to ./backups.
# Uses DIRECT_URL (schema owner) so the dump includes RLS policies and grants.
#
# Optional encryption: set BACKUP_PASSPHRASE to produce an AES-256 encrypted
# backup (openssl, PBKDF2) named *.dump.enc instead of a plain *.dump.
# Restore it with scripts/restore.sh and the same BACKUP_PASSPHRASE.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${DIRECT_URL:?DIRECT_URL is required}"

# AUD-021 (Audit Produksi A4): blok fallback biner klien PostgreSQL —
# disamakan persis dengan scripts/restore-drill.sh. PG_BIN dari
# /etc/bisa-erp/backup.conf menunjuk folder bin PostgreSQL produksi;
# tanpa blok ini backup di mesin dev gagal "pg_dump tidak ditemukan"
# padahal biner klien PG18 ada di .local/pg18-client.
if [[ -n "${PG_BIN:-}" ]]; then
  export PATH="${PG_BIN}:$PATH"
fi
# Client tools PG18 di lingkungan dev tidak selalu di PATH.
if ! command -v pg_dump >/dev/null 2>&1 && [[ -x .local/pg18-client/usr/lib/postgresql/18/bin/pg_dump ]]; then
  export PATH="$PWD/.local/pg18-client/usr/lib/postgresql/18/bin:$PATH"
  export LD_LIBRARY_PATH="$PWD/.local/pg18-client/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# A-24 T5: production installs keep backups outside the release folder
# (BACKUP_DIR, set by deploy/backup-run.sh / /etc/bisa-erp/backup.conf).
# Default stays ./backups so developer behaviour is unchanged.
backup_dir="${BACKUP_DIR:-backups}"
mkdir -p "$backup_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
file="$backup_dir/bisa-${stamp}.dump"
tmpfile="${file}.tmp"
# Never leave a partial/empty file behind that looks like a finished backup.
trap 'rm -f "$tmpfile"' ERR

pg_dump_args=(--format=custom --no-owner --no-privileges)

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "${pg_dump_args[@]}" --file="$tmpfile" "$DIRECT_URL"
elif command -v podman >/dev/null 2>&1 && podman container exists "${BISA_PG_CONTAINER:-bisa-pg}"; then
  # Local dev often runs PostgreSQL in the bisa-pg container without host client tools.
  podman exec -i "${BISA_PG_CONTAINER:-bisa-pg}" pg_dump "${pg_dump_args[@]}" "$DIRECT_URL" > "$tmpfile"
else
  echo "pg_dump tidak ditemukan. Pasang postgresql-client atau jalankan PostgreSQL di container ${BISA_PG_CONTAINER:-bisa-pg}." >&2
  exit 1
fi

if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  encfile="${file}.enc"
  openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$tmpfile" -out "$encfile"
  rm -f "$tmpfile"
  trap - ERR
  final_file="$encfile"
  encrypted="true"
  echo "Backup terenkripsi selesai: $encfile"
else
  mv "$tmpfile" "$file"
  trap - ERR
  final_file="$file"
  encrypted="false"
  echo "Backup selesai: $file"
fi

# A-28 Tahap 6 (H-X-01): manifest status backup. Ditulis atomik di
# direktori backup yang sama dan dibaca aplikasi (Pengaturan → Status
# sistem, src/server/backup-status.ts) untuk menampilkan backup
# terakhir + peringatan backup basi. Manifest BUKAN sumber kebenaran
# cadangan — berkas .dump itulah cadangannya; manifest hanya catatan.
manifest="$backup_dir/backup-manifest.json"
manifest_tmp="${manifest}.tmp"
size_bytes="$(stat -c %s "$final_file")"
sha256="$(sha256sum "$final_file" | awk '{print $1}')"
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{\n  "version": 1,\n  "file": "%s",\n  "finishedAt": "%s",\n  "sizeBytes": %s,\n  "sha256": "%s",\n  "encrypted": %s\n}\n' \
  "$(basename "$final_file")" "$finished_at" "$size_bytes" "$sha256" "$encrypted" > "$manifest_tmp"
mv "$manifest_tmp" "$manifest"
echo "Manifest backup diperbarui: $manifest"
