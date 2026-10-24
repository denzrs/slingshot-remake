# IONOS relay deployment

The relay runs as the unprivileged `ops` account in a systemd user unit. The GitHub Actions job deploys the binary and `/srv/slingshot/relay.env`, restarts the unit, and checks a real WebSocket/TLS handshake against the public endpoint. If restart or health check fails, it restores both the previous binary and environment file.

## Prerequisites

- The VPS has an `ops` account with SSH access and write access to `/srv/slingshot`.
- The `ops` user has a lingering user systemd manager (`loginctl enable-linger ops`).
- `slingshot-relay.eu` resolves to the VPS, inbound TCP 8080 is allowed, and Certbot has issued `/etc/letsencrypt/live/slingshot-relay.eu/{fullchain.pem,privkey.pem}`.
- `ops` can traverse the Let's Encrypt directories and read the current certificate and key. The setup script installs a Certbot deploy hook that reapplies narrow ACLs to renewed archive files and restarts the relay.

## The daily board

The relay keeps the daily-challenge leaderboard and the match statistics in one file, `/srv/slingshot/slingshot.db` (a SQLite-compatible file written through `turso`, created on first start, `DATABASE` overrides the path; before this file the board was `leaderboard.db` – set `DATABASE=/srv/slingshot/leaderboard.db` to keep using it). It is a data file next to the binary, so a deploy leaves it alone: the deployment only flips `slingshot-server` and `relay.env`, and the relay prunes the days past `LEADERBOARD_KEEP_DAYS` (default `7`) itself. The relay will not start if it cannot open it, which fails the deploy's health check and rolls back rather than serving on without a board.

## Backups

The board alone would need none – it is a week that refills itself – but the same file holds a year of match statistics that nothing else can rebuild. The deploy writes `BACKUP_DIR=/srv/slingshot/backups` into `relay.env`, and the relay snapshots the database there once a UTC day (`slingshot-YYYY-MM-DD.db`, written with `VACUUM INTO` so the copy is consistent while the relay keeps writing), keeping the newest 7 (`BACKUP_KEEP`). The first snapshot is written on the first start after the deploy. Do not copy `slingshot.db` itself while the relay runs: the WAL beside it may be half-applied – copy a snapshot.

The snapshots live on the VPS, so they cover a bad write or a bad release, not a lost machine. Pull them somewhere else on a schedule, for example from a machine at home:

```sh
rsync -a ops@slingshot-relay.eu:/srv/slingshot/backups/ ~/backups/slingshot/
```

To restore, stop the relay, move the database aside together with its `-wal` (a WAL left beside the snapshot would be replayed onto it) and start it on a snapshot:

```sh
systemctl --user stop slingshot-relay.service
cd /srv/slingshot
mkdir -p broken && mv slingshot.db slingshot.db-* broken/ 2>/dev/null
cp backups/slingshot-YYYY-MM-DD.db slingshot.db
systemctl --user start slingshot-relay.service
``` A name the board will not carry (checked with `rustrict`) is refused with a message the player can act on; the scores themselves are taken at face value.

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

Match statistics are on in the deployed relay: the deploy writes `STATS=1` into `relay.env` (the relay's `--stats`, given as an environment variable because the service unit passes no arguments – so the unit file never has to change and nothing has to be re-run by hand). Set the `ionos-production` variable `RELAY_STATS=0` and redeploy to switch them off. The relay then keeps a year of round statistics in the same file (`STATS_KEEP_DAYS` is the window, default `365`), pruned by the relay like the board. It holds no names and no addresses – see *Match statistics* in `docs/multiplayer.md`.
