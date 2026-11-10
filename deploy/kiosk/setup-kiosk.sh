#!/usr/bin/env bash
# Langkah 8 (RENCANA-TAURI) — Penyiapan komputer kasir sebagai
# KIOS Bisa POS di Linux (target: Ubuntu 22.04 + GNOME/GDM,
# sesuai lantai platform D8; varian sesi minimal via LightDM
# bila GNOME tidak dipakai).
#
# Yang dilakukan skrip ini:
#   1. Membuat pengguna kasir NON-ADMIN khusus (tanpa sudo).
#   2. Auto-login sesi grafis ke pengguna kasir.
#   3. Autostart aplikasi Bisa POS untuk pengguna kasir.
#   4. Mengunci jalan keluar mudah lewat profil dconf SISTEM
#      (layar kunci mati, ganti pengguna & log-out dimatikan,
#      pintasan pengalih aplikasi & menu utama dikosongkan,
#      sudut panas overview mati) + berkas locks agar pengguna
#      tidak bisa mengubahnya kembali.
#   5. (Bendera) menonaktifkan suspend & mengalihkan getty
#      tty2–tty6 agar pengalihan TTY tidak mudah dipakai.
#
# Yang TIDAK dilakukan: memasang aplikasi (pasang .deb/AppImage
# lebih dulu — lihat RUNBOOK-KIOS.md), membuat akun admin
# (PRASYARAT: akun admin terpisah harus sudah ada; skrip
# menolak berjalan bila pemanggil sudo adalah pengguna kasir
# itu sendiri atau akun admin tidak terdeteksi), dan menghapus
# apa pun. Idempoten: aman dijalankan ulang; berkas yang
# ditimpa disimpan cadangannya sekali sebagai *.pre-bisa-kiosk.
#
# Batas jujur: fullscreen saja TIDAK mengamankan perangkat.
# Yang mengunci adalah akun non-admin + sesi yang dikunci +
# kata sandi admin yang tidak diketahui kasir. Akses fisik
# (boot USB, dsb.) di luar jangkauan skrip ini — lihat runbook.
#
# Pakai:
#   sudo bash deploy/kiosk/setup-kiosk.sh [--dry-run]
#
# Penyesuaian lewat env:
#   KIOSK_USER         nama pengguna kasir        (bawaan: kasir)
#   KIOSK_APP_CMD      perintah aplikasi          (bawaan: deteksi
#                      /usr/bin/bisa-pos lalu AppImage
#                      /opt/bisa-pos/Bisa_POS.AppImage)
#   KIOSK_DISABLE_SUSPEND=1   mask sleep/suspend   (bawaan: 1)
#   KIOSK_MASK_TTY=1          mask getty tty2–6   (bawaan: 0)
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "Argumen tidak dikenal: $arg" >&2; exit 2 ;;
  esac
done

KIOSK_USER="${KIOSK_USER:-kasir}"
KIOSK_DISABLE_SUSPEND="${KIOSK_DISABLE_SUSPEND:-1}"
KIOSK_MASK_TTY="${KIOSK_MASK_TTY:-0}"

# run CMD... — eksekusi, atau cetak saja pada --dry-run.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# write_file PATH — tulis stdin ke PATH (atomik via berkas
# sementara), dengan cadangan sekali *.pre-bisa-kiosk.
write_file() {
  local path="$1"
  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] tulis %s (isi dari stdin skrip)\n' "$path"
    cat >/dev/null
    return 0
  fi
  if [ -f "$path" ] && [ ! -f "$path.pre-bisa-kiosk" ]; then
    cp -a "$path" "$path.pre-bisa-kiosk"
  fi
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  install -m 0644 "$tmp" "$path"
  rm -f "$tmp"
}

die() { echo "GAGAL: $*" >&2; exit 1; }

# ----------------------------------------------------------------
# Prasyarat
# ----------------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  # Dry-run tidak mengubah apa pun: boleh ditinjau tanpa root.
  [ "$(id -u)" = "0" ] || echo "[dry-run] catatan: eksekusi sungguhan butuh sudo."
else
  [ "$(id -u)" = "0" ] || die "jalankan dengan sudo (root diperlukan untuk akun & sesi sistem)."
fi
ADMIN_USER="${SUDO_USER:-}"
if [ "$DRY_RUN" = "1" ] && { [ -z "$ADMIN_USER" ] || [ "$ADMIN_USER" = "root" ]; }; then
  ADMIN_USER="$(id -un)"
  if [ "$ADMIN_USER" = "root" ]; then
    ADMIN_USER="admin"
  fi
  echo "[dry-run] SUDO_USER tidak terdeteksi; memakai '$ADMIN_USER' sebagai contoh admin."
fi
if [ "$DRY_RUN" = "1" ]; then
  # Tinjauan tidak menuntut akun contoh benar-benar ada.
  id "$ADMIN_USER" >/dev/null 2>&1 || echo "[dry-run] catatan: akun contoh '$ADMIN_USER' tidak ada di mesin ini."
