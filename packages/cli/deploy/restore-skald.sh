#!/usr/bin/env bash
set -euo pipefail

SKALD_DATA="/home/nooker/skald-data"
BACKUP_FILE="${1:-}"
HEALTH_URL="http://127.0.0.1:3000/api/health"

echo "=== Skald Restore ==="

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 /home/nooker/skald-data/backups/events-<DATE>.sqlite"
  echo "Backups available:"
  ls -1 "${SKALD_DATA}/backups/"*.sqlite 2>/dev/null || echo "(none)"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

# 1. Verify backup integrity
echo "Verifying backup integrity..."
RESULT=$(sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;" 2>&1)
if [ "${RESULT}" != "ok" ]; then
  echo "ERROR: Integrity check failed: ${RESULT}"
  exit 1
fi
echo "[OK] Integrity check passed."

# 2. Stop timers (prevent concurrent jobs)
echo "Stopping timers..."
sudo systemctl stop skald-backup.timer skald-healthcheck.timer

# 3. Stop services
echo "Stopping services..."
sudo systemctl stop skald-backup.service skald-healthcheck.service
sudo systemctl stop skald.service

# 4. Replace database and clean stale WAL
echo "Restoring database..."
cp "${BACKUP_FILE}" "${SKALD_DATA}/events.sqlite"
sudo chown nooker:nooker "${SKALD_DATA}/events.sqlite"
sudo chmod 600 "${SKALD_DATA}/events.sqlite"
rm -f "${SKALD_DATA}/events.sqlite-wal" "${SKALD_DATA}/events.sqlite-shm"
echo "[OK] Database restored."

# 5. Start server
echo "Starting server..."
sudo systemctl start skald.service

# 6. Wait for health
echo "Waiting for server to become healthy..."
for i in $(seq 1 30); do
  if curl --fail --silent --max-time 2 "${HEALTH_URL}" > /dev/null 2>&1; then
    echo "[OK] Server is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Server did not become healthy. Check: journalctl -u skald.service -n 50"
    exit 1
  fi
  sleep 2
done

# 7. Re-enable timers
echo "Restarting timers..."
sudo systemctl start skald-backup.timer skald-healthcheck.timer
echo "[OK] Timers enabled."
echo "=== Restore complete ==="
