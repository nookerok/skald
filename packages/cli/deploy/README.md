# Skald Orange Pi Deployment

## Prerequisites

- Orange Pi 4 LTS (aarch64)
- Armbian or Ubuntu 22.04+
- Node.js 22.23.1 (via nvm)
- SQLite3 CLI

## Quick Install

```bash
cd /home/nooker
git clone https://github.com/nookerok/skald.git
cd skald

source ~/.nvm/nvm.sh
nvm install 22.23.1
nvm use 22.23.1

npm ci
npm run typecheck
npm test -- --run

chmod +x packages/cli/deploy/*.sh
packages/cli/deploy/install-orange-pi.sh
```

The install script will:
1. Verify prerequisites (including exact Node v22.23.1 binary)
2. Run build and tests
3. Create `/home/nooker/skald-data` and backups directory
4. Install a restricted sudoers rule for restarting only `skald.service`
5. Install helper scripts to `/usr/local/bin/`
6. Install systemd units
7. Start the server and wait for simulation liveness
8. Require `SKALD_AI_REQUIRED=1`, run the loopback AI readiness probe, and
   refuse installation completion when the required routes are not ready
9. Enable health check and backup timers

The installer creates `skald.env` from the example on first run. Set
`SKALD_AI_REQUIRED=1` and add the OpenCode Zen key before rerunning it; `0` is
reserved for local/test environments and cannot produce an Orange Pi success
banner. The server fetches the live Zen catalogue at startup and probes every
preferred model for both routes before selecting active and backup models.

## Target preflight

Before any commit, push or updater invocation, run the local read-only target
preflight:

```bash
packages/cli/deploy/preflight-orange-pi.sh
```

It performs two independent checks:

1. `GET http://192.168.0.5:3000/api/health` checks HTTP simulation liveness.
2. `ssh -i /home/nook/.ssh/id_ed25519_skald nooker@192.168.0.5` checks
   `hostname`, `whoami`, `uname -a`, `/home/nooker/skald`,
   `/home/nooker/skald-data` and `systemctl is-active skald.service`.

The canonical command is:

```bash
ssh -i /home/nook/.ssh/id_ed25519_skald nooker@192.168.0.5 \
  'hostname; whoami; uname -a; \
   test -d /home/nooker/skald; \
   test -d /home/nooker/skald-data; \
   systemctl is-active skald.service'
```

The SSH check is repeated in five independent sessions. This catches a
port-forward or NAT that alternates between the Orange Pi and another host;
every observed session must match the canonical identity.

HTTP 200 does not identify the machine behind the HTTP endpoint. If HTTP is
alive but SSH reaches the wrong user/host or the canonical paths/service do not
match, the script returns `HTTP_ALIVE_SSH_IDENTITY_MISMATCH`, prints
`Preflight: BLOCKED` and exits non-zero. It never substitutes another user or
path and never runs commit, push, updater, restart or migrations.

The only deployable identity is `nooker` with repository
`/home/nooker/skald`, data `/home/nooker/skald-data` and active
`skald.service`.

> **Do not run install-orange-pi.sh with sudo.** It refuses root. Only `systemctl` and file copies inside the script use sudo.

## Configuration

AI provider keys and the production acceptance policy go in `/home/nooker/skald-data/skald.env`:
```
SKALD_OPENCODE_ZEN_API_KEY=your_key_here
# Optional legacy provider key; it is not a live Zen candidate.
SKALD_OLLAMA_CLOUD_API_KEY=
SKALD_AI_REQUIRED=1
```

`GET /api/health` is simulation liveness only and never calls a provider.
`POST http://127.0.0.1:3000/api/ops/ai-probe` is loopback-only and returns 200
only when the live Zen catalogue has at least two models that pass both
authenticated no-world probes. The JSON report includes `activeModel`,
`backupModel` and sanitized exclusion reasons. With `SKALD_AI_REQUIRED=0`,
deterministic fallback keeps the server usable but an AI readiness failure is
not deployment acceptance.

## Access

