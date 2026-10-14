# Deployment TODO

## IONOS VPS and relay

- [x] Use the existing `ops` account for both deployment and running the relay.
- [x] Set up the `ops` SSH login.
- [x] Confirm `ops` can write `/srv/slingshot`.
- [x] Install the user unit at `/home/ops/.config/systemd/user/slingshot-relay.service`, enable linger, and run it as `ops`.
- [x] Ensure `ops` can read the TLS certificate and private key using narrowly scoped ACLs.
- [x] Add the deployment SSH key and pinned host-key entry to GitHub Actions secrets.
- [x] Resolve `slingshot-relay.eu` to the VPS and issue the Let's Encrypt certificate with Certbot.
- [ ] Confirm Certbot renewal is enabled (`systemctl status certbot.timer`) and install `deploy/ionos/renewal-deploy.sh` as `/etc/letsencrypt/renewal-hooks/deploy/slingshot-relay`; rerun the setup script to install the hook.
- [ ] Configure the VPS firewall and OS firewall to allow inbound TCP `8080` for direct TLS to the Rust relay.
- [ ] Ensure `RELAY_ALLOWED_ORIGINS` exactly matches the frontend origin: currently `https://denzrs.github.io`.

## GitHub configuration

The following repository Actions settings were present when this TODO was written; verify them under **Settings → Secrets and variables → Actions** before deploying:

- [x] Variable `VITE_COFFEE_URL` — `https://buymeacoffee.com/slingshot.remake`.
- [ ] Set `VITE_MULTIPLAYER_SERVER` to `wss://slingshot-relay.eu:8080` as a repository variable.
- [ ] Create the `ionos-production` GitHub Environment and restrict deployments to `main`. The IONOS SSH secrets are already configured at repository scope and are usable by these jobs; move them into the environment only if you want environment-level secret protection. Set `IONOS_SERVER_IP=04aik8t.cserverhost.cloud`, `IONOS_DEPLOY_USER=ops`, `RELAY_ALLOWED_ORIGINS=https://denzrs.github.io`, and `RELAY_HEALTHCHECK_URL=wss://slingshot-relay.eu:8080` as environment variables.
- [ ] After changing `VITE_MULTIPLAYER_SERVER`, confirm it is saved as a GitHub **variable**. It is embedded in the public browser bundle at build time, so it cannot be hidden from site visitors.

Optional workflow settings (defaults apply if unset): `RELAY_PORT=8080`, `RELAY_MAX_CONNECTIONS=1000`, `RELAY_MAX_CONNECTIONS_PER_IP=64`, `RELAY_CONNECTIONS_PER_IP_PER_SECOND=20`, `RELAY_MAX_MESSAGES_PER_SECOND=300`.

On merges to `main`, `deploy.yml` runs tests and publishes Pages; it restarts the relay only when relay/server/deployment files changed. The relay deploy includes a public WebSocket handshake check and rolls back both binary and configuration if restart or health check fails. Manual relay deployment is restricted to `main` through the `ionos-production` environment.

## Merge and deploy

- [ ] Get the required review and merge PR [#43](https://github.com/denzrs/slingshot-remake/pull/43), ensuring its merge includes the Rust backend, current deploy workflow, and relay files.
- [ ] Coordinate the README hosting/environment section with PR #48, which is still open and edits that same README area.
- [ ] Once the required GitHub Environment settings are configured, run a main-branch deploy and confirm Pages and the relay health check pass.
- [ ] Check the workflow result and confirm `slingshot-relay.service` is active on the VPS.
- [ ] Set `VITE_MULTIPLAYER_SERVER` to `wss://slingshot-relay.eu:8080`, then verify the WebSocket handshake and create/join a room from the deployed frontend.

## Deployment design

The relay runs as `ops` in a systemd user unit. Deployments copy the binary and environment file into `/srv/slingshot`, restart the service, and check the public WebSocket handshake. The relay terminates TLS with Certbot's Let's Encrypt certificate. A Certbot deploy hook reapplies `ops` ACLs to renewed certificate files and restarts the relay to load the renewed certificate.
