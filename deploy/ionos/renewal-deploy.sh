#!/usr/bin/env bash
# Run as root after Certbot renews the relay certificate. ACLs are applied to
# the current archive targets because the live/ paths are symlinks.
set -euo pipefail

domain=slingshot-relay.eu
ops_user=ops
cert_dir="/etc/letsencrypt/live/$domain"
archive_dir="/etc/letsencrypt/archive/$domain"

for dir in /etc/letsencrypt /etc/letsencrypt/live "$cert_dir" /etc/letsencrypt/archive "$archive_dir"; do
  setfacl -m "u:$ops_user:--x" "$dir"
done
setfacl -m "u:$ops_user:r--" "$(readlink -f "$cert_dir/fullchain.pem")" "$(readlink -f "$cert_dir/privkey.pem")"

uid="$(id -u "$ops_user")"
runuser -u "$ops_user" -- env XDG_RUNTIME_DIR="/run/user/$uid" \
  systemctl --user restart slingshot-relay.service
