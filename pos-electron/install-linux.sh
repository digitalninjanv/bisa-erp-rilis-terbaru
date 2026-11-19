#!/usr/bin/env bash
set -euo pipefail

package="${1:-}"
if [[ ! -f "$package" || "$package" != *.AppImage ]]; then
  printf 'Pemakaian: bash pos-electron/install-linux.sh /path/to/Bisa-POS.AppImage\n' >&2
  exit 1
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
application_dir="$data_dir/bisa-pos"
launcher="$data_dir/applications/id.bisaerp.pos.desktop"

# Desktop Entry Exec handles percent signs as field codes and quotes as syntax.
binary="$application_dir/bisa-pos.AppImage"
exec_path="${binary//\\/\\\\\\\\}"
exec_path="${exec_path//\"/\\\\\"}"
exec_path="${exec_path//\$/\\\\\$}"
exec_path="${exec_path//\`/\\\\\`}"
exec_path="${exec_path//%/%%}"

install -d "$application_dir" "$(dirname "$launcher")"
install -m 755 "$package" "$binary"
cat > "$launcher" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Bisa POS
Comment=Terminal kasir Bisa ERP
Exec="$exec_path"
Icon=id.bisaerp.pos
Terminal=false
Categories=Office;
DESKTOP

icon="$(dirname "$0")/../public/icon-512.png"
if [[ -f "$icon" ]]; then
  icon_dir="$data_dir/icons/hicolor/512x512/apps"
  install -d "$icon_dir"
  install -m 644 "$icon" "$icon_dir/id.bisaerp.pos.png"
fi

printf 'Bisa POS tersedia di menu aplikasi.\n'
