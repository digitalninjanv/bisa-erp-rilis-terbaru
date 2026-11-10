#!/usr/bin/env bash
# Langkah 8 (RENCANA-TAURI) — Pemeriksaan kesiapan komputer
# kios Bisa POS. Read-only: tidak mengubah apa pun.
#
# Pakai:
#   bash deploy/kiosk/check-kiosk.sh [--dry-run]
#   (--dry-run diterima agar seragam dengan skrip lain; semua
#   pemeriksaan memang hanya membaca.)
#
# Keluaran per butir: LULUS / GAGAL / PERINGATAN + ringkasan.
# Kode keluar: 0 bila tidak ada GAGAL, 1 bila ada.
#
# Penyesuaian lewat env:
#   KIOSK_USER      nama pengguna kasir   (bawaan: kasir)
#   KIOSK_APP_CMD   perintah aplikasi     (bawaan: deteksi)
#   PRINTER_HOST / PRINTER_PORT           menimpa host/port
#                   printer dari printer.json milik kasir
#   DISK_MAX_USED_PERCENT   ambang ruang  (bawaan: 85)
set -uo pipefail

KIOSK_USER="${KIOSK_USER:-kasir}"
DISK_MAX_USED_PERCENT="${DISK_MAX_USED_PERCENT:-85}"
KIOSK_HOME="/home/$KIOSK_USER"
APP_DATA_DIR="$KIOSK_HOME/.local/share/id.bisa.pos"

PASS=0
FAIL=0
WARN=0

ok()   { PASS=$((PASS + 1)); printf 'LULUS     %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf 'GAGAL     %s\n' "$1"; }
warn() { WARN=$((WARN + 1)); printf 'PERINGATAN %s\n' "$1"; }

echo "== Pemeriksaan kios Bisa POS (pengguna: $KIOSK_USER) =="

# ----------------------------------------------------------------
# 1. Pengguna kasir ada & non-admin
# ----------------------------------------------------------------
if id "$KIOSK_USER" >/dev/null 2>&1; then
  groups="$(id -nG "$KIOSK_USER")"
  if printf '%s' "$groups" | grep -qw sudo || printf '%s' "$groups" | grep -qw admin; then
    bad "pengguna $KIOSK_USER anggota grup admin ($groups) — kasir tidak boleh bisa sudo"
  else
    ok "pengguna $KIOSK_USER ada dan bukan admin"
  fi
else
  bad "pengguna $KIOSK_USER tidak ada — jalankan setup-kiosk.sh"
fi

# ----------------------------------------------------------------
# 2. Auto-login sesi grafis menunjuk pengguna kasir
# ----------------------------------------------------------------
if [ -f /etc/gdm3/custom.conf ] && grep -q "AutomaticLogin=$KIOSK_USER" /etc/gdm3/custom.conf; then
  ok "auto-login GDM menunjuk $KIOSK_USER"
elif [ -f /etc/lightdm/lightdm.conf.d/50-bisa-kiosk.conf ] \
  && grep -q "autologin-user=$KIOSK_USER" /etc/lightdm/lightdm.conf.d/50-bisa-kiosk.conf; then
  ok "auto-login LightDM (sesi minimal) menunjuk $KIOSK_USER"
else
  bad "auto-login tidak terkonfigurasi untuk $KIOSK_USER (GDM maupun LightDM)"
fi

# ----------------------------------------------------------------
# 3. Penguncian sesi (jalur GNOME) / sesi minimal (LightDM)
# ----------------------------------------------------------------
if [ -f /etc/gdm3/custom.conf ]; then
  if [ -f /etc/dconf/db/local.d/00-bisa-kiosk ] && [ -f /etc/dconf/db/local.d/locks/00-bisa-kiosk ]; then
    ok "penguncian dconf sistem + locks terpasang"
  else
    bad "berkas penguncian dconf tidak lengkap (/etc/dconf/db/local.d/00-bisa-kiosk + locks/)"
  fi
else
  if [ -f "$KIOSK_HOME/.xsession-bisa-pos" ]; then
    ok "sesi minimal LightDM terkonfigurasi (.xsession-bisa-pos ada)"
  else
    warn "tidak ada GDM maupun sesi minimal — periksa jalur display manager mesin ini"
  fi
fi

# ----------------------------------------------------------------
# 4. Autostart aplikasi ada & menunjuk berkas yang bisa dieksekusi
# ----------------------------------------------------------------
AUTOSTART="$KIOSK_HOME/.config/autostart/bisa-pos.desktop"
if [ -f "$AUTOSTART" ]; then
  ok "autostart XDG ada ($AUTOSTART)"
else
  warn "autostart XDG tidak ada (pada sesi minimal LightDM ini wajar — aplikasi jalan dari .xsession)"
fi

# ----------------------------------------------------------------
# 5. Aplikasi terpasang
# ----------------------------------------------------------------
APP_CMD="${KIOSK_APP_CMD:-}"
if [ -z "$APP_CMD" ]; then
  if [ -x /usr/bin/bisa-pos ]; then
    APP_CMD="/usr/bin/bisa-pos"
  elif [ -x /opt/bisa-pos/Bisa_POS.AppImage ]; then
    APP_CMD="/opt/bisa-pos/Bisa_POS.AppImage"
  fi
fi
if [ -n "$APP_CMD" ] && [ -x "$APP_CMD" ]; then
  ok "aplikasi terpasang & bisa dieksekusi ($APP_CMD)"
else
  bad "aplikasi Bisa POS tidak ditemukan / tidak bisa dieksekusi (cek KIOSK_APP_CMD)"
fi

# ----------------------------------------------------------------
# 6. Vault keychain OS (token terminal Langkah 6)
# ----------------------------------------------------------------
if command -v gnome-keyring-daemon >/dev/null 2>&1; then
  ok "gnome-keyring tersedia (token terminal bisa tinggal di keychain OS)"
else
  warn "gnome-keyring tidak ada — token memakai fallback berkas 0600 milik Rust (terlihat di panel Terminal aplikasi; diterima Langkah 6, bukan kegagalan)"
fi

# ----------------------------------------------------------------
# 7. Printer jaringan terjangkau (host/port dari printer.json)
# ----------------------------------------------------------------
PRINTER_HOST_RESOLVED="${PRINTER_HOST:-}"
PRINTER_PORT_RESOLVED="${PRINTER_PORT:-9100}"
PRINTER_JSON="$APP_DATA_DIR/printer.json"
if [ -z "$PRINTER_HOST_RESOLVED" ] && [ -f "$PRINTER_JSON" ] && command -v python3 >/dev/null 2>&1; then
  RESOLVED="$(python3 - "$PRINTER_JSON" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as fh:
        cfg = json.load(fh)
    print(cfg.get("host", ""), cfg.get("port", 9100))
except Exception:
    print("", 9100)
PY
)"
  PRINTER_HOST_RESOLVED="$(printf '%s' "$RESOLVED" | awk '{print $1}')"
  PRINTER_PORT_RESOLVED="$(printf '%s' "$RESOLVED" | awk '{print $2}')"
  [ -n "$PRINTER_PORT_RESOLVED" ] || PRINTER_PORT_RESOLVED="9100"
