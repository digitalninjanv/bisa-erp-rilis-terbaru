#!/usr/bin/env bash
# Rilis Bisa POS Desktop (POS Native Langkah 7, RENCANA-TAURI D4).
#
# Membungkus seluruh alur rilis dari SATU sumber versi
# (src-tauri/tauri.conf.json): sinkronkan versi → build bundel
# bertanda tangan di mesin ber-GTK → salin artefak ke direktori
# rilis server dengan nama kanonis + manifes. Prosedur lengkap,
# kustodi kunci, rollout & rollback: docs/pos-native/RUNBOOK-RILIS.md.
#
# Pemakaian:
#   scripts/release-pos-desktop.sh          # rilis versi di tauri.conf.json
#   scripts/release-pos-desktop.sh 1.2.0    # naikkan versi dulu, lalu rilis
#
# Prasyarat (skrip BERHENTI dengan pesan jelas bila absen — tidak
# pernah setengah jalan):
#   - node, pnpm, cargo (Rust stable)
#   - Linux: pustaka sistem Tauri (webkit2gtk-4.1, gtk+-3.0, dst.)
#   - kunci penandatanganan updater: env TAURI_SIGNING_PRIVATE_KEY
#     atau TAURI_SIGNING_PRIVATE_KEY_PATH, atau folder kustodi
#     ~/workspace/pos-native-keys/ (KUNCI TIDAK PERNAH DI REPO)
#   - direktori rilis: env BISA_POS_RELEASE_DIR (bawaan
#     ~/workspace/pos-releases)
set -euo pipefail

fail() { echo "RILIS GAGAL: $*" >&2; exit 1; }
info() { echo "==> $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- 1. Versi: satu sumber kebenaran di tauri.conf.json -------------------
command -v node >/dev/null || fail "node tidak ditemukan di PATH."
CURRENT_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
VERSION="${1:-$CURRENT_VERSION}"
if [ -n "${1:-}" ] && [ "$1" != "$CURRENT_VERSION" ]; then
  info "Menaikkan versi $CURRENT_VERSION -> $VERSION (sumber: tauri.conf.json)"
  python3 - "$VERSION" <<'PY'
import json, re, sys
version = sys.argv[1]
conf_path = "src-tauri/tauri.conf.json"
conf = json.load(open(conf_path))
conf["version"] = version
json.dump(conf, open(conf_path, "w"), indent=2)
open(conf_path, "a").write("\n")
cargo_path = "src-tauri/Cargo.toml"
cargo = open(cargo_path).read()
cargo = re.sub(r'(?m)^version = "[^"]+"', f'version = "{version}"', cargo, count=1)
open(cargo_path, "w").write(cargo)
for pkg_path in ("pos-desktop/package.json",):
    pkg = json.load(open(pkg_path))
    pkg["version"] = version
    json.dump(pkg, open(pkg_path, "w"), indent=2)
    open(pkg_path, "a").write("\n")
print(f"versi disinkronkan ke {version}: tauri.conf.json, Cargo.toml, pos-desktop/package.json")
PY
fi
echo "Versi rilis: $VERSION"

# --- 2. Prasyarat perkakas & kunci ----------------------------------------
command -v pnpm >/dev/null || fail "pnpm tidak ditemukan di PATH."
command -v cargo >/dev/null || fail "cargo (Rust) tidak ditemukan di PATH."
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  KEY_DIR="${POS_SIGNING_KEY_DIR:-$HOME/workspace/pos-native-keys}"
  if [ -f "$KEY_DIR/bisa-pos-updater.key" ]; then
    export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_DIR/bisa-pos-updater.key"
    if [ -f "$KEY_DIR/bisa-pos-updater.key.password" ] && [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$KEY_DIR/bisa-pos-updater.key.password")"
      export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    fi
    info "Kunci penandatanganan dimuat dari folder kustodi ($KEY_DIR)."
  else
    fail "kunci penandatanganan updater tidak ditemukan (env TAURI_SIGNING_PRIVATE_KEY[_PATH] kosong dan $KEY_DIR/bisa-pos-updater.key tidak ada). Lihat RUNBOOK-RILIS.md — JANGAN membuat kunci baru untuk armada yang sudah terpasang."
  fi
fi

# --- 3. Prasyarat platform -------------------------------------------------
OS="$(uname -s)"
PLATFORM_CONF=""
case "$OS" in
  Linux)
    PLATFORM_CONF="src-tauri/tauri.linux.conf.json"
    if ! pkg-config --exists webkit2gtk-4.1 gtk+-3.0 2>/dev/null; then
      fail "pustaka sistem Tauri tidak ada di mesin ini (pkg-config tidak menemukan webkit2gtk-4.1 / gtk+-3.0). Build desktop WAJIB di mesin/CI ber-GTK — Ubuntu 22.04 dengan libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev (lihat RUNBOOK-RILIS.md). VM pengembangan tanpa GTK memang tidak bisa membundel; tidak ada artefak yang dihasilkan."
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    PLATFORM_CONF="src-tauri/tauri.windows.conf.json"
    ;;
  *)
    fail "platform $OS tidak didukung skrip ini (Linux & Windows saja)."
    ;;
