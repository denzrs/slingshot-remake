#!/usr/bin/env bash
set -euo pipefail

readonly SERVICE_NAME=slingshot-relay.service
readonly BINARY_SOURCE=/tmp/slingshot-server
readonly BINARY_DEST=/usr/local/bin/slingshot-server
readonly SERVICE_SOURCE=/tmp/slingshot-relay.service
readonly SERVICE_DEST=/etc/systemd/system/slingshot-relay.service
readonly ENV_SOURCE=/tmp/relay.env
readonly ENV_DEST=/etc/slingshot/relay.env

test -x "$BINARY_SOURCE" || { printf 'Missing executable relay binary: %s\n' "$BINARY_SOURCE" >&2; exit 1; }
test -f "$SERVICE_SOURCE" || { printf 'Missing systemd unit: %s\n' "$SERVICE_SOURCE" >&2; exit 1; }
test -f "$ENV_SOURCE" || { printf 'Missing relay environment file: %s\n' "$ENV_SOURCE" >&2; exit 1; }

declare -A settings=()
while IFS='=' read -r key value; do
  [[ -z "$key" ]] && continue
  case "$key" in
    PORT|ALLOWED_ORIGINS|MAX_CONNECTIONS|MAX_CONNECTIONS_PER_IP|CONNECTIONS_PER_IP_PER_SECOND|MAX_MESSAGES_PER_SECOND|TLS_CERT|TLS_KEY) ;;
    *) printf 'Unsupported relay setting: %s\n' "$key" >&2; exit 1 ;;
  esac
  [[ "$value" =~ ^[A-Za-z0-9_./,:=-]+$ ]] || { printf 'Invalid value for %s\n' "$key" >&2; exit 1; }
  settings[$key]=$value
done < "$ENV_SOURCE"

[[ "${settings[PORT]-}" =~ ^[0-9]{1,5}$ ]] || { printf 'PORT must be an integer from 1 to 65535\n' >&2; exit 1; }
(( 10#${settings[PORT]} >= 1 && 10#${settings[PORT]} <= 65535 )) || { printf 'PORT must be an integer from 1 to 65535\n' >&2; exit 1; }
[[ -n "${settings[ALLOWED_ORIGINS]-}" ]] || { printf 'ALLOWED_ORIGINS is required\n' >&2; exit 1; }
if [[ -n "${settings[TLS_CERT]-}" && -z "${settings[TLS_KEY]-}" ]]; then
  printf 'TLS_CERT and TLS_KEY must be set together\n' >&2
  exit 1
fi
if [[ -n "${settings[TLS_KEY]-}" && -z "${settings[TLS_CERT]-}" ]]; then
  printf 'TLS_CERT and TLS_KEY must be set together\n' >&2
  exit 1
fi
settings[MAX_CONNECTIONS]=${settings[MAX_CONNECTIONS]:-1000}
settings[MAX_CONNECTIONS_PER_IP]=${settings[MAX_CONNECTIONS_PER_IP]:-64}
settings[CONNECTIONS_PER_IP_PER_SECOND]=${settings[CONNECTIONS_PER_IP_PER_SECOND]:-20}
settings[MAX_MESSAGES_PER_SECOND]=${settings[MAX_MESSAGES_PER_SECOND]:-300}

id slingshot >/dev/null 2>&1 || { printf 'Expected existing service user slingshot\n' >&2; exit 1; }
test -d /srv/slingshot || { printf 'Expected service home /srv/slingshot\n' >&2; exit 1; }

install -d -o root -g root -m 0755 /etc/slingshot
if [[ -x "$BINARY_DEST" ]]; then
  install -o root -g root -m 0755 "$BINARY_DEST" "${BINARY_DEST}.previous"
fi
install -o root -g root -m 0755 "$BINARY_SOURCE" "${BINARY_DEST}.new"
mv -f "${BINARY_DEST}.new" "$BINARY_DEST"
install -o root -g root -m 0644 "$SERVICE_SOURCE" "$SERVICE_DEST"

umask 077
install -o root -g root -m 0600 /dev/null "$ENV_DEST"
for key in PORT ALLOWED_ORIGINS MAX_CONNECTIONS MAX_CONNECTIONS_PER_IP CONNECTIONS_PER_IP_PER_SECOND MAX_MESSAGES_PER_SECOND TLS_CERT TLS_KEY; do
  [[ -n "${settings[$key]-}" ]] || continue
  printf '%s=%s\n' "$key" "${settings[$key]}" >> "$ENV_DEST"
done
chown root:root "$ENV_DEST"
chmod 0600 "$ENV_DEST"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME"
