#!/usr/bin/env bash
set -euo pipefail

SKALD_DATA="/home/nooker/skald-data"
BACKUP_DIR="${SKALD_DATA}/backups"
DB="${SKALD_DATA}/events.sqlite"
RETENTION_DAYS=14

echo "=== Skald Backup ==="

# Check that source database exists
if [ ! -s "${DB}" ]; then
  echo "ERROR: Database ${DB} not found or is empty. Has the server ever been started?"
  exit 1
fi

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/events-${TIMESTAMP}.sqlite"

# Online backup via sqlite3 .backup (safe for WAL mode)
echo "Creating backup: ${BACKUP_FILE}"
sqlite3 "${DB}" ".backup '${BACKUP_FILE}'"

# Integrity check — fail if broken
RESULT=$(sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;" 2>&1)
if [ "${RESULT}" != "ok" ]; then
  echo "ERROR: Integrity check failed: ${RESULT}"
  rm -f "${BACKUP_FILE}"
  exit 1
fi
echo "[OK] Backup created and verified."

# Remove backups older than RETENTION_DAYS
echo "Cleaning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -maxdepth 1 \( -name 'events-*.sqlite' -o -name 'backup-*.sqlite' \) -type f -mtime +${RETENTION_DAYS} -delete

echo "[OK] Backup complete."
