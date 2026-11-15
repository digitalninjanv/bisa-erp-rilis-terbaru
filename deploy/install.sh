#!/usr/bin/env bash
# A-24 T5 — Jalur 2: install Bisa ERP WITHOUT Docker (systemd).
#
# Idempotent: safe to re-run. It never overwrites the production env
# file, never re-extracts an identical release, and re-running it is
# also how a broken service gets its units/permissions re-asserted.
#
#   sudo bash deploy/install.sh /path/to/bisa-erp-<versi>.tar.gz
#
# Layout it creates:
#   /opt/bisa-erp/releases/<versi>/   release trees (root of the artifact)
#   /opt/bisa-erp/current             symlink to the active release
#   /etc/bisa-erp/bisa-erp.env        production env (mode 600, created once)
#   /etc/bisa-erp/backup.conf         backup retention config (created once)
#   /var/backups/bisa-erp/            backup files
#   /etc/systemd/system/bisa-erp.service, bisa-erp-backup.{service,timer}
#
# PostgreSQL 18 is REQUIRED (the schema uses native uuidv7()). The
# installer uses an existing PG18 cluster when present, installs the
# postgresql-18 package when apt offers it, or adds the official PGDG
# apt repository first. Escape hatch for an externally managed PG18:
#   BISA_SKIP_PG_INSTALL=1 BISA_PG_ADMIN_URL=postgres://postgres@host:5432/postgres
#
# Other overrides: BISA_ROOT, BISA_CONFDIR, BISA_BACKUP_DIR,
# BISA_SYSTEMD_DIR, BISA_PG_PORT (5432), BISA_APP_PORT (3000),
# BISA_AUTH_URL (default http://<IP LAN>:<port>), BISA_PG_BIN.
# Demo seeding is intentionally NOT part of this installer: the seed
# script imports the full source tree and runs from a source checkout
# (see the runbook). Production stores start empty and register their
# first owner in the app.
set -euo pipefail

TARBALL="${1:-}"
BISA_ROOT="${BISA_ROOT:-/opt/bisa-erp}"
CONFDIR="${BISA_CONFDIR:-/etc/bisa-erp}"
BACKUP_DIR="${BISA_BACKUP_DIR:-/var/backups/bisa-erp}"
SYSTEMD_DIR="${BISA_SYSTEMD_DIR:-/etc/systemd/system}"
ENV_FILE="$CONFDIR/bisa-erp.env"
PG_PORT="${BISA_PG_PORT:-5432}"
APP_PORT="${BISA_APP_PORT:-3000}"
# SEC-013/HTTPS: produksi default-nya dilayani lewat reverse proxy TLS
# lokal (nginx) di 443. Set BISA_HTTPS=0 hanya untuk uji LAN yang
# disengaja; env aplikasi lalu menulis BISA_ALLOW_INSECURE_AUTH_URL=1.
HTTPS_ENABLED="${BISA_HTTPS:-1}"
HTTPS_PORT="${BISA_HTTPS_PORT:-443}"
TLS_DIR="${BISA_TLS_DIR:-$CONFDIR/tls}"
TLS_CERT="${BISA_TLS_CERT:-$TLS_DIR/server.crt}"
TLS_KEY="${BISA_TLS_KEY:-$TLS_DIR/server.key}"
TLS_SERVER_NAME="${BISA_TLS_SERVER_NAME:-}"
[[ "$HTTPS_ENABLED" == "0" || "$HTTPS_ENABLED" == "1" ]] || die "BISA_HTTPS harus 0 atau 1."
[[ "$HTTPS_PORT" =~ ^[0-9]+$ ]] || die "BISA_HTTPS_PORT harus angka."
if [[ -n "${BISA_TLS_CERT:-}" || -n "${BISA_TLS_KEY:-}" ]]; then
  [[ -n "${BISA_TLS_CERT:-}" && -n "${BISA_TLS_KEY:-}" ]] \
    || die "BISA_TLS_CERT dan BISA_TLS_KEY harus diisi berpasangan."
  [[ -r "$BISA_TLS_CERT" && -r "$BISA_TLS_KEY" ]] \
    || die "sertifikat/kunci TLS tidak dapat dibaca: $BISA_TLS_CERT / $BISA_TLS_KEY."
