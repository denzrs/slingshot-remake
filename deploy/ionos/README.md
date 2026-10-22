# IONOS relay deployment

The relay runs as the unprivileged `ops` account in a systemd user unit. The GitHub Actions job deploys the binary and `/srv/slingshot/relay.env`, restarts the unit, and checks a real WebSocket/TLS handshake against the public endpoint. If restart or health check fails, it restores both the previous binary and environment file.

## Prerequisites

- The VPS has an `ops` account with SSH access and write access to `/srv/slingshot`.
- The `ops` user has a lingering user systemd manager (`loginctl enable-linger ops`).
- `slingshot-relay.eu` resolves to the VPS, inbound TCP 8080 is allowed, and Certbot has issued `/etc/letsencrypt/live/slingshot-relay.eu/{fullchain.pem,privkey.pem}`.
- `ops` can traverse the Let's Encrypt directories and read the current certificate and key. The setup script installs a Certbot deploy hook that reapplies narrow ACLs to renewed archive files and restarts the relay.

## The daily board

The relay keeps the daily-challenge leaderboard in `/srv/slingshot/leaderboard.db` (a SQLite-compatible file written through `turso`, created on first start, `LEADERBOARD_DB` overrides the path). It is a data file next to the binary, so a deploy leaves it alone: the deployment only flips `slingshot-server` and `relay.env`, and the relay prunes the days past `LEADERBOARD_KEEP_DAYS` (default `7`) itself. It holds nothing but the day, the hashed poster, the name they chose and the score, so it needs no backup — and the relay will not start if it cannot open it, which fails the deploy's health check and rolls back rather than serving on without a board. A name the board will not carry (checked with `rustrict`) is refused with a message the player can act on; the scores themselves are taken at face value.

## Bootstrap the unit and renewal hook

Stage the files through the `Test, Deploy & Release` workflow's **bootstrap** dispatch input, review them under `/srv/slingshot/ionos-setup`, then run on the VPS:

```sh
sudo bash /srv/slingshot/ionos-setup/setup-server.sh
systemctl status certbot.timer
```

The setup script installs the unit under `/home/ops/.config/systemd/user/` and installs `renewal-deploy.sh` into Certbot's deploy-hook directory. Certbot's timer handles scheduling; the deploy hook only runs after a successful renewal. Test renewals with `sudo certbot renew --dry-run` and verify the relay remains active.

## GitHub Actions settings

Create the `ionos-production` environment and restrict deployments to the `main` branch. Put `IONOS_DEPLOY_SSH_KEY` and `IONOS_DEPLOY_KNOWN_HOSTS` in that environment as secrets. Set these environment variables:

- `IONOS_SERVER_IP`, `IONOS_DEPLOY_USER` (`ops`)
- `RELAY_ALLOWED_ORIGINS` (the exact frontend origin)
- `RELAY_HEALTHCHECK_URL` (`wss://slingshot-relay.eu:8080`)
- Optional limits: `RELAY_PORT`, `RELAY_MAX_CONNECTIONS`, `RELAY_MAX_CONNECTIONS_PER_IP`, `RELAY_CONNECTIONS_PER_IP_PER_SECOND`, `RELAY_MAX_MESSAGES_PER_SECOND`, `RELAY_STATS` (`0` switches the match statistics off, default on)

Set the repository variable `VITE_MULTIPLAYER_SERVER` to `wss://slingshot-relay.eu:8080`; it is embedded in the public frontend build. The certificate paths are configured in the workflow and the private key contents never leave the VPS.

Match statistics are on in the deployed relay: the deploy writes `STATS=1` into `relay.env` (the relay's `--stats`, given as an environment variable because the service unit passes no arguments – so the unit file never has to change and nothing has to be re-run by hand). Set the `ionos-production` variable `RELAY_STATS=0` and redeploy to switch them off. The relay then keeps a week of anonymous round statistics in `/srv/slingshot/stats.db` (`STATS_DB` overrides the path, `STATS_KEEP_DAYS` the window, default `7`). It is handled exactly like `leaderboard.db`: a data file next to the binary that a deploy leaves alone, pruned by the relay, no backup needed, and the relay will not start without it. It holds no names and no addresses – see *Match statistics* in `docs/multiplayer.md`.
