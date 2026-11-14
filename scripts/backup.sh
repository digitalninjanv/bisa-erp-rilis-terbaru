#!/usr/bin/env bash
# Dump the Bisa ERP database to ./backups.
# Uses DIRECT_URL (schema owner) so the dump includes RLS policies and grants.
#
# Encryption is mandatory: BACKUP_PASSPHRASE_FILE (preferred) or the
# manual BACKUP_PASSPHRASE input produces authenticated AES-256-GCM.
# Plaintext dumps are forbidden.
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
if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
  [[ -r "$BACKUP_PASSPHRASE_FILE" && -s "$BACKUP_PASSPHRASE_FILE" ]] || {
    echo "BACKUP_PASSPHRASE_FILE tidak dapat dibaca atau kosong; backup plaintext tidak diizinkan." >&2
    exit 1
  }
else
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE atau BACKUP_PASSPHRASE_FILE wajib diatur; backup plaintext tidak diizinkan}"
fi

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
command -v flock >/dev/null 2>&1 || {
  echo "flock tidak ditemukan; backup dihentikan agar penulisan arsip/manifest tidak berjalan bersamaan." >&2
  exit 1
}
exec 9>"$backup_dir/.backup.lock"
if ! flock -w 1800 9; then
  echo "Backup lain masih berjalan setelah menunggu 30 menit; tidak ada arsip baru yang ditulis." >&2
  exit 1
fi

# PID prevents filename collisions if two sequential, very short backups
# begin within the same wall-clock second.
stamp="$(date +%Y%m%d-%H%M%S)-$$"
file="$backup_dir/bisa-${stamp}.dump"
tmpfile="${file}.tmp"
enc_tmp="${file}.enc.tmp"
manifest_tmp=""
sidecar_tmp=""
# Temporary artifacts must never look like completed backups and must
# be removed even when validation, encryption, or manifest writing fails.
cleanup() {
  [[ -z "$tmpfile" || ! -e "$tmpfile" ]] || rm -f -- "$tmpfile"
  [[ -z "$enc_tmp" || ! -e "$enc_tmp" ]] || rm -f -- "$enc_tmp"
  [[ -z "$manifest_tmp" || ! -e "$manifest_tmp" ]] || rm -f -- "$manifest_tmp"
  [[ -z "$sidecar_tmp" || ! -e "$sidecar_tmp" ]] || rm -f -- "$sidecar_tmp"
}
trap cleanup EXIT

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

# Verify the custom archive before publishing it or updating its manifest.
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$tmpfile" >/dev/null
elif command -v podman >/dev/null 2>&1 && podman container exists "${BISA_PG_CONTAINER:-bisa-pg}"; then
  podman exec -i "${BISA_PG_CONTAINER:-bisa-pg}" pg_restore --list < "$tmpfile" >/dev/null
else
  echo "pg_restore tidak ditemukan; backup belum dipublikasikan karena arsip tidak dapat diverifikasi." >&2
  exit 1
fi

encfile="${file}.enc"
if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
  BACKUP_PASSPHRASE_FILE="$BACKUP_PASSPHRASE_FILE" node scripts/backup-crypto.mjs encrypt "$tmpfile" "$enc_tmp"
else
  BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" node scripts/backup-crypto.mjs encrypt "$tmpfile" "$enc_tmp"
fi
mv "$enc_tmp" "$encfile"
rm -f "$tmpfile"
final_file="$encfile"
encrypted="true"
echo "Backup terenkripsi selesai: $encfile"

# A-28 Tahap 6 (H-X-01): manifest status backup. Ditulis atomik di
# direktori backup yang sama dan dibaca aplikasi (Pengaturan → Status
# sistem, src/server/backup-status.ts) untuk menampilkan backup
# terakhir + peringatan backup basi. Manifest BUKAN sumber kebenaran
# cadangan — berkas .dump.enc itulah cadangannya; manifest hanya catatan.
manifest="$backup_dir/backup-manifest.json"
manifest_tmp="${manifest}.tmp"
size_bytes="$(stat -c %s "$final_file")"
sha256="$(sha256sum "$final_file" | awk '{print $1}')"
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sidecar="${final_file}.json"
sidecar_tmp="${sidecar}.tmp"
printf '{\n  "version": 1,\n  "file": "%s",\n  "finishedAt": "%s",\n  "sizeBytes": %s,\n  "sha256": "%s",\n  "encrypted": %s,\n  "archiveListVerified": true\n}\n' \
  "$(basename "$final_file")" "$finished_at" "$size_bytes" "$sha256" "$encrypted" > "$sidecar_tmp"
if [[ -n "${BACKUP_STATUS_GROUP:-}" ]]; then
  chgrp "$BACKUP_STATUS_GROUP" "$sidecar_tmp"
  chmod 640 "$sidecar_tmp"
fi
mv "$sidecar_tmp" "$sidecar"
printf '{\n  "version": 1,\n  "file": "%s",\n  "finishedAt": "%s",\n  "sizeBytes": %s,\n  "sha256": "%s",\n  "encrypted": %s\n}\n' \
  "$(basename "$final_file")" "$finished_at" "$size_bytes" "$sha256" "$encrypted" > "$manifest_tmp"
if [[ -n "${BACKUP_STATUS_GROUP:-}" ]]; then
  chgrp "$BACKUP_STATUS_GROUP" "$manifest_tmp"
  chmod 640 "$manifest_tmp"
fi
mv "$manifest_tmp" "$manifest"
echo "Manifest backup diperbarui: $manifest"