fi
[ -n "$ADMIN_USER" ] && [ "$ADMIN_USER" != "root" ] \
  || die "akun admin terpisah tidak terdeteksi (SUDO_USER kosong/root). Buat akun admin dulu — lihat RUNBOOK-KIOS.md."
[ "$ADMIN_USER" != "$KIOSK_USER" ] \
  || die "pengguna kasir tidak boleh sama dengan akun admin ($ADMIN_USER)."
if [ "$DRY_RUN" != "1" ]; then
  id "$ADMIN_USER" >/dev/null 2>&1 || die "akun admin '$ADMIN_USER' tidak ada."
fi

if [ -z "${KIOSK_APP_CMD:-}" ]; then
  if [ -x /usr/bin/bisa-pos ]; then
    KIOSK_APP_CMD="/usr/bin/bisa-pos"
  elif [ -x /opt/bisa-pos/Bisa_POS.AppImage ]; then
    KIOSK_APP_CMD="/opt/bisa-pos/Bisa_POS.AppImage"
  elif [ "$DRY_RUN" = "1" ]; then
    KIOSK_APP_CMD="/usr/bin/bisa-pos"
    echo "[dry-run] aplikasi belum terpasang; memakai tebakan $KIOSK_APP_CMD"
  else
    die "aplikasi Bisa POS tidak ditemukan (/usr/bin/bisa-pos atau /opt/bisa-pos/Bisa_POS.AppImage). Pasang .deb/AppImage lebih dulu, atau set KIOSK_APP_CMD."
  fi
fi
echo "Pengguna kasir : $KIOSK_USER"
echo "Akun admin     : $ADMIN_USER (tetap terpisah, tidak diubah)"
echo "Perintah app   : $KIOSK_APP_CMD"

# Display manager menentukan jalur sesi.
DM=""
if [ -f /etc/gdm3/custom.conf ] || command -v gdm3 >/dev/null 2>&1; then
  DM="gdm3"
elif command -v lightdm >/dev/null 2>&1; then
  DM="lightdm"
elif [ "$DRY_RUN" = "1" ]; then
  DM="gdm3"
  echo "[dry-run] display manager tidak terdeteksi; memakai jalur gdm3/GNOME"
else
  die "display manager yang didukung tidak ditemukan (gdm3/GNOME atau lightdm)."
fi
echo "Display manager: $DM"

KIOSK_HOME="/home/$KIOSK_USER"

# ----------------------------------------------------------------
# 1. Pengguna kasir non-admin
# ----------------------------------------------------------------
if id "$KIOSK_USER" >/dev/null 2>&1; then
  echo "Pengguna $KIOSK_USER sudah ada — dipertahankan."
else
  run useradd -m -s /bin/bash -c "Kasir Bisa POS" "$KIOSK_USER"
fi
# Pastikan BUKAN admin: keluarkan dari grup sudo/adm bila ada.
for grp in sudo adm; do
  if id -nG "$KIOSK_USER" 2>/dev/null | grep -qw "$grp"; then
    run deluser "$KIOSK_USER" "$grp"
  fi
done
run install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 0755 "$KIOSK_HOME/.config/autostart"

# ----------------------------------------------------------------
# 2–3. Auto-login + autostart aplikasi
# ----------------------------------------------------------------
if [ "$DM" = "gdm3" ]; then
  # GDM: tulis stanza daemon TANPA menghapus isi lain custom.conf
  # (cadangan dibuat write_file; penggabungan sederhana: berkas
  # ditulis ulang dengan stanza kita + penanda).
  if [ "$DRY_RUN" != "1" ] && grep -q "AutomaticLogin" /etc/gdm3/custom.conf 2>/dev/null; then
    echo "custom.conf sudah memuat AutomaticLogin — menimpa stanza daemon (cadangan .pre-bisa-kiosk dibuat)."
  fi
  write_file /etc/gdm3/custom.conf <<EOF
# Bisa POS kiosk (deploy/kiosk/setup-kiosk.sh) — auto-login kasir.
# Cadangan berkas asli: custom.conf.pre-bisa-kiosk (bila ada).
[daemon]
AutomaticLoginEnable=true
AutomaticLogin=$KIOSK_USER
EOF
else
  run install -d -m 0755 /etc/lightdm/lightdm.conf.d
  write_file /etc/lightdm/lightdm.conf.d/50-bisa-kiosk.conf <<EOF
# Bisa POS kiosk — auto-login sesi minimal (varian non-GNOME).
[Seat:*]
autologin-user=$KIOSK_USER
autologin-session=bisa-pos
EOF
  # Sesi minimal: .xsession menjalankan aplikasi lalu keluar ke
  # login grafis lagi bila aplikasi berhenti (tidak ada shell).
  write_file /usr/share/xsessions/bisa-pos.desktop <<EOF
