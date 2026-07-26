# Skald Orange Pi Deployment

## Prerequisites

- Orange Pi 4 LTS (aarch64)
- Armbian or Ubuntu 22.04+
- Node.js 22.23.1 (via nvm)
- SQLite3 CLI

## Quick Install

```bash
cd /home/nook
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
3. Create `/home/nook/skald-data` and backups directory
4. Install helper scripts to `/usr/local/bin/`
5. Install systemd units
6. Start the server and wait for health
7. Enable health check and backup timers

> **Do not run install-orange-pi.sh with sudo.** It refuses root. Only `systemctl` and file copies inside the script use sudo.

## Configuration

LLM API keys go in `/home/nook/skald-data/skald.env`:
```
SKALD_OPENCODE_ZEN_API_KEY=your_key_here
SKALD_OLLAMA_CLOUD_API_KEY=your_key_here
```

Without keys, the server runs normally with template-based narrative fallback.

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
2. Checks for clean working tree (including untracked files)
3. Rejects detached HEAD
4. Creates SQLite backup (only if DB exists)
5. Fetches and merges via `git pull --ff-only`
6. Runs `npm ci`, typecheck, and tests
7. Restarts the service
8. Waits up to 60 seconds for health check

> **Do not run update-orange-pi.sh with sudo.** It refuses root.

## Backup

```bash
# Manual backup
sudo systemctl start skald-backup.service

# Automatic: daily via systemd timer
# Backups stored in /home/nook/skald-data/backups/
# Retention: 14 days (backup-*.sqlite pattern)
```

### Restore

Use the restore script (recommended):

```bash
sudo /usr/local/bin/restore-skald.sh /home/nook/skald-data/backups/events-<DATE>.sqlite
```

The script:
1. Verifies backup integrity (`PRAGMA integrity_check`)
2. Stops timers, then services
3. Replaces database and cleans stale WAL/SHM files
4. Starts server and waits for health (up to 60 seconds)
5. Re-enables timers only after successful health check

Manual procedure (if script is unavailable):

```bash
# 1. Verify the backup is intact
sqlite3 /home/nook/skald-data/backups/events-<DATE>.sqlite "PRAGMA integrity_check;"
# Expect: ok

# 2. Stop timers first (prevent concurrent jobs)
sudo systemctl stop skald-backup.timer skald-healthcheck.timer

# 3. Stop services (timer-triggered oneshots + server)
sudo systemctl stop skald-backup.service skald-healthcheck.service
sudo systemctl stop skald.service

# 4. Replace database and remove stale WAL
cp /home/nook/skald-data/backups/events-<DATE>.sqlite /home/nook/skald-data/events.sqlite
chown nook:nook /home/nook/skald-data/events.sqlite
chmod 600 /home/nook/skald-data/events.sqlite
rm -f /home/nook/skald-data/events.sqlite-wal /home/nook/skald-data/events.sqlite-shm

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
cd /home/nook/skald
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
- **LLM is optional.** Without API keys, template narrative is used.
