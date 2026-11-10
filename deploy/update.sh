#!/usr/bin/env bash
# A-24 T5 — safe production update (Jalur 2: systemd). The step order
# cannot be skipped:
#
#   1. BACKUP first (failure = update aborted, nothing touched)
#   2. unpack the new release BESIDE the old one
#   3. run migrations forward (explicit, logged, counted)
#   4. switch the `current` symlink + restart the service
#   5. verify health + login page (+ real login & one page per module
#      when BISA_VERIFY_EMAIL / BISA_VERIFY_PASSWORD are provided)
#
# Honest rollback rule: if verification fails and step 3 applied ZERO
# migrations, the symlink is switched back automatically. If migrations
# WERE applied, code rollback is a lie — the script stops and prints
# the exact backup file to restore (docs/RUNBOOK-BACKUP-RESTORE.md).
#
#   sudo bash deploy/update.sh /path/to/bisa-erp-<versi-baru>.tar.gz
#
# Everything is logged to /var/log/bisa-erp/update-<waktu>.log as well
# as the terminal.
set -euo pipefail

TARBALL="${1:-}"
BISA_ROOT="${BISA_ROOT:-/opt/bisa-erp}"
CONFDIR="${BISA_CONFDIR:-/etc/bisa-erp}"
BACKUP_DIR="${BISA_BACKUP_DIR:-/var/backups/bisa-erp}"
ENV_FILE="$CONFDIR/bisa-erp.env"
SERVICE="${BISA_SERVICE:-bisa-erp}"
LOG_DIR="${BISA_LOG_DIR:-/var/log/bisa-erp}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/update-$STAMP.log"
exec > >(tee -a "$LOG_FILE") 2>&1

say() { echo "[update $(date -Is)] $*"; }
die() { say "GAGAL: $*"; exit 1; }

[[ "$(id -u)" == "0" ]] || die "jalankan sebagai root (sudo)."
[[ -n "$TARBALL" && -f "$TARBALL" ]] || die "pemakaian: update.sh <bisa-erp-<versi-baru>.tar.gz>"
[[ -L "$BISA_ROOT/current" ]] || die "$BISA_ROOT/current tidak ada — jalankan install.sh dulu."
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE tidak ada."

PREV_DIR="$(readlink -f "$BISA_ROOT/current")"
PREV_VERSION="$(cat "$PREV_DIR/VERSION")"
say "versi berjalan: $PREV_VERSION · log: $LOG_FILE"

peek="$(mktemp -d)"
tar -xzf "$TARBALL" -C "$peek"
new_name="$(find "$peek" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | head -1)"
[[ -n "$new_name" && -f "$peek/$new_name/VERSION" ]] || die "tarball tidak valid."
NEW_VERSION="$(cat "$peek/$new_name/VERSION")"
if [[ "$NEW_VERSION" == "$PREV_VERSION" && "${BISA_FORCE:-0}" != "1" ]]; then
  die "versi baru sama dengan yang berjalan ($NEW_VERSION). Pakai BISA_FORCE=1 bila disengaja."
fi
say "versi tujuan: $NEW_VERSION"

# --- 1. backup dulu ---------------------------------------------------
say "langkah 1/5: backup database (gagal = batal)…"
BISA_HOME="$PREV_DIR" bash "$PREV_DIR/deploy/backup-run.sh"
newest_backup="$(ls -t "$BACKUP_DIR"/bisa-*.dump* 2>/dev/null | head -1 || true)"
[[ -n "$newest_backup" && -s "$newest_backup" ]] || die "backup tidak menghasilkan berkas — pembaruan DIBATALKAN."
say "backup aman: $newest_backup"

# --- 2. ekstrak rilis baru di samping yang lama -----------------------
NEW_DIR="$BISA_ROOT/releases/$NEW_VERSION"
if [[ -d "$NEW_DIR" ]]; then
  say "langkah 2/5: rilis $NEW_VERSION sudah ada — dipakai ulang."
  rm -rf "$peek"
else
  say "langkah 2/5: mengekstrak rilis baru…"
  mkdir -p "$BISA_ROOT/releases"
  mv "$peek/$new_name" "$NEW_DIR"
  rm -rf "$peek"
fi
chown -R bisa:bisa "$NEW_DIR"
# Same mode normalization as install.sh (build-machine umask must not
# lock the service user out of the new tree).
chmod -R a+rX "$NEW_DIR"
ln -sfn "$ENV_FILE" "$NEW_DIR/.env.local"

# --- 3. migrasi maju ---------------------------------------------------
say "langkah 3/5: migrasi database…"
set -a; source "$ENV_FILE"; set +a
migrate_out="$(node "$NEW_DIR/migrate.mjs" "$NEW_DIR/migrations")" || die "migrasi GAGAL — rilis lama masih aktif, tidak ada yang dialihkan. Keluaran: $migrate_out"
say "$migrate_out"
applied="$(echo "$migrate_out" | sed -n 's/.*diterapkan=\([0-9]*\).*/\1/p' | tail -1)"
applied="${applied:-0}"