fi
if [ -z "$PRINTER_HOST_RESOLVED" ]; then
  warn "printer belum dikonfigurasi (printer.json kasir belum ada & PRINTER_HOST kosong) — atur dari panel Printer aplikasi"
else
  if timeout 3 bash -c "exec 3<>/dev/tcp/$PRINTER_HOST_RESOLVED/$PRINTER_PORT_RESOLVED" 2>/dev/null; then
    ok "printer jaringan terjangkau di $PRINTER_HOST_RESOLVED:$PRINTER_PORT_RESOLVED"
  else
    bad "printer jaringan TIDAK terjangkau di $PRINTER_HOST_RESOLVED:$PRINTER_PORT_RESOLVED (penjualan tetap jalan — antrean cetak menunggu; periksa kabel/IP printer)"
  fi
fi

# ----------------------------------------------------------------
# 8. Direktori data aplikasi & ruang disk
# ----------------------------------------------------------------
if [ -d "$APP_DATA_DIR" ]; then
  ok "direktori data aplikasi ada ($APP_DATA_DIR)"
  if [ -f "$APP_DATA_DIR/bisa-pos.db" ]; then
    ok "database lokal bisa-pos.db ada"
  else
    warn "bisa-pos.db belum ada — wajar sebelum aplikasi pertama kali dibuka & pairing"
  fi
else
  warn "direktori data aplikasi belum ada — wajar sebelum aplikasi pertama kali dijalankan"
fi

DISK_TARGET="$KIOSK_HOME"
[ -d "$DISK_TARGET" ] || DISK_TARGET="/home"
USED_PERCENT="$(df --output=pcent "$DISK_TARGET" 2>/dev/null | tail -1 | tr -dc '0-9')"
if [ -n "$USED_PERCENT" ]; then
  if [ "$USED_PERCENT" -lt "$DISK_MAX_USED_PERCENT" ]; then
    ok "ruang disk $DISK_TARGET terpakai ${USED_PERCENT}% (< ${DISK_MAX_USED_PERCENT}%)"
  else
    bad "ruang disk $DISK_TARGET terpakai ${USED_PERCENT}% (>= ${DISK_MAX_USED_PERCENT}%) — snapshot & DB lokal butuh ruang bebas"
  fi
else
  warn "pemakaian disk tidak terbaca untuk $DISK_TARGET"
fi

# ----------------------------------------------------------------
# 9. Jam sistem tersinkron (cap waktu penjualan offline)
# ----------------------------------------------------------------
if command -v timedatectl >/dev/null 2>&1; then
  NTP="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"
  if [ "$NTP" = "yes" ]; then
    ok "jam sistem tersinkron NTP ($(date '+%Y-%m-%d %H:%M:%S %Z'))"
  else
    bad "jam sistem TIDAK tersinkron NTP — cap waktu penjualan offline bisa meleset; aktifkan systemd-timesyncd"
  fi
else
  warn "timedatectl tidak tersedia — jam sistem tidak dapat diverifikasi dari sini"
fi

echo
echo "Ringkasan: $PASS lulus, $FAIL gagal, $WARN peringatan."
[ "$FAIL" = "0" ]
