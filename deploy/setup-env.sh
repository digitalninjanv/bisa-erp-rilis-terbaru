#!/usr/bin/env bash
# A-24 T5 — generate the production .env.prod for the Docker path.
#
# Guarantees:
#   - refuses to overwrite an existing .env.prod (secrets are generated
#     once, randomly; losing them means losing the database passwords)
#   - every secret is random (openssl), never a published default
#   - file mode 600
#
# Usage:
#   bash deploy/setup-env.sh --untuk docker [--port 3000] [--auth-url http://192.168.1.10:3000]
# For the systemd path you do NOT need this script: deploy/install.sh
# writes /etc/bisa-erp/bisa-erp.env itself (host db = 127.0.0.1).
set -euo pipefail

cd "$(dirname "$0")/.."

mode="docker"
port="${APP_PORT:-3000}"
auth_url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --untuk) mode="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --auth-url) auth_url="$2"; shift 2 ;;
    *) echo "Argumen tidak dikenal: $1" >&2; exit 64 ;;
  esac
done

out=".env.prod"
if [[ -e "$out" ]]; then
  echo "BERHENTI: $out sudah ada — tidak ditimpa. Hapus manual bila memang ingin membuat ulang (database lama tidak akan bisa dibuka dengan sandi baru)." >&2
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { echo "openssl tidak ditemukan." >&2; exit 1; }

[[ "$mode" == "docker" ]] || { echo "--untuk hanya menerima 'docker' (jalur systemd memakai install.sh)." >&2; exit 64; }
db_host="db"
if [[ -z "$auth_url" ]]; then
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  auth_url="http://${lan_ip:-ALAMAT-SERVER}:${port}"
fi

erp_pw="$(openssl rand -hex 24)"
app_pw="$(openssl rand -hex 24)"
secret="$(openssl rand -hex 32)"
version="$(node -p "require('./package.json').version" 2>/dev/null || echo 0.1.0)"

umask 077
cat > "$out" <<EOF
# Dibuat oleh deploy/setup-env.sh pada $(date -Is) — RAHASIA, jangan dibagikan/di-commit.
BISA_VERSION=$version
APP_PORT=$port
POSTGRES_PASSWORD=$erp_pw
APP_USER_PASSWORD=$app_pw
DATABASE_URL=postgres://app_user:${app_pw}@${db_host}:5432/bisa
DIRECT_URL=postgres://erp:${erp_pw}@${db_host}:5432/bisa
BETTER_AUTH_SECRET=$secret
BETTER_AUTH_URL=$auth_url
NEXT_PUBLIC_APP_NAME="Bisa ERP"
NODE_ENV=production
EOF
chmod 600 "$out"
echo "Selesai: $out (mode 600). BETTER_AUTH_URL=$auth_url"
echo "Periksa alamatnya benar alamat server ini di LAN sebelum menyalakan aplikasi."