esac

RELEASE_DIR="${BISA_POS_RELEASE_DIR:-$HOME/workspace/pos-releases}"
mkdir -p "$RELEASE_DIR"

# --- 4. Build bundel bertanda tangan ---------------------------------------
info "Build bundel (konfigurasi $PLATFORM_CONF)…"
pnpm tauri build --config "$PLATFORM_CONF"

BUNDLE_DIR="src-tauri/target/release/bundle"
# --- 5. Kumpulkan & salin artefak ke direktori rilis -----------------------
copied=0
copy_artifact() {
  # $1 = berkas sumber, $2 = nama kanonis di direktori rilis
  local src="$1" dest_name="$2"
  [ -f "$src" ] || fail "artefak yang diharapkan tidak dihasilkan build: $src"
  [ -f "$src.sig" ] || fail "berkas tanda tangan pendamping tidak ada: $src.sig — periksa createUpdaterArtifacts & env kunci."
  cp "$src" "$RELEASE_DIR/$dest_name"
  cp "$src.sig" "$RELEASE_DIR/$dest_name.sig"
  info "Disalin: $dest_name (+ .sig)"
  copied=$((copied + 1))
}

case "$OS" in
  Linux)
    APPIMAGE="$(ls "$BUNDLE_DIR"/appimage/*.AppImage 2>/dev/null | head -1 || true)"
    [ -n "$APPIMAGE" ] || fail "tidak ada berkas .AppImage di $BUNDLE_DIR/appimage."
    ARCH="x86_64"; [ "$(uname -m)" = "aarch64" ] && ARCH="aarch64"
    copy_artifact "$APPIMAGE" "bisa-pos_linux-$ARCH.AppImage"
    DEB="$(ls "$BUNDLE_DIR"/deb/*.deb 2>/dev/null | head -1 || true)"
    if [ -n "$DEB" ]; then
      cp "$DEB" "$RELEASE_DIR/bisa-pos_linux-$ARCH.deb"
      info "Disalin (pemasangan manual, bukan jalur updater): bisa-pos_linux-$ARCH.deb"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    NSIS="$(ls "$BUNDLE_DIR"/nsis/*.exe 2>/dev/null | head -1 || true)"
    [ -n "$NSIS" ] || fail "tidak ada pemasang NSIS di $BUNDLE_DIR/nsis."
    copy_artifact "$NSIS" "bisa-pos_windows-x86_64-setup.exe"
    ;;
esac
[ "$copied" -ge 1 ] || fail "tidak ada artefak updater yang tersalin."

# --- 6. Manifes rilis (atomik) ---------------------------------------------
node - "$RELEASE_DIR" "$VERSION" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const [dir, version] = process.argv.slice(2);
const files = {};
for (const name of fs.readdirSync(dir)) {
  if (name.endsWith(".sig") || name === "manifest.json") continue;
  const stat = fs.statSync(path.join(dir, name));
  files[name] = { sizeBytes: stat.size, signatureFile: `${name}.sig` };
}
const manifest = { version, publishedAt: new Date().toISOString(), files };
const tmp = path.join(dir, "manifest.json.tmp");
fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
fs.renameSync(tmp, path.join(dir, "manifest.json"));
console.log(`manifes: ${path.join(dir, "manifest.json")} (versi ${version})`);
JS

info "Rilis $VERSION SELESAI di $RELEASE_DIR."
echo "Langkah berikutnya (RUNBOOK-RILIS.md): tetapkan versi $VERSION + persen rollout di web POS → Terminal desktop, lalu pantau last_seen terminal."
