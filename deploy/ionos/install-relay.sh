#!/usr/bin/env bash
set -euo pipefail

readonly SERVICE_NAME=slingshot-relay.service
readonly BINARY_SOURCE=/tmp/slingshot-server
readonly ENV_SOURCE=/tmp/relay.env
readonly SERVICE_SOURCE=/tmp/slingshot-relay.service
readonly SERVICE_INSTALLED=/etc/systemd/system/$SERVICE_NAME
readonly DEPLOY_ROOT=/srv/slingshot
readonly RELEASES_DIR="$DEPLOY_ROOT/releases"
readonly CURRENT_LINK="$DEPLOY_ROOT/current"

[[ "$(id -un)" == ops ]] || { printf 'Run this installer as ops\n' >&2; exit 1; }
test -x "$BINARY_SOURCE" || { printf 'Missing executable relay binary: %s\n' "$BINARY_SOURCE" >&2; exit 1; }
test -f "$ENV_SOURCE" || { printf 'Missing relay environment file: %s\n' "$ENV_SOURCE" >&2; exit 1; }
test -f "$SERVICE_SOURCE" || { printf 'Missing service unit: %s\n' "$SERVICE_SOURCE" >&2; exit 1; }
test -d "$DEPLOY_ROOT" && test -w "$DEPLOY_ROOT" || {
  printf 'User ops must be able to write %s\n' "$DEPLOY_ROOT" >&2
  exit 1
}
cmp -s "$SERVICE_SOURCE" "$SERVICE_INSTALLED" || {
  printf 'Systemd unit differs from the root-installed unit; install the reviewed unit once as administrator\n' >&2
  exit 1
}

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
port_value=$((10#${settings[PORT]}))
(( port_value >= 1 && port_value <= 65535 )) || { printf 'PORT must be an integer from 1 to 65535\n' >&2; exit 1; }
[[ -n "${settings[ALLOWED_ORIGINS]-}" ]] || { printf 'ALLOWED_ORIGINS is required\n' >&2; exit 1; }
if [[ -n "${settings[TLS_CERT]-}" && -z "${settings[TLS_KEY]-}" || -z "${settings[TLS_CERT]-}" && -n "${settings[TLS_KEY]-}" ]]; then
  printf 'TLS_CERT and TLS_KEY must be set together\n' >&2
  exit 1
fi
settings[MAX_CONNECTIONS]=${settings[MAX_CONNECTIONS]:-1000}
settings[MAX_CONNECTIONS_PER_IP]=${settings[MAX_CONNECTIONS_PER_IP]:-64}
settings[CONNECTIONS_PER_IP_PER_SECOND]=${settings[CONNECTIONS_PER_IP_PER_SECOND]:-20}
settings[MAX_MESSAGES_PER_SECOND]=${settings[MAX_MESSAGES_PER_SECOND]:-300}

install -d "$RELEASES_DIR"
previous_release=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
rollback_release() {
  local result=$?
  trap - EXIT
  if (( result != 0 )) && [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$DEPLOY_ROOT/current.rollback"
    mv -Tf "$DEPLOY_ROOT/current.rollback" "$CURRENT_LINK"
    restorecon -h "$CURRENT_LINK" 2>/dev/null || true
    sudo -n /usr/bin/systemctl restart "$SERVICE_NAME" || true
  fi
  exit "$result"
}
readonly release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
readonly release_dir="$RELEASES_DIR/$release_id"
mkdir -m 0755 "$release_dir"
install -m 0755 "$BINARY_SOURCE" "$release_dir/slingshot-server"
umask 022
install -m 0644 /dev/null "$release_dir/relay.env.new"
for key in PORT ALLOWED_ORIGINS MAX_CONNECTIONS MAX_CONNECTIONS_PER_IP CONNECTIONS_PER_IP_PER_SECOND MAX_MESSAGES_PER_SECOND TLS_CERT TLS_KEY; do
  [[ -n "${settings[$key]-}" ]] || continue
  printf '%s=%s\n' "$key" "${settings[$key]}" >> "$release_dir/relay.env.new"
done
mv -f "$release_dir/relay.env.new" "$release_dir/relay.env"

command -v restorecon >/dev/null 2>&1 || { printf 'restorecon is required for SELinux labeling\n' >&2; exit 1; }
command -v matchpathcon >/dev/null 2>&1 || { printf 'matchpathcon is required to check SELinux labels\n' >&2; exit 1; }
restorecon -RF "$release_dir"
binary_context=$(matchpathcon -n "$release_dir/slingshot-server")
env_context=$(matchpathcon -n "$release_dir/relay.env")
[[ "$binary_context" == *:bin_t:* ]] || { printf 'Expected SELinux bin_t for relay binary, got: %s\n' "$binary_context" >&2; exit 1; }
[[ "$env_context" == *:etc_t:* ]] || { printf 'Expected SELinux etc_t for relay environment, got: %s\n' "$env_context" >&2; exit 1; }

trap rollback_release EXIT
if [[ -n "$previous_release" && -d "$previous_release" ]]; then
  ln -sfn "$previous_release" "$RELEASES_DIR/previous.new"
  mv -Tf "$RELEASES_DIR/previous.new" "$RELEASES_DIR/previous"
fi
ln -sfn "$release_dir" "$DEPLOY_ROOT/current.new"
mv -Tf "$DEPLOY_ROOT/current.new" "$CURRENT_LINK"
restorecon -h "$CURRENT_LINK"
sudo -n /usr/bin/systemctl restart "$SERVICE_NAME"
sudo -n /usr/bin/systemctl is-active --quiet "$SERVICE_NAME"
trap - EXIT
