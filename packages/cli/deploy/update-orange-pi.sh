#!/usr/bin/env bash
set -euo pipefail

SKALD_CODE="/home/nooker/skald"
SKALD_DATA="/home/nooker/skald-data"
BACKUP_DIR="${SKALD_DATA}/backups"
DB="${SKALD_DATA}/events.sqlite"
AI_PROBE_URL="http://127.0.0.1:3000/api/ops/ai-probe"
NODE_BINARY="/home/nooker/.nvm/versions/node/v22.23.1/bin/node"
NODE_BIN_DIR="$(dirname "${NODE_BINARY}")"

# Pinned narrative agent manifest paths. The manifest itself is installed
# only after validation (step 8b); AGENT_BACKUP_DIR holds the previously
# installed manifest for restore on post-restart failure.
AGENT_SRC="packages/cli/deploy/opencode-narrative-agent.md"
AGENT_DIR="/home/nooker/.config/opencode/agents"
AGENT_DST="${AGENT_DIR}/narrative.md"
AGENT_BACKUP_DIR=""

restore_agent_manifest() {
  if [ -n "${AGENT_BACKUP_DIR}" ] && [ -f "${AGENT_BACKUP_DIR}/narrative.md" ]; then
    cp "${AGENT_BACKUP_DIR}/narrative.md" "${AGENT_DST}"
    chmod 600 "${AGENT_DST}"
    echo "[INFO] Previous agent manifest restored."
  fi
}

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

# 3b. Production containment policy for the opencode_run transport. When it
# is enabled, isolation must stay on and the manifest must be the repo-pinned
# one: a hand-edited env must never silently disarm containment. Fails before
# any mutation. Commented lines never match (anchors require line start).
PROD_ENV_FILE="${SKALD_DATA}/skald.env"
if grep -q -E '^[[:space:]]*SKALD_OPENCODE_RUN[[:space:]]*=[[:space:]]*1([[:space:]]*(#.*)?)?$' "${PROD_ENV_FILE}" 2>/dev/null; then
  if grep -q -E '^[[:space:]]*SKALD_OPENCODE_ISOLATE_HOME[[:space:]]*=[[:space:]]*0([[:space:]]*(#.*)?)?$' "${PROD_ENV_FILE}" 2>/dev/null; then
    echo "ERROR: SKALD_OPENCODE_ISOLATE_HOME=0 is forbidden in production while SKALD_OPENCODE_RUN=1."
    exit 1
  fi
  if grep -q -E '^[[:space:]]*SKALD_OPENCODE_AGENT_MANIFEST[[:space:]]*=[[:space:]]*[^[:space:]#]' "${PROD_ENV_FILE}" 2>/dev/null; then
    echo "ERROR: SKALD_OPENCODE_AGENT_MANIFEST override is forbidden in production; the repo-pinned manifest applies."
    exit 1
  fi
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

# 6b. Require the pinned narrative agent manifest in the pulled tree, but do
# not install it yet: the running service must never see an agent from an
# unaccepted commit. Installation happens after validation (step 8b).
if [ ! -f "${AGENT_SRC}" ]; then
  echo "ERROR: agent manifest missing from the deployed tree: ${AGENT_SRC}"
  exit 1
fi

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

# 8b. Install the pinned narrative agent manifest (fail-closed containment),
# only now that the tree validated. The previous manifest is kept so a
# post-restart failure restores the last accepted agent instead of leaving
# the new, unaccepted one behind.
AGENT_BACKUP_DIR=$(mktemp -d)
if [ -f "${AGENT_DST}" ]; then
  cp "${AGENT_DST}" "${AGENT_BACKUP_DIR}/narrative.md"
fi
mkdir -p "${AGENT_DIR}"
cp "${AGENT_SRC}" "${AGENT_DST}"
chmod 600 "${AGENT_DST}"
AGENT_SRC_HASH=$(sha256sum "${AGENT_SRC}" | cut -d ' ' -f 1)
AGENT_DST_HASH=$(sha256sum "${AGENT_DST}" | cut -d ' ' -f 1)
AGENT_OWNER=$(stat -c %U "${AGENT_DST}")
AGENT_PERMS=$(stat -c %a "${AGENT_DST}")
if [ "${AGENT_SRC_HASH}" != "${AGENT_DST_HASH}" ] || [ "${AGENT_OWNER}" != "nooker" ] || [ "${AGENT_PERMS}" != "600" ]; then
  echo "ERROR: agent manifest verification failed (hash/owner/permissions). Transport stays disabled."
  restore_agent_manifest
  exit 1
fi
echo "[OK] Narrative agent manifest installed and verified."

# 9. Restart through the installer-managed single-command sudoers policy
if ! sudo -n /usr/bin/systemctl restart skald.service; then
  echo "ERROR: service restart failed."
  restore_agent_manifest
  exit 1
fi

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
  restore_agent_manifest
  journalctl -u skald.service -n 100 --no-pager
  exit 1
fi

# 11. Deployment acceptance: liveness is necessary but not sufficient.
# Accepted production posture (ADR-0036 amendments 2026-09-12): `ready` needs
# two probe-valid candidates on both routes, which the current provider shape
# cannot produce (Zen free tier is server-side locked, OpenRouter stays idle
# by design, opencode_run is a narrate-only backup). The verdict comes from
# the tested ai-acceptance helper reading `readiness.status` and `playable`
# from the sanitized body (the endpoint still answers HTTP 200 only for
# `ready`): accept `(ready|degraded) AND playable`, fail on `unavailable`,
# `misconfigured`, a dead route or an unparsable probe.
echo "Checking AI readiness (loopback probe)..."
# Worst-case probe is two sequential 25s route budgets plus overhead, so the
# curl budget must clear ~55s or a slow-but-healthy probe fails the gate.
AI_RESPONSE=$(curl --silent --show-error --max-time 60 -X POST -H "Content-Type: application/json" -d '{}' -w $'\n%{http_code}' "${AI_PROBE_URL}" 2>&1 || true)
AI_HTTP_STATUS="${AI_RESPONSE##*$'\n'}"
AI_BODY="${AI_RESPONSE%$'\n'*}"
if AI_GATE_OUT=$(printf '%s' "${AI_BODY}" | node --import tsx "${SKALD_CODE}/packages/cli/deploy/ai-acceptance.ts"); then
  echo "[OK] ${AI_GATE_OUT}"
else
  echo "[OK] Simulation is healthy"
  echo "[ERROR] ${AI_GATE_OUT:-AI readiness gate failed} (HTTP ${AI_HTTP_STATUS})"
  echo "Deployment acceptance: FAILED"
  echo "Previous commit: ${PREV_COMMIT}"
  echo "Current commit: ${CURRENT_COMMIT}"
  echo "Sanitized readiness report: ${AI_BODY}"
  echo "Rollback guidance: inspect model/configuration and restore ${PREV_COMMIT} only if the deployed code is incompatible."
  restore_agent_manifest
  exit 1
fi

# The fast-forward must still point at the commit that was validated.
if [ "$(git rev-parse HEAD)" != "${CURRENT_COMMIT}" ]; then
  echo "ERROR: commit changed during deployment."
  echo "Previous commit: ${PREV_COMMIT}"
  echo "Current commit: ${CURRENT_COMMIT}"
  exit 1
fi
if [ -n "${AGENT_BACKUP_DIR}" ]; then
  rm -rf "${AGENT_BACKUP_DIR}"
fi
echo "Update complete."
exit 0
