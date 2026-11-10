#!/usr/bin/env bash
# A-24 T5 — one scheduled production backup + retention + optional offsite.
#
# Runs scripts/backup.sh (the project's own, proven in
# docs/RUNBOOK-BACKUP-RESTORE.md) against the production env, keeps the
# retention written in ONE place (/etc/bisa-erp/backup.conf), and —
# only when the owner configured it — ships a copy off the machine.
#
# Called by bisa-erp-backup.service (systemd timer) or by hand:
#   sudo /opt/bisa-erp/current/deploy/backup-run.sh
# deploy/update.sh also calls it before every update; a failed backup
# aborts the update.
set -euo pipefail

CONF="${BISA_BACKUP_CONF:-/etc/bisa-erp/backup.conf}"
if [[ -f "$CONF" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONF"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/bisa-erp}"
RETENTION_DAILY="${RETENTION_DAILY:-14}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"
APP_HOME="${BISA_HOME:-/opt/bisa-erp/current}"
export BACKUP_DIR
if [[ -n "${PG_BIN:-}" ]]; then
  export PATH="${PG_BIN}:$PATH"
fi

log() { echo "[backup $(date -Is)] $*"; }

[[ -x "$APP_HOME/scripts/backup.sh" ]] || {
  log "GAGAL: $APP_HOME/scripts/backup.sh tidak ditemukan."
  exit 1
}
mkdir -p "$BACKUP_DIR"

# Snapshot of what exists before, so we can name the new file afterwards.
before_list="$(mktemp)"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bisa-*.dump*' | sort > "$before_list" || true

log "menjalankan pg_dump melalui scripts/backup.sh …"
# backup.sh cd's to its own tree root (the active release) and sources
# the release's .env.local, which install.sh symlinks to the production
# env file — so DIRECT_URL here is always the production database.
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}" bash "$APP_HOME/scripts/backup.sh"

new_file="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bisa-*.dump*' -newer "$before_list" | sort | tail -1 || true)"
rm -f "$before_list"
if [[ -z "$new_file" ]]; then
  # Fallback: the newest file by mtime (same-second runs can confuse -newer).
  new_file="$(ls -t "$BACKUP_DIR"/bisa-*.dump* 2>/dev/null | head -1 || true)"
fi
[[ -n "$new_file" && -s "$new_file" ]] || {
  log "GAGAL: tidak ada berkas cadangan baru yang valid."
  exit 1
}
log "cadangan baru: $new_file ($(du -h "$new_file" | awk '{print $1}'))"

# --- Retention -------------------------------------------------------
# Keep the newest RETENTION_DAILY files. From the remainder, also keep
# the newest file of each of the last RETENTION_WEEKLY distinct ISO
# weeks. Delete the rest. Only ever touches bisa-*.dump* in BACKUP_DIR.
mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bisa-*.dump*' -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
total=${#files[@]}
declare -A keep=()
for ((i = 0; i < total && i < RETENTION_DAILY; i++)); do
  keep["${files[i]}"]=1
done
weeks_kept=0
declare -A week_seen=()
for ((i = RETENTION_DAILY; i < total && weeks_kept < RETENTION_WEEKLY; i++)); do
  f="${files[i]}"
  wk="$(date -d "@$(stat -c %Y "$f")" +%G-W%V)"
  if [[ -z "${week_seen[$wk]:-}" ]]; then
    week_seen[$wk]=1
    keep["$f"]=1
    weeks_kept=$((weeks_kept + 1))
  fi
done
removed=0
for f in "${files[@]}"; do
  if [[ -z "${keep[$f]:-}" ]]; then
    log "retensi: menghapus $f"
    rm -f "$f"
    removed=$((removed + 1))
  fi
done
log "retensi selesai: disimpan $((total - removed)) berkas, dihapus $removed."

# --- Optional offsite copy (OFF by default; owner's decision) --------
if [[ -n "${OFFSITE_CMD:-}" ]]; then
  log "mengirim salinan ke luar mesin…"
  NEWFILE="$new_file" bash -c "$OFFSITE_CMD"
  log "salinan luar selesai."
fi

log "backup selesai."