[Desktop Entry]
Name=Bisa POS (sesi minimal)
Comment=Sesi kios Bisa POS tanpa desktop penuh
Exec=$KIOSK_HOME/.xsession-bisa-pos
TryExec=$KIOSK_HOME/.xsession-bisa-pos
Type=Application
EOF
  write_file "$KIOSK_HOME/.xsession-bisa-pos" <<EOF
#!/bin/sh
# Sesi minimal Bisa POS: hanya aplikasi. Keluar dari aplikasi =
# keluar sesi (kembali ke login grafis / auto-login ulang).
exec $KIOSK_APP_CMD
EOF
  run chmod 0755 "$KIOSK_HOME/.xsession-bisa-pos"
  run chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.xsession-bisa-pos"
fi

# Autostart di sesi GNOME (dan sesi desktop lain yang membaca
# XDG autostart). Pada sesi minimal berkas ini tidak dibaca —
# .xsession di atas yang menjalankan aplikasi.
write_file "$KIOSK_HOME/.config/autostart/bisa-pos.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Bisa POS
Comment=Terminal kasir Bisa ERP
Exec=$KIOSK_APP_CMD
X-GNOME-Autostart-enabled=true
NoDisplay=false
EOF
run chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config/autostart/bisa-pos.desktop"

# ----------------------------------------------------------------
# 4. Penguncian sesi lewat dconf sistem (jalur GNOME)
# ----------------------------------------------------------------
if [ "$DM" = "gdm3" ]; then
  run install -d -m 0755 /etc/dconf/profile /etc/dconf/db/local.d/locks
  # Profil dconf: basis data sistem ikut dibaca (wajib agar
  # kunci di bawah berlaku & terkunci).
  write_file /etc/dconf/profile/user <<'EOF'
user-db:user
system-db:local
system-db:site
system-db:distro
EOF
  write_file /etc/dconf/db/local.d/00-bisa-kiosk <<'EOF'
# Penguncian kios Bisa POS (deploy/kiosk/setup-kiosk.sh).
# Nilai di sini adalah nilai sistem; kunci yang sama tercantum
# di locks/00-bisa-kiosk sehingga pengguna tidak dapat
# mengubahnya kembali dari dalam sesi.

# Tanpa layar kunci & tanpa redup: kasir tidak pernah
# berhadapan dengan prompt kunci layar di tengah shift.
[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false

# Jalan keluar sesi dimatikan: tidak bisa ganti pengguna,
# tidak bisa log-out dari menu.
[org/gnome/desktop/lockdown]
disable-user-switching=true
disable-log-out=true

# Pintasan berpindah aplikasi/menu utama dikosongkan; sudut
# panas overview mati — aplikasi POS adalah satu-satunya
# permukaan kerja.
[org/gnome/desktop/wm/keybindings]
switch-applications=@as []
switch-windows=@as []
panel-main-menu=@as []

[org/gnome/desktop/interface]
enable-hot-corners=false
EOF
  write_file /etc/dconf/db/local.d/locks/00-bisa-kiosk <<'EOF'
/org/gnome/desktop/session/idle-delay
/org/gnome/desktop/screensaver/lock-enabled
/org/gnome/desktop/screensaver/idle-activation-enabled
/org/gnome/desktop/lockdown/disable-user-switching
/org/gnome/desktop/lockdown/disable-log-out
/org/gnome/desktop/wm/keybindings/switch-applications
/org/gnome/desktop/wm/keybindings/switch-windows
/org/gnome/desktop/wm/keybindings/panel-main-menu
/org/gnome/desktop/interface/enable-hot-corners
EOF
  if command -v dconf >/dev/null 2>&1; then
    run dconf update
  else
    echo "PERINGATAN: perintah dconf tidak ditemukan — jalankan 'dconf update' sesudah memasang dconf-cli." >&2
  fi
fi

# ----------------------------------------------------------------
# 5. Bendera tambahan: suspend & TTY
# ----------------------------------------------------------------
if [ "$KIOSK_DISABLE_SUSPEND" = "1" ]; then
  run systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
else
  echo "KIOSK_DISABLE_SUSPEND=0 — suspend dibiarkan (komputer kasir bisa tertidur di tengah shift)."
fi

if [ "$KIOSK_MASK_TTY" = "1" ]; then
  for n in 2 3 4 5 6; do
    run systemctl mask "getty@tty${n}.service"
  done
  echo "getty tty2–tty6 di-mask: pengalihan TTY teks dimatikan (admin bekerja lewat tty1/SSH)."
else
  echo "KIOSK_MASK_TTY=0 — getty TTY dibiarkan; pengalihan TTY tetap mungkin tetapi mendarat di prompt login (bukan sesi kasir)."
fi

echo
echo "Selesai. Verifikasi dengan: bash deploy/kiosk/check-kiosk.sh"
echo "Mulai ulang komputer untuk masuk sesi kios: sudo reboot"
