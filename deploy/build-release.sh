#!/usr/bin/env bash
# A-24 T5 — build the single release artifact used by BOTH install paths.
#
# Output (in dist-release/):
#   bisa-erp-<versi>/            the unpacked release tree
#   bisa-erp-<versi>.tar.gz      the artifact handed to a shop machine
#   bisa-erp-<versi>.tar.gz.sha256
#
# The tree is the Next standalone server (per the self-hosting guide in
# node_modules/next/dist/docs) plus everything production operations
# need and nothing else:
#   server.js, .next/static, public/   the application
#   migrations/, migrate.mjs           explicit migration step (drizzle-orm
#                                      runtime migrator — no dev tooling)
#   scripts/                            backup, restore, crypto and drill tooling
#   deploy/                            install.sh, update.sh, backup-run.sh,
#                                      systemd units, this script
#   VERSION                            release version stamp
#
# Usage: bash deploy/build-release.sh [versi] [--skip-build]
set -euo pipefail

cd "$(dirname "$0")/.."

version=""
skip_build=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=1 ;;
    *) version="$arg" ;;
  esac
done
[[ -n "$version" ]] || version="$(node -p "require('./package.json').version")"

if [[ "$skip_build" == "0" ]]; then
  echo "== pnpm build (output: standalone) =="
  pnpm build
fi
[[ -f .next/standalone/server.js ]] || {
  echo "GAGAL: .next/standalone/server.js tidak ada — pastikan output:'standalone' aktif dan build berhasil." >&2
  exit 1
}

out_root="dist-release"
name="bisa-erp-${version}"
stage="$out_root/$name"
rm -rf "$stage"
mkdir -p "$stage"

echo "== merakit $stage =="
cp -r .next/standalone/. "$stage/"
# Next's traced standalone tree can contain repository-local runtime data.
# Never ship database backups that happened to be under the source workspace;
# production backup storage is configured outside the release directory.
rm -rf "$stage/backups"
find "$stage" -type f \( -name '*.dump' -o -name '*.dump.*' \) -delete
cp -r .next/static "$stage/.next/static"
cp -r public "$stage/public"
cp -r src/db/migrations "$stage/migrations"
cp deploy/migrate.mjs "$stage/migrate.mjs"
mkdir -p "$stage/scripts" "$stage/deploy"
cp scripts/backup.sh scripts/restore.sh scripts/restore-drill.sh \
  scripts/backup-crypto.mjs scripts/verify-backup-manifest.mjs "$stage/scripts/"
cp -r deploy/. "$stage/deploy/"
# Turbopack bundles the app's server dependencies into .next/server, so
# the standalone tree has no drizzle-orm/postgres packages — but the
# migration runner (migrate.mjs) imports them directly. Overlay the
# complete packages, dereferencing pnpm's symlinks (cp -rL), or the
# release would contain broken links into the build machine's store.
rm -rf "$stage/node_modules/drizzle-orm" "$stage/node_modules/postgres"
cp -rL node_modules/drizzle-orm "$stage/node_modules/drizzle-orm"
cp -rL node_modules/postgres "$stage/node_modules/postgres"
echo "$version" > "$stage/VERSION"
# Deterministic modes in the artifact whatever the build umask was.
chmod -R a+rX "$stage"

tar -czf "$out_root/$name.tar.gz" -C "$out_root" "$name"
( cd "$out_root" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256" )
echo "== selesai: $out_root/$name.tar.gz =="
du -h "$out_root/$name.tar.gz" | awk '{print "ukuran artefak:", $1}'
