#!/usr/bin/env bash
# Langkah 8 (RENCANA-TAURI) — Melepas penguncian kios Bisa POS,
# mengembalikan komputer kasir ke keadaan desktop biasa.
#
# Yang dibatalkan (kebalikan setup-kiosk.sh):
#   - auto-login GDM (stanza kita dicabut; cadangan
#     *.pre-bisa-kiosk dipulihkan bila ada), auto-login LightDM;
#   - autostart XDG aplikasi untuk pengguna kasir;
#   - penguncian dconf sistem + locks (hanya berkas milik
#     penyiapan ini);
#   - mask suspend & getty yang dipasang penyiapan ini.
#
# Yang TIDAK disentuh:
#   - data aplikasi: database lokal, antrean offline, konfigurasi
#     printer & token di ~/.local/share/id.bisa.pos tetap utuh;
#   - pengguna kasir itu sendiri & home-nya (penghapusan akun
#     hanya lewat --remove-user + KIOSK_CONFIRM_REMOVE_USER=1,
#     dan itu MENGHAPUS home termasuk data aplikasi — baca
#     peringatan di bawah);
#   - paket aplikasi (.deb/AppImage) — lepas lewat manajer paket
#     seperti biasa bila memang diinginkan.
#
# Pakai:
#   sudo bash deploy/kiosk/teardown-kiosk.sh [--dry-run]
#   sudo KIOSK_CONFIRM_REMOVE_USER=1 bash deploy/kiosk/teardown-kiosk.sh --remove-user
set -euo pipefail

DRY_RUN=0
REMOVE_USER=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --remove-user) REMOVE_USER=1 ;;
    *) echo "Argumen tidak dikenal: $arg" >&2; exit 2 ;;
  esac
done

KIOSK_USER="${KIOSK_USER:-kasir}"
KIOSK_HOME="/home/$KIOSK_USER"

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

remove_file() {
  local path="$1"
  if [ -e "$path" ]; then
    run rm -f "$path"
    echo "dihapus: $path"
  fi
}

die() { echo "GAGAL: $*" >&2; exit 1; }

if [ "$DRY_RUN" = "1" ]; then
  [ "$(id -u)" = "0" ] || echo "[dry-run] catatan: eksekusi sungguhan butuh sudo."
else
  [ "$(id -u)" = "0" ] || die "jalankan dengan sudo."
fi
if [ "$REMOVE_USER" = "1" ]; then
  [ "${KIOSK_CONFIRM_REMOVE_USER:-}" = "1" ] \
    || die "--remove-user butuh KIOSK_CONFIRM_REMOVE_USER=1: penghapusan akun menghapus home kasir TERMASUK database lokal & antrean offline yang belum tersinkron."
  echo "PERINGATAN: pengguna $KIOSK_USER akan DIHAPUS beserta home-nya (data aplikasi ikut hilang)."
fi

# ----------------------------------------------------------------
# Auto-login
# ----------------------------------------------------------------
if [ -f /etc/gdm3/custom.conf ] && grep -q "Bisa POS kiosk" /etc/gdm3/custom.conf; then
  if [ -f /etc/gdm3/custom.conf.pre-bisa-kiosk ]; then
    run cp -a /etc/gdm3/custom.conf.pre-bisa-kiosk /etc/gdm3/custom.conf
    run rm -f /etc/gdm3/custom.conf.pre-bisa-kiosk
    echo "custom.conf dipulihkan dari cadangan pra-kios."
  else
    remove_file /etc/gdm3/custom.conf
  fi
else
  echo "custom.conf GDM bukan milik penyiapan kios / tidak ada — dibiarkan."
fi
remove_file /etc/lightdm/lightdm.conf.d/50-bisa-kiosk.conf
remove_file /usr/share/xsessions/bisa-pos.desktop
remove_file "$KIOSK_HOME/.xsession-bisa-pos"

# ----------------------------------------------------------------
# Autostart & penguncian dconf
# ----------------------------------------------------------------
remove_file "$KIOSK_HOME/.config/autostart/bisa-pos.desktop"
remove_file /etc/dconf/db/local.d/00-bisa-kiosk
remove_file /etc/dconf/db/local.d/locks/00-bisa-kiosk
if [ -f /etc/dconf/profile/user ] && grep -q "system-db:local" /etc/dconf/profile/user; then
  # Profil ditulis penyiapan kios (isi baku empat baris);
  # pulihkan cadangan bila ada, selain itu hapus.
  if [ -f /etc/dconf/profile/user.pre-bisa-kiosk ]; then
    run cp -a /etc/dconf/profile/user.pre-bisa-kiosk /etc/dconf/profile/user
    run rm -f /etc/dconf/profile/user.pre-bisa-kiosk
  else
    remove_file /etc/dconf/profile/user
  fi
fi
if command -v dconf >/dev/null 2>&1; then
  run dconf update
fi

# ----------------------------------------------------------------
# Mask layanan (suspend & getty) — hanya yang dipasang setup
# dengan bendera yang sama; unmask aman bila tidak ter-mask.
# ----------------------------------------------------------------
run systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true
for n in 2 3 4 5 6; do
  run systemctl unmask "getty@tty${n}.service" 2>/dev/null || true
done

# ----------------------------------------------------------------
# Pengguna (opsional, destruktif — dijaga ganda)
# ----------------------------------------------------------------
if [ "$REMOVE_USER" = "1" ]; then
  if id "$KIOSK_USER" >/dev/null 2>&1; then
    run userdel -r "$KIOSK_USER"
    echo "Pengguna $KIOSK_USER dan home-nya dihapus."
  else
    echo "Pengguna $KIOSK_USER tidak ada — tidak ada yang dihapus."
  fi
else
  echo "Pengguna $KIOSK_USER dipertahankan (beserta seluruh data aplikasinya)."
fi

echo
echo "Selesai. Komputer kembali ke login grafis biasa sesudah reboot: sudo reboot"