fi
PG_DB="bisa"
APP_OS_USER="bisa"

say() { echo "[install] $*"; }
die() { echo "[install] GAGAL: $*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || die "jalankan sebagai root (sudo)."
[[ -n "$TARBALL" && -f "$TARBALL" ]] || die "pemakaian: install.sh <bisa-erp-<versi>.tar.gz>"

# ---------------------------------------------------------------- prereq
if ! command -v node >/dev/null 2>&1; then
  say "Node.js belum ada — memasang Node 24 LTS (NodeSource)…"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1 || die "pasang NodeSource gagal — pasang Node 24 LTS manual lalu ulangi."
    apt-get install -y nodejs >/dev/null 2>&1 || die "apt install nodejs gagal."
  else
    die "Node.js tidak ditemukan dan curl tidak ada untuk memasangnya. Pasang Node 24 LTS manual."
  fi
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" -ge 20 ]] || die "Node >= 20.9 wajib (ditemukan v$(node -v))."
say "Node $(node -v) OK."
if ! command -v pnpm >/dev/null 2>&1; then
  # Runtime does not need pnpm (standalone + migrate.mjs), but operator
  # tooling does; install best-effort via corepack.
  corepack enable 2>/dev/null && corepack prepare pnpm@11.8.0 --activate 2>/dev/null \
    && say "pnpm 11.8.0 OK (corepack)." || say "CATATAN: pnpm tidak terpasang — tidak fatal untuk runtime."
fi
command -v openssl >/dev/null 2>&1 || die "openssl wajib ada (pembuatan secret & backup terenkripsi)."

# ---------------------------------------------------------------- release
stage_tmp="$(mktemp -d)"
tar -xzf "$TARBALL" -C "$stage_tmp"
release_name="$(find "$stage_tmp" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | head -1)"
[[ -n "$release_name" && -f "$stage_tmp/$release_name/VERSION" ]] || die "tarball tidak berisi rilis Bisa ERP yang valid."
VERSION="$(cat "$stage_tmp/$release_name/VERSION")"
say "rilis: $release_name (versi $VERSION)"

id "$APP_OS_USER" >/dev/null 2>&1 || useradd --system --home-dir /var/lib/bisa-erp --shell /usr/sbin/nologin "$APP_OS_USER"
mkdir -p "$BISA_ROOT/releases" "$CONFDIR" "$BACKUP_DIR" /var/lib/bisa-erp
if [[ -d "$BISA_ROOT/releases/$VERSION" ]]; then
  say "rilis $VERSION sudah terekstrak — dilewati (idempoten)."
  rm -rf "$stage_tmp"
else
  mv "$stage_tmp/$release_name" "$BISA_ROOT/releases/$VERSION"
  rm -rf "$stage_tmp"
fi
RELEASE_DIR="$BISA_ROOT/releases/$VERSION"
chown -R "$APP_OS_USER:$APP_OS_USER" "$RELEASE_DIR"
# Normalize modes: the tarball inherits the build machine's umask (a
# 007 umask there would lock the service user out of its own tree —
# caught in the T5 machine test as systemd status 200/CHDIR). The
# release tree contains no secrets (env lives outside it), so making
# it world-readable/executable is safe and deterministic.
chmod 755 "$BISA_ROOT" "$BISA_ROOT/releases"
chmod -R a+rX "$RELEASE_DIR"

# ---------------------------------------------------------------- env file
if [[ "$HTTPS_ENABLED" == "1" ]]; then
  if [[ -z "$TLS_SERVER_NAME" ]]; then
    # Default ke IP LAN: itulah alamat yang diketik kasir, sehingga
    # BETTER_AUTH_URL dan SAN sertifikat cocok tanpa DNS internal.
    TLS_SERVER_NAME="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [[ -n "$TLS_SERVER_NAME" ]] || TLS_SERVER_NAME="$(hostname -f 2>/dev/null || true)"
    [[ -n "$TLS_SERVER_NAME" ]] || TLS_SERVER_NAME="ALAMAT-SERVER"
  fi
  if [[ -n "${BISA_AUTH_URL:-}" ]]; then
    auth_url="$BISA_AUTH_URL"
    [[ "$auth_url" == https://* ]] || die "BISA_HTTPS=1 membutuhkan BISA_AUTH_URL https://."
  elif [[ "$HTTPS_PORT" == "443" ]]; then
    auth_url="https://${TLS_SERVER_NAME}"
  else
    auth_url="https://${TLS_SERVER_NAME}:${HTTPS_PORT}"
  fi
  app_bind_host="127.0.0.1"
else
  if [[ -n "${BISA_AUTH_URL:-}" ]]; then
    auth_url="$BISA_AUTH_URL"
  else
    lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    auth_url="http://${lan_ip:-ALAMAT-SERVER}:${APP_PORT}"
  fi
  app_bind_host="0.0.0.0"
fi
if [[ -f "$ENV_FILE" ]]; then
  say "env produksi sudah ada ($ENV_FILE) — TIDAK ditimpa."
else
  erp_pw="$(openssl rand -hex 24)"
  app_pw="$(openssl rand -hex 24)"
  secret="$(openssl rand -hex 32)"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Produksi Bisa ERP — dibuat install.sh $(date -Is). RAHASIA (mode 600).
NODE_ENV=production
PORT=$APP_PORT
HOSTNAME=$app_bind_host
DATABASE_URL=postgres://app_user:${app_pw}@127.0.0.1:${PG_PORT}/${PG_DB}
DIRECT_URL=postgres://erp:${erp_pw}@127.0.0.1:${PG_PORT}/${PG_DB}
BETTER_AUTH_SECRET=$secret
BETTER_AUTH_URL=$auth_url
NEXT_PUBLIC_APP_NAME="Bisa ERP"
EOF
  if [[ "$HTTPS_ENABLED" == "1" ]]; then
    echo "BISA_TRUSTED_PROXIES=127.0.0.1" >> "$ENV_FILE"
  else
    echo "BISA_ALLOW_INSECURE_AUTH_URL=1" >> "$ENV_FILE"
    say "PERINGATAN: HTTPS dimatikan (BISA_HTTPS=0) — cookie sesi tidak Secure. Hanya untuk uji lokal/LAN tepercaya."
  fi
  # Test/local-only escape hatch, mirroring the app's own flag: only
  # written when the operator explicitly exports it for this install
  # (e.g. a localhost acceptance test). A LAN BETTER_AUTH_URL never
  # needs it, and the runbook tells operators not to use it in shops.
  if [[ "${BISA_ALLOW_LOCALHOST_AUTH_URL:-}" == "1" ]]; then
    echo "BISA_ALLOW_LOCALHOST_AUTH_URL=1" >> "$ENV_FILE"
    say "CATATAN: BISA_ALLOW_LOCALHOST_AUTH_URL=1 ditulis ke env (mode uji lokal)."
  fi
  say "env produksi dibuat: $ENV_FILE (BETTER_AUTH_URL=$auth_url)"
fi
chmod 600 "$ENV_FILE"
if [[ "$HTTPS_ENABLED" == "1" ]]; then
  current_auth="$(sed -n 's/^BETTER_AUTH_URL=//p' "$ENV_FILE" | tail -1)"
  if [[ "$current_auth" == http://* ]]; then
    die "$ENV_FILE masih memakai BETTER_AUTH_URL=$current_auth. Ubah ke $auth_url (dan HOSTNAME=127.0.0.1) atau jalankan ulang dengan BISA_HTTPS=0 untuk uji LAN."
  fi
  grep -q '^BISA_TRUSTED_PROXIES=' "$ENV_FILE" || echo "BISA_TRUSTED_PROXIES=127.0.0.1" >> "$ENV_FILE"
fi
# Passwords are read back from the env file so re-runs sync the DB roles
# to the file (never the other way around).
erp_pw="$(sed -n 's|^DIRECT_URL=postgres://erp:\([^@]*\)@.*|\1|p' "$ENV_FILE")"
app_pw="$(sed -n 's|^DATABASE_URL=postgres://app_user:\([^@]*\)@.*|\1|p' "$ENV_FILE")"
[[ -n "$erp_pw" && -n "$app_pw" ]] || die "tidak bisa membaca sandi dari $ENV_FILE."
APP_PORT="$(sed -n 's|^PORT=||p' "$ENV_FILE" | head -1)"; APP_PORT="${APP_PORT:-3000}"
PG_PORT="$(sed -n 's|^DIRECT_URL=postgres://[^@]*@[^:]*:\([0-9]*\)/.*|\1|p' "$ENV_FILE" | head -1)"; PG_PORT="${PG_PORT:-5432}"

# The release's backup tooling sources .env.local inside its own tree;
# point it at the one production env file.
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env.local"

# ---------------------------------------------------------------- PostgreSQL 18
admin_sql() {
  # $1 = SQL, executed as cluster superuser against db "postgres" (or $2).
  local db="${2:-postgres}"
  if [[ "${BISA_SKIP_PG_INSTALL:-0}" == "1" ]]; then
    psql "${BISA_PG_ADMIN_URL%/*}/$db" -v ON_ERROR_STOP=1 -q -tA -c "$1"
  else
    su -s /bin/bash postgres -c "psql -d $db -v ON_ERROR_STOP=1 -q -tA -c \"$1\""
  fi
}

if [[ "${BISA_SKIP_PG_INSTALL:-0}" == "1" ]]; then
  [[ -n "${BISA_PG_ADMIN_URL:-}" ]] || die "BISA_SKIP_PG_INSTALL=1 butuh BISA_PG_ADMIN_URL."
  command -v psql >/dev/null 2>&1 || die "psql (klien PostgreSQL) wajib ada pada mode BISA_SKIP_PG_INSTALL."
  ver="$(psql "$BISA_PG_ADMIN_URL" -tA -c 'show server_version_num')"
  [[ "$ver" -ge 180000 ]] || die "server di BISA_PG_ADMIN_URL bukan PostgreSQL 18 (server_version_num=$ver)."
  say "PostgreSQL 18 eksternal terverifikasi (mode skip-install)."
else
  if pg_lsclusters 2>/dev/null | awk '$1==18 {found=1} END {exit !found}'; then
    say "cluster PostgreSQL 18 ditemukan."
  else
    if ! apt-cache policy postgresql-18 2>/dev/null | grep -q 'Candidate: [0-9]'; then
      say "menambah repositori resmi PGDG agar postgresql-18 tersedia…"
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y -qq curl ca-certificates gnupg >/dev/null 2>&1 || die "gagal memasang prasyarat repo PGDG."
      install -d /usr/share/postgresql-common/pgdg
      curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        || die "gagal mengunduh kunci PGDG."
      codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
      echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list
      apt-get update -qq >/dev/null 2>&1 || die "apt update sesudah PGDG gagal."
    fi
    say "memasang postgresql-18…"
    DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-18 >/dev/null 2>&1 \
      || die "apt install postgresql-18 gagal — lihat keluaran apt manual."
  fi
  pg_lsclusters | awk '$1==18 {print $2, $3, $4}' | while read -r name port status; do
    if [[ "$status" != "online" ]]; then
      pg_ctlcluster 18 "$name" start || die "cluster PG18 '$name' gagal start."
    fi
    say "cluster PG18 '$name' online di port $port."
  done
  # The packaged cluster listens on 5432 by default; if the operator
  # runs it elsewhere they set BISA_PG_PORT before the first install.
fi

say "menyiapkan peran & database (idempoten)…"
# erp gets BYPASSRLS (not full SUPERUSER): the project's admin path
# (DIRECT_URL — migrations, seed, cross-company admin via adminDb)
# legitimately works across tenants, while app_user stays RLS-bound.
# A plain owner is blocked by the tenant_isolation policies (proven in
# the T5 machine test: seed failed 42501 on branches). The Docker path
# gets the same effect because POSTGRES_USER there is cluster superuser.
admin_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp') THEN CREATE ROLE erp LOGIN NOSUPERUSER CREATEDB NOCREATEROLE BYPASSRLS; END IF; END \$\$;"
admin_sql "ALTER ROLE erp WITH LOGIN BYPASSRLS PASSWORD '$erp_pw';"
admin_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END \$\$;"
admin_sql "ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '$app_pw';"
admin_sql "SELECT 1" >/dev/null 2>&1 || die "tidak bisa menjangkau PostgreSQL sebagai superuser."
db_count="$(admin_sql "SELECT count(*) FROM pg_database WHERE datname='$PG_DB'" | tr -d '[:space:]')"
if [[ "$db_count" == "0" ]]; then
  admin_sql "CREATE DATABASE $PG_DB OWNER erp"
  say "database $PG_DB dibuat (pemilik erp)."
fi
admin_sql "CREATE EXTENSION IF NOT EXISTS pg_trgm" "$PG_DB"

apply_grants() {
  # Same grant block as docker/init.sql + migration 0001 (trap RT-03):
  # default privileges make future migration tables reachable too.
  admin_sql "GRANT USAGE ON SCHEMA public TO app_user" "$PG_DB"
  admin_sql "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user" "$PG_DB" || true
  admin_sql "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user" "$PG_DB" || true
  admin_sql "ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user" "$PG_DB"
  admin_sql "ALTER DEFAULT PRIVILEGES FOR ROLE erp IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user" "$PG_DB"
}
apply_grants

# ---------------------------------------------------------------- migrations
say "menjalankan migrasi (langkah eksplisit, tercatat)…"
set -a; source "$ENV_FILE"; set +a
node "$RELEASE_DIR/migrate.mjs" "$RELEASE_DIR/migrations"
apply_grants

# ---------------------------------------------------------------- backup config
if [[ -f "$CONFDIR/backup.conf" ]]; then
  say "backup.conf sudah ada — tidak ditimpa."
else
  sed -e "s|^BACKUP_DIR=.*|BACKUP_DIR=$BACKUP_DIR|" \
      -e "s|^PG_BIN=.*|PG_BIN=${BISA_PG_BIN:-}|" \
      "$RELEASE_DIR/deploy/backup.conf.example" > "$CONFDIR/backup.conf"
  chmod 600 "$CONFDIR/backup.conf"
  say "backup.conf dibuat (retensi bawaan 14 harian + 4 mingguan)."
fi
source "$RELEASE_DIR/deploy/backup-credentials.sh"
backup_passphrase_file="/etc/credstore/bisa-erp-backup-passphrase"
mkdir -p /etc/credstore
migrate_backup_credential "$CONFDIR/backup.conf" "$backup_passphrase_file" \
  || die "gagal memigrasikan kunci backup ke credential file. Periksa $CONFDIR/backup.conf dan $backup_passphrase_file."
if [[ -e "$backup_passphrase_file" ]]; then
  chown root:root "$backup_passphrase_file"
  chmod 600 "$backup_passphrase_file"
fi
if ! grep -q '^BACKUP_STATUS_GROUP=' "$CONFDIR/backup.conf"; then
  printf '\nBACKUP_STATUS_GROUP=%s\n' "$APP_OS_USER" >> "$CONFDIR/backup.conf"
  chmod 600 "$CONFDIR/backup.conf"
fi
config_backup_dir="$(sed -n 's/^BACKUP_DIR=//p' "$CONFDIR/backup.conf" | tail -1)"
[[ -n "$config_backup_dir" ]] || die "BACKUP_DIR tidak tersedia pada $CONFDIR/backup.conf."
configured_status_dir="$(sed -n 's/^BISA_BACKUP_DIR=//p' "$ENV_FILE" | tail -1)"
if [[ -n "$configured_status_dir" && "$configured_status_dir" != "$config_backup_dir" ]]; then
  die "BISA_BACKUP_DIR pada $ENV_FILE berbeda dari BACKUP_DIR pada $CONFDIR/backup.conf; samakan keduanya sebelum instalasi."
fi
if [[ -z "$configured_status_dir" ]]; then
  printf '\nBISA_BACKUP_DIR=%s\n' "$config_backup_dir" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi
if [[ ! -s "$backup_passphrase_file" ]]; then
  say "PERHATIAN: backup otomatis belum dapat berjalan. Simpan kunci di luar server dan buat credential $backup_passphrase_file; backup plaintext ditolak."
fi
mkdir -p "$config_backup_dir"
chown root:"$APP_OS_USER" "$config_backup_dir"
chmod 750 "$config_backup_dir"

# ---------------------------------------------------------------- TLS reverse proxy
setup_https_proxy() {
  [[ "$HTTPS_ENABLED" == "1" ]] || return 0
  say "menyiapkan reverse proxy HTTPS (nginx) di port $HTTPS_PORT…"
  if ! command -v nginx >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx >/dev/null 2>&1 \
      || die "apt install nginx gagal — pasang nginx lalu ulangi."
  fi
  install -d -m 755 "$TLS_DIR"
  if [[ ! -s "$TLS_CERT" || ! -s "$TLS_KEY" ]]; then
    say "membuat sertifikat self-signed untuk $TLS_SERVER_NAME (ganti dengan sertifikat resmi bila ada)…"
    san="DNS:${TLS_SERVER_NAME}"
    if [[ "$TLS_SERVER_NAME" =~ ^[0-9.]+$ || "$TLS_SERVER_NAME" == *:* ]]; then
      san="IP:${TLS_SERVER_NAME}"
    fi
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$TLS_KEY" -out "$TLS_CERT" \
      -subj "/CN=${TLS_SERVER_NAME}" -addext "subjectAltName=${san}" >/dev/null 2>&1 \
      || die "pembuatan sertifikat TLS gagal."
    chmod 600 "$TLS_KEY"
  fi
  chmod 644 "$TLS_CERT"
  local conf="/etc/nginx/sites-available/bisa-erp.conf"
  cat > "$conf" <<NGINX
# Dibuat install.sh $(date -Is). Jangan edit langsung; ubah env lalu
# jalankan ulang installer (idempoten).
server {
  listen 80;
  listen [::]:80;
  server_name _;
  return 301 https://\$host\$request_uri;
}
server {
  listen ${HTTPS_PORT} ssl http2;
  listen [::]:${HTTPS_PORT} ssl http2;
  server_name _;
  ssl_certificate ${TLS_CERT};
  ssl_certificate_key ${TLS_KEY};
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:BisaTLS:10m;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  client_max_body_size 25m;
  proxy_read_timeout 120s;

  location / {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "";
  }
}
NGINX
  ln -sfn "$conf" /etc/nginx/sites-enabled/bisa-erp.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null 2>&1 || die "konfigurasi nginx tidak valid — periksa $conf."
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl reload nginx >/dev/null 2>&1 || systemctl restart nginx >/dev/null 2>&1 \
    || die "nginx gagal dijalankan."
  say "HTTPS aktif: $auth_url (sertifikat: $TLS_CERT)."
}
setup_https_proxy

# ---------------------------------------------------------------- systemd
ln -sfn "$RELEASE_DIR" "$BISA_ROOT/current"
if systemctl is-system-running >/dev/null 2>&1 || [[ "$(systemctl is-system-running 2>/dev/null || true)" == "degraded" ]]; then
  systemd_version="$(systemctl --version | awk 'NR == 1 { print $2 }')"
  [[ "$systemd_version" =~ ^[0-9]+$ && "$systemd_version" -ge 247 ]] || die "systemd >= 247 diperlukan untuk mengirim kunci backup melalui LoadCredential (ditemukan: ${systemd_version:-tidak diketahui})."
  install -m 644 "$RELEASE_DIR/deploy/systemd/bisa-erp.service" "$SYSTEMD_DIR/bisa-erp.service"
  install -m 644 "$RELEASE_DIR/deploy/systemd/bisa-erp-backup.service" "$SYSTEMD_DIR/bisa-erp-backup.service"
  install -m 644 "$RELEASE_DIR/deploy/systemd/bisa-erp-backup.timer" "$SYSTEMD_DIR/bisa-erp-backup.timer"
  install -m 644 "$RELEASE_DIR/deploy/systemd/bisa-erp-restore-drill.service" "$SYSTEMD_DIR/bisa-erp-restore-drill.service"
  install -m 644 "$RELEASE_DIR/deploy/systemd/bisa-erp-restore-drill.timer" "$SYSTEMD_DIR/bisa-erp-restore-drill.timer"
  systemctl daemon-reload
  systemctl enable --now bisa-erp.service >/dev/null 2>&1 || die "gagal mengaktifkan bisa-erp.service; periksa unit dan journal systemd."
  if [[ -s "$backup_passphrase_file" ]]; then
    systemctl enable --now bisa-erp-backup.timer >/dev/null 2>&1 || die "gagal mengaktifkan bisa-erp-backup.timer; backup terjadwal belum aktif."
    systemctl enable --now bisa-erp-restore-drill.timer >/dev/null 2>&1 || die "gagal mengaktifkan bisa-erp-restore-drill.timer; restore drill terjadwal belum aktif."
    say "timer backup dan restore drill aktif."
  else
    # Tanpa kunci, kedua pekerjaan selalu gagal tertutup. Pastikan instalasi
    # baru maupun upgrade tidak menampilkan timer seolah-olah siap dipakai.
    systemctl disable --now bisa-erp-backup.timer bisa-erp-restore-drill.timer >/dev/null 2>&1 || die "gagal menonaktifkan timer backup tanpa kunci; periksa status systemd sebelum melanjutkan."
    say "PERINGATAN: timer backup dan restore drill tidak aktif karena credential kunci belum tersedia. Simpan kunci di luar server, buat $backup_passphrase_file, lalu aktifkan kedua timer secara manual."
  fi
  say "service aplikasi aktif."
else
  say "PERINGATAN: systemd tidak berjalan di mesin ini — unit disalin tetapi tidak diaktifkan."
  if [[ -s "$backup_passphrase_file" ]]; then
    say "Aktifkan manual: systemctl daemon-reload && systemctl enable --now bisa-erp bisa-erp-backup.timer bisa-erp-restore-drill.timer"
  else
    say "Aktifkan aplikasi manual: systemctl daemon-reload && systemctl enable --now bisa-erp.service. Simpan kunci di luar server dan buat $backup_passphrase_file sebelum mengaktifkan timer backup dan restore drill."
  fi
fi

# ---------------------------------------------------------------- health gate
say "menunggu GET /api/health …"
ok=0
for i in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:${APP_PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=1; break
  fi
  sleep 2
done
if [[ "$ok" == "1" ]]; then
  if [[ "$HTTPS_ENABLED" == "1" ]]; then
    if command -v curl >/dev/null 2>&1; then
      curl -kfsS "https://127.0.0.1:${HTTPS_PORT}/api/health" >/dev/null 2>&1 \
        || die "HTTPS health check gagal — periksa nginx dan sertifikat $TLS_CERT."
    fi
    say "SELESAI. Bisa ERP versi $VERSION melayani via HTTPS di port $HTTPS_PORT."
  else
    say "SELESAI. Bisa ERP versi $VERSION melayani di port $APP_PORT (HTTP, uji lokal)."
  fi
  say "Buka dari kasir: $(grep '^BETTER_AUTH_URL=' "$ENV_FILE" | cut -d= -f2-)"
  say "Kesehatan: systemctl status bisa-erp · Backup: systemctl list-timers bisa-erp-backup"
else
  echo "[install] GAGAL: /api/health tidak menjawab 200 dalam 60 detik." >&2
  echo "[install] Periksa: journalctl -u bisa-erp -n 50 --no-pager" >&2
  exit 1
fi