# --- 4. alihkan current + restart --------------------------------------
say "langkah 4/5: mengalihkan current → $NEW_VERSION & restart layanan…"
ln -sfn "$NEW_DIR" "$BISA_ROOT/current"
systemctl restart "$SERVICE"

# --- 5. verifikasi ------------------------------------------------------
APP_PORT="$(sed -n 's|^PORT=||p' "$ENV_FILE" | head -1)"; APP_PORT="${APP_PORT:-3000}"
say "langkah 5/5: verifikasi /api/health + halaman login…"
verify_ok=1
for i in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:${APP_PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  [[ "$i" == "30" ]] && verify_ok=0
  sleep 2
done
if [[ "$verify_ok" == "1" ]]; then
  code="$(node -e "fetch('http://127.0.0.1:${APP_PORT}/login').then(r=>console.log(r.status)).catch(()=>console.log(0))")"
  [[ "$code" == "200" ]] || { verify_ok=0; say "halaman /login menjawab $code, bukan 200."; }
fi
if [[ "$verify_ok" == "1" && -n "${BISA_VERIFY_EMAIL:-}" && -n "${BISA_VERIFY_PASSWORD:-}" ]]; then
  say "verifikasi login sungguhan + satu halaman per modul…"
  # The Origin must equal BETTER_AUTH_URL exactly (localhost vs
  # 127.0.0.1 are different origins to the auth origin check) — the
  # transport may still go to 127.0.0.1.
  AUTH_URL="$(grep '^BETTER_AUTH_URL=' "$ENV_FILE" | cut -d= -f2-)"
  if ! BISA_VERIFY_EMAIL="$BISA_VERIFY_EMAIL" BISA_VERIFY_PASSWORD="$BISA_VERIFY_PASSWORD" BISA_VERIFY_ORIGIN="$AUTH_URL" APP_PORT="$APP_PORT" node <<'NODE'
const base = `http://127.0.0.1:${process.env.APP_PORT}`;
const pages = ["/app/pos", "/app/gudang", "/app/akuntansi", "/app/akuntansi/payroll"];
const res = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  // Better Auth's origin check rejects sign-ins without a matching
  // Origin (a bare fetch gets 403; browsers always send it). Caught
  // in the T5 machine test — the origin must be the server's own base.
  headers: { "content-type": "application/json", origin: process.env.BISA_VERIFY_ORIGIN || base },
  body: JSON.stringify({ email: process.env.BISA_VERIFY_EMAIL, password: process.env.BISA_VERIFY_PASSWORD }),
});
if (!res.ok) { console.error(`login gagal: HTTP ${res.status}`); process.exit(1); }
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!cookie) { console.error("login tidak mengembalikan cookie sesi."); process.exit(1); }
for (const p of pages) {
  const r = await fetch(`${base}${p}`, { headers: { cookie }, redirect: "manual" });
  if (r.status !== 200) { console.error(`${p} -> HTTP ${r.status}`); process.exit(1); }
  console.log(`${p} -> 200`);
}
NODE
  then
    verify_ok=0
    say "verifikasi login/halaman modul GAGAL."
  fi
fi

# --- hasil & rollback jujur ---------------------------------------------
if [[ "$verify_ok" == "1" ]]; then
  say "PEMBARUAN BERHASIL: $PREV_VERSION → $NEW_VERSION (migrasi diterapkan: $applied)."
  # Prune: keep the 3 newest release dirs, never the symlink targets' set below 2.
  ls -dt "$BISA_ROOT"/releases/*/ 2>/dev/null | tail -n +4 | while read -r old; do
    if [[ "$(readlink -f "$BISA_ROOT/current")" != "${old%/}" ]]; then
      say "memangkas rilis lama: $old"
      rm -rf "$old"
    fi
  done
  exit 0
fi

say "VERIFIKASI GAGAL sesudah pengalihan ke $NEW_VERSION."
if [[ "$applied" == "0" ]]; then
  say "migrasi tidak menerapkan apa pun — mengalihkan kembali ke $PREV_VERSION…"
  ln -sfn "$PREV_DIR" "$BISA_ROOT/current"
  systemctl restart "$SERVICE"
  say "ROLLBACK SELESAI: layanan kembali di versi $PREV_VERSION. Rilis $NEW_VERSION dibiarkan di disk untuk diperiksa."
  exit 2
fi
say "migrasi SUDAH menerapkan $applied perubahan — downgrade kode TIDAK aman dan tidak dilakukan."
say "Pemulihan yang benar: restore backup pra-pembaruan ini:"
say "  berkas: $newest_backup"
say "  cara  : ikuti docs/RUNBOOK-BACKUP-RESTORE.md (pnpm db:restore dari checkout, atau pg_restore manual)."
say "Layanan dibiarkan berjalan di $NEW_VERSION agar operator bisa memeriksa log: journalctl -u $SERVICE -n 100"
exit 3
