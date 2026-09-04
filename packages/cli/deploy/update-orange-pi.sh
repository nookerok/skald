#!/usr/bin/env bash
set -euo pipefail

SKALD_CODE="/home/nooker/skald"
SKALD_DATA="/home/nooker/skald-data"
BACKUP_DIR="${SKALD_DATA}/backups"
DB="${SKALD_DATA}/events.sqlite"
AI_PROBE_URL="http://127.0.0.1:3000/api/ops/ai-probe"
NODE_BINARY="/home/nooker/.nvm/versions/node/v22.23.1/bin/node"
NODE_BIN_DIR="$(dirname "${NODE_BINARY}")"

echo "=== Skald Update Script ==="

if [ "$(id -u)" -eq 0 ]; then
  echo "ERROR: Do not run this script as root or with sudo."
  exit 1
fi

cd "${SKALD_CODE}"

# 1. Check for clean working tree (including untracked)
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is not clean."
  git status --short
  exit 1
fi

# 2. Reject detached HEAD
PREV_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "${PREV_BRANCH}" = "HEAD" ] || [ -z "${PREV_BRANCH}" ]; then
  echo "ERROR: Detached HEAD. Switch to a branch before updating."
  echo "  git checkout main"
  exit 1
fi
PREV_COMMIT=$(git rev-parse HEAD)
echo "Branch: ${PREV_BRANCH}"
echo "Commit: ${PREV_COMMIT}"

# 3. Require the installer-managed restricted restart privilege before mutation
if ! sudo -n -l /usr/bin/systemctl restart skald.service >/dev/null 2>&1; then
  echo "ERROR: Non-interactive restart permission is not installed."
  echo "Run packages/cli/deploy/install-orange-pi.sh interactively once."
  exit 1
fi

# 4. Database must exist for always-on server
if [ ! -s "${DB}" ]; then
  echo "ERROR: ${DB} does not exist or is empty."
  echo "For an always-on server the canonical database must be present."
  exit 1
fi

# 5. Backup SQLite
mkdir -p "${BACKUP_DIR}"
BACKUP_FILE="${BACKUP_DIR}/backup-${PREV_COMMIT}-pre-update-$(date +%Y%m%d-%H%M%S).sqlite"
echo "Backing up SQLite to ${BACKUP_FILE}..."
sqlite3 "${DB}" ".backup '${BACKUP_FILE}'"
RESULT=$(sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;" 2>&1)
if [ "${RESULT}" != "ok" ]; then
  echo "ERROR: Backup integrity check failed: ${RESULT}"
  rm -f "${BACKUP_FILE}"
  exit 1
fi
echo "[OK] Backup created and verified."

# 6. Fetch and fast-forward
echo "Fetching updates..."
git fetch origin "${PREV_BRANCH}"
if ! git pull --ff-only origin "${PREV_BRANCH}"; then
  echo "ERROR: git pull --ff-only failed."
  echo "Rollback: git reset --hard ${PREV_COMMIT} && npm ci && sudo systemctl restart skald.service"
  exit 1
fi
CURRENT_COMMIT=$(git rev-parse HEAD)
echo "Current commit: ${CURRENT_COMMIT}"

# 7. Fix Node runtime to match systemd unit
if [ ! -x "${NODE_BINARY}" ]; then
  echo "ERROR: Node v22.23.1 not found at ${NODE_BINARY}."
  echo "Run: nvm install 22.23.1 && nvm use 22.23.1"
  exit 1
fi
export PATH="${NODE_BIN_DIR}:${PATH}"
NODE_VER=$(node --version)
if [ "${NODE_VER}" != "v22.23.1" ]; then
  echo "ERROR: Active node version is ${NODE_VER}, expected v22.23.1."
  echo "Run: nvm use 22.23.1"
  exit 1
fi
echo "[OK] Node v22.23.1 confirmed."

# 8. Build and test — wrap in rollback-guidance block
echo "Installing dependencies..."
if ! npm ci; then
  echo "ERROR: npm ci failed."
  echo "Rollback: git reset --hard ${PREV_COMMIT} && npm ci && sudo systemctl restart skald.service"
  exit 1
fi
echo "Validation..."
if ! npm run validate; then
  echo "ERROR: Tests failed."
  echo "Rollback: git reset --hard ${PREV_COMMIT} && npm ci && sudo systemctl restart skald.service"
  exit 1
fi
echo "[OK] Build and tests passed."

# 9. Restart through the installer-managed single-command sudoers policy
sudo -n /usr/bin/systemctl restart skald.service

# 10. Wait for health
echo "Waiting for health check..."
for i in $(seq 1 60); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
    echo "[OK] Server is healthy."
    break
  fi
  sleep 1
done

if ! curl --fail --silent --max-time 2 http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
  echo "ERROR: Server did not become healthy within 60 seconds."
  echo "Previous commit: ${PREV_COMMIT}"
  echo "Current commit: ${CURRENT_COMMIT}"
  echo "Rollback: git reset --hard ${PREV_COMMIT} && npm ci && sudo systemctl restart skald.service"
  echo ""
  journalctl -u skald.service -n 100 --no-pager
  exit 1
fi

# 11. Deployment acceptance: liveness is necessary but not sufficient.
echo "Checking AI readiness (loopback probe)..."
AI_RESPONSE=$(curl --silent --show-error --max-time 30 -X POST -H "Content-Type: application/json" -d '{}' -w $'\n%{http_code}' "${AI_PROBE_URL}" 2>&1 || true)
AI_HTTP_STATUS="${AI_RESPONSE##*$'\n'}"
AI_BODY="${AI_RESPONSE%$'\n'*}"
if [ "${AI_HTTP_STATUS}" != "200" ]; then
  echo "[OK] Simulation is healthy"
  echo "[ERROR] AI readiness failed"
  echo "Deployment acceptance: FAILED"
  echo "Previous commit: ${PREV_COMMIT}"
  echo "Current commit: ${CURRENT_COMMIT}"
  echo "Sanitized readiness report: ${AI_BODY}"
  echo "Rollback guidance: inspect model/configuration and restore ${PREV_COMMIT} only if the deployed code is incompatible."
  exit 1
fi
echo "[OK] AI readiness is ready."

# The fast-forward must still point at the commit that was validated.
if [ "$(git rev-parse HEAD)" != "${CURRENT_COMMIT}" ]; then
  echo "ERROR: commit changed during deployment."
  echo "Previous commit: ${PREV_COMMIT}"
  echo "Current commit: ${CURRENT_COMMIT}"
  exit 1
fi
echo "Update complete."
exit 0
