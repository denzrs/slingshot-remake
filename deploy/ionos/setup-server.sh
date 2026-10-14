#!/usr/bin/env bash
# One-time bootstrap for the IONOS relay server.
#
# Run this script as root on the VPS. It is idempotent: run it again any time, it
# only fixes what is missing. After this, every deploy runs as the `ops` user and
# needs no root: GitHub Actions copies the binary into /srv/slingshot and flips the
# relay with `systemctl --user`.
#
#   sudo bash /srv/slingshot/ionos-setup/setup-server.sh
set -euo pipefail

OPS_USER="${OPS_USER:-ops}"
APP_DIR=/srv/slingshot
UNIT_NAME=slingshot-relay.service

# Run under root.
if [ "$(id -u)" -ne 0 ]; then
  echo "Re-running under sudo..."
  exec sudo "$0" "$@"
fi

# Create the ops user if it does not exist yet.
if ! id "$OPS_USER" >/dev/null 2>&1; then
  echo "Creating user $OPS_USER..."
  useradd --create-home --shell /bin/bash "$OPS_USER"
fi

# The deploy directory is ops-owned, so nothing in the deploy path needs root.
install -d -o "$OPS_USER" -g "$OPS_USER" -m 0750 "$APP_DIR"

# Keep the relay alive after reboot without a login.
loginctl enable-linger "$OPS_USER"

# Install the user unit from this directory.
UNIT_SRC="$(cd "$(dirname "$0")" && pwd)/$UNIT_NAME"
USER_UNIT_DIR="/home/$OPS_USER/.config/systemd/user"
install -d -o "$OPS_USER" -g "$OPS_USER" -m 0700 "$USER_UNIT_DIR"
install -o "$OPS_USER" -g "$OPS_USER" -m 0644 "$UNIT_SRC" "$USER_UNIT_DIR/$UNIT_NAME"

# Install Certbot's deploy hook to restore ops' certificate access after renewal
# and restart the relay so it loads the renewed certificate.
RENEWAL_HOOK_DIR=/etc/letsencrypt/renewal-hooks/deploy
install -d -o root -g root -m 0755 "$RENEWAL_HOOK_DIR"
install -o root -g root -m 0750 "$(dirname "$0")/renewal-deploy.sh" \
  "$RENEWAL_HOOK_DIR/slingshot-relay"

# Remove the old root-owned system unit from before the rethink, if it is still there.
if systemctl list-unit-files --type=service --plain --no-legend "$UNIT_NAME" | grep -q .; then
  echo "Removing the old system unit $UNIT_NAME..."
  systemctl disable --now "$UNIT_NAME" || true
  rm -f "/etc/systemd/system/$UNIT_NAME"
  systemctl daemon-reload
fi

# Write a placeholder env only when the first deploy has not written one yet.
if [ ! -s "$APP_DIR/relay.env" ]; then
  printf '# Written by setup-server.sh. The GitHub Actions deploy overwrites this file.\n' \
    > "$APP_DIR/relay.env"
  chown "$OPS_USER:$OPS_USER" "$APP_DIR/relay.env"
  chmod 0640 "$APP_DIR/relay.env"
fi

# Start the user unit now and at every boot.
as_ops() {
  runuser -u "$OPS_USER" -- env XDG_RUNTIME_DIR="/run/user/$(id -u "$OPS_USER")" "$@"
}
as_ops systemctl --user daemon-reload
as_ops systemctl --user enable --now "$UNIT_NAME"
sleep 2

if as_ops systemctl --user is-active --quiet "$UNIT_NAME"; then
  echo "OK: $UNIT_NAME is active."
else
  # No binary yet, so it cannot start: the first deploy will. Report, do not fail.
  echo "WARNING: $UNIT_NAME installed but not active yet. The first deploy starts it."
  as_ops systemctl --user status "$UNIT_NAME" --no-pager || true
fi

cat <<'EOF'

Bootstrap done. Next, on GitHub:

  - ionos-production environment variables:
      IONOS_SERVER_IP, IONOS_DEPLOY_USER (ops),
      RELAY_PORT, RELAY_ALLOWED_ORIGINS, RELAY_MAX_CONNECTIONS,
      RELAY_MAX_CONNECTIONS_PER_IP, RELAY_CONNECTIONS_PER_IP_PER_SECOND,
      RELAY_MAX_MESSAGES_PER_SECOND, RELAY_HEALTHCHECK_URL
  - ionos-production environment secrets:
      IONOS_DEPLOY_SSH_KEY (private key), IONOS_DEPLOY_KNOWN_HOSTS
  - put the matching public key in /home/ops/.ssh/authorized_keys

A v* tag push or a manual workflow_dispatch then deploys the relay.
EOF
