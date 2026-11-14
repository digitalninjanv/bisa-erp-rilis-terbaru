#!/usr/bin/env bash
# Helpers for moving legacy backup keys out of shell configuration files.

migrate_backup_credential() {
  local config_file="$1"
  local credential_file="$2"
  local temporary_file

  [[ -f "$config_file" ]] || return 1
  if [[ -L "$credential_file" || ( -e "$credential_file" && ! -f "$credential_file" ) ]]; then
    echo "Credential backup harus file biasa, bukan symlink atau tipe file lain: $credential_file" >&2
    return 1
  fi

  if grep -Eq '^(export[[:space:]]+)?BACKUP_PASSPHRASE=.+$' "$config_file"; then
    if [[ -s "$credential_file" ]]; then
      echo "Kunci ditemukan pada config dan credential; hapus BACKUP_PASSPHRASE dari config: $config_file" >&2
      return 1
    fi

    temporary_file="$(mktemp "${credential_file%/*}/.backup-passphrase.XXXXXX")" || return 1
    if ! bash -c 'set -e; source "$1"; printf "%s" "${BACKUP_PASSPHRASE:-}"' _ "$config_file" > "$temporary_file"; then
      rm -f -- "$temporary_file"
      echo "Gagal membaca BACKUP_PASSPHRASE lama dari $config_file" >&2
      return 1
    fi
    if [[ -s "$temporary_file" ]]; then
      chmod 600 "$temporary_file"
      mv -f -- "$temporary_file" "$credential_file"
      sed -i -E '/^(export[[:space:]]+)?BACKUP_PASSPHRASE=/d' "$config_file"
      chmod 600 "$config_file"
    else
      rm -f -- "$temporary_file"
    fi
  fi

  if grep -q '^BACKUP_PASSPHRASE=$' "$config_file"; then
    sed -i '/^BACKUP_PASSPHRASE=$/d' "$config_file"
    chmod 600 "$config_file"
  fi

  if [[ -e "$credential_file" ]]; then
    chmod 600 "$credential_file"
  fi
}