```bash
# Server IP
hostname -I

# From another device on LAN:
# http://<IP>:3000
```

## Managing the Service

```bash
systemctl status skald.service
journalctl -u skald.service -f
sudo systemctl restart skald.service
sudo systemctl stop skald.service
sudo systemctl disable --now skald.service
```

## Updating

```bash
/usr/local/bin/update-orange-pi.sh
```

The update script:
1. Refuses root/sudo
2. Requires the installer-managed non-interactive permission to restart only
   `skald.service`; it fails before backup or pull when the permission is absent
3. Checks for clean working tree (including untracked files)
4. Rejects detached HEAD
5. Creates and verifies a SQLite backup
6. Fetches and merges via `git pull --ff-only`
7. Runs `npm ci`, typecheck, and tests
8. Restarts the service
9. Waits up to 60 seconds for simulation liveness
10. Runs the loopback AI readiness probe and exits non-zero on `degraded`,
    `unavailable` or `misconfigured`; it prints `Update complete` only after
    readiness is `ready`

> **Do not run update-orange-pi.sh with sudo.** It refuses root.

## Backup

```bash
# Manual backup
sudo systemctl start skald-backup.service

# Automatic: daily via systemd timer
# Backups stored in /home/nooker/skald-data/backups/
# Retention: 14 days (backup-*.sqlite pattern)
```

### Restore

Use the restore script (recommended):

```bash
sudo /usr/local/bin/restore-skald.sh /home/nooker/skald-data/backups/events-<DATE>.sqlite
```

The script:
1. Verifies backup integrity (`PRAGMA integrity_check`)
2. Stops timers, then services
3. Replaces database and cleans stale WAL/SHM files
4. Starts server and waits for simulation liveness (up to 60 seconds)
5. Re-enables timers only after successful health check

Manual procedure (if script is unavailable):

```bash
# 1. Verify the backup is intact
sqlite3 /home/nooker/skald-data/backups/events-<DATE>.sqlite "PRAGMA integrity_check;"
# Expect: ok

# 2. Stop timers first (prevent concurrent jobs)
sudo systemctl stop skald-backup.timer skald-healthcheck.timer

# 3. Stop services (timer-triggered oneshots + server)
sudo systemctl stop skald-backup.service skald-healthcheck.service
sudo systemctl stop skald.service

# 4. Replace database and remove stale WAL
cp /home/nooker/skald-data/backups/events-<DATE>.sqlite /home/nooker/skald-data/events.sqlite
chown nooker:nooker /home/nooker/skald-data/events.sqlite
chmod 600 /home/nooker/skald-data/events.sqlite
rm -f /home/nooker/skald-data/events.sqlite-wal /home/nooker/skald-data/events.sqlite-shm

# 5. Start server and wait for health
sudo systemctl start skald.service
sleep 2
curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/health || {
  echo "Server did not become healthy. Check: journalctl -u skald.service -n 50"
  exit 1
}

# 6. Only then re-enable timers
sudo systemctl start skald-backup.timer skald-healthcheck.timer
```

## Rollback

If an update fails or the new version has issues:

```bash
cd /home/nooker/skald
git log --oneline -5
git reset --hard <PREVIOUS_COMMIT>
npm ci
sudo systemctl restart skald.service
```

## Firewall

```bash
sudo ufw allow ssh
sudo ufw allow from 192.168.0.0/16 to any port 3000 proto tcp
sudo ufw enable
```

## Important Notes

- **Trusted LAN only.** No authentication, no TLS, no multi-user isolation.
- **Single process.** Do not run multiple Skald instances on the same SQLite.
- **No auto-advancing time.** World time advances only with player commands, `wait`, or `advance N`.
- **Node 22.23.1 required.** `node:sqlite` is experimental and the service hardcodes this path.
- **AI readiness is separate from liveness.** Without a Zen key, the server
  remains usable with deterministic fallback when `SKALD_AI_REQUIRED=0`;
  production acceptance requires a live Zen catalogue and two passing model
  probes.
