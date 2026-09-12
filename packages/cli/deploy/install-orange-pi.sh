#!/usr/bin/env bash
set -euo pipefail

SKALD_USER="nooker"
SKALD_HOME="/home/${SKALD_USER}"
SKALD_CODE="${SKALD_HOME}/skald"
SKALD_DATA="${SKALD_HOME}/skald-data"
ENV_FILE="${SKALD_DATA}/skald.env"
NODE_BINARY="${SKALD_HOME}/.nvm/versions/node/v22.23.1/bin/node"
NODE_BIN_DIR="$(dirname "${NODE_BINARY}")"

echo "=== Skald Orange Pi Installer ==="

if [ "$(id -u)" -eq 0 ]; then
  echo "ERROR: Do not run this script as root or with sudo."
  exit 1
fi

if [ "$(id -un)" != "${SKALD_USER}" ]; then
  echo "ERROR: This script must be run as ${SKALD_USER} (current: $(id -un))."
  echo "All paths and systemd units are hardcoded for user ${SKALD_USER}."
  exit 1
fi

# 1. Prerequisites
for cmd in git curl sqlite3 systemctl; do
  if ! command -v "$cmd" &>/dev/null; then echo "ERROR: $cmd required"; exit 1; fi
done
echo "[OK] Prerequisites found."

# 2. Check exact Node binary used by systemd
if [ ! -x "${NODE_BINARY}" ]; then
  echo "ERROR: ${NODE_BINARY} not found or not executable."
  echo "Expected Node v22.23.1 installed via nvm at this exact path."
  echo "Run: nvm install 22.23.1 && nvm use 22.23.1"
  exit 1
fi

# Ensure npm commands use the same Node as systemd
export PATH="${NODE_BIN_DIR}:${PATH}"
NODE_VER=$(node --version)
if [ "${NODE_VER}" != "v22.23.1" ]; then
  echo "ERROR: Active node version is ${NODE_VER}, expected v22.23.1."
  echo "Run: nvm use 22.23.1"
  exit 1
fi
echo "[OK] Node v22.23.1 at ${NODE_BINARY}"

# 3. Paths
id "${SKALD_USER}" 2>/dev/null || { echo "ERROR: user ${SKALD_USER} not found"; exit 1; }
test -d "${SKALD_CODE}" || { echo "ERROR: ${SKALD_CODE} not found"; exit 1; }
test -f "${SKALD_CODE}/package.json" || { echo "ERROR: package.json not found"; exit 1; }
echo "[OK] Paths verified."

# 4. Build and test
cd "${SKALD_CODE}"
echo "npm ci..."
npm ci
echo "Validation..."
npm run validate
echo "[OK] Build and tests passed."

# 5. Data directories
sudo install -d -o "${SKALD_USER}" -g "${SKALD_USER}" -m 700 "${SKALD_DATA}"
sudo install -d -o "${SKALD_USER}" -g "${SKALD_USER}" -m 700 "${SKALD_DATA}/backups"
echo "[OK] Data directories created."

# 6. Restricted updater privilege
SUDOERS_SOURCE="${SKALD_CODE}/packages/cli/deploy/skald-sudoers"
SUDOERS_TARGET="/etc/sudoers.d/skald-deploy"
test -f "${SUDOERS_SOURCE}" || { echo "ERROR: ${SUDOERS_SOURCE} not found"; exit 1; }
sudo /usr/sbin/visudo -cf "${SUDOERS_SOURCE}"
sudo install -o root -g root -m 440 "${SUDOERS_SOURCE}" "${SUDOERS_TARGET}"
sudo /usr/sbin/visudo -cf "${SUDOERS_TARGET}"
echo "[OK] Restricted restart privilege installed."

# 7. Env file (do not overwrite existing)
if [ ! -f "${ENV_FILE}" ]; then
  cp "${SKALD_CODE}/packages/cli/deploy/skald.env.example" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "[INFO] ${ENV_FILE} created. Add the OpenCode Zen API key before acceptance."
else
  echo "[OK] ${ENV_FILE} already exists."
fi

# Orange Pi is a production installation target. Keep SKALD_AI_REQUIRED=0
# available for local/test environments, but never advertise this installer
# as complete without an explicit production readiness gate.
if ! grep -q '^SKALD_AI_REQUIRED=1[[:space:]]*$' "${ENV_FILE}"; then
  echo "[ERROR] ${ENV_FILE} must set SKALD_AI_REQUIRED=1 for Orange Pi installation."
  echo "Edit the file, set the Zen API key, and rerun the installer."
  exit 1
fi

# Production containment policy for the opencode_run transport (verdict from
# the tested env-policy helper). Fails before units, scripts, agent or
# service state are touched; the build/test/data-dir/sudoers prep above
# already ran but serves no traffic.
if [ -f "${ENV_FILE}" ]; then
  if ENV_POLICY_OUT=$("${NODE_BIN_DIR}/node" --import tsx "${SKALD_CODE}/packages/cli/deploy/env-policy.ts" "${ENV_FILE}"); then
    echo "[OK] ${ENV_POLICY_OUT}"
  else
    echo "[ERROR] ${ENV_POLICY_OUT:-Containment env policy failed}"
    exit 1
  fi
fi

# 8. Helper scripts first
echo "Installing helper scripts..."
for script in update-orange-pi.sh backup-skald.sh restore-skald.sh skald-healthcheck.sh; do
  sudo cp "${SKALD_CODE}/packages/cli/deploy/${script}" "/usr/local/bin/${script}"
  sudo chmod +x "/usr/local/bin/${script}"
done
echo "[OK] Scripts installed."

# 8b. Pinned narrative agent manifest (fail-closed containment). The
# opencode_run transport only ever runs this tools-denied agent; without a
# verified manifest the installation cannot be accepted.
AGENT_SRC="${SKALD_CODE}/packages/cli/deploy/opencode-narrative-agent.md"
AGENT_DIR="${SKALD_HOME}/.config/opencode/agents"
AGENT_DST="${AGENT_DIR}/narrative.md"
test -f "${AGENT_SRC}" || { echo "ERROR: agent manifest missing: ${AGENT_SRC}"; exit 1; }
mkdir -p "${AGENT_DIR}"
cp "${AGENT_SRC}" "${AGENT_DST}"
chmod 600 "${AGENT_DST}"
AGENT_SRC_HASH=$(sha256sum "${AGENT_SRC}" | cut -d ' ' -f 1)
AGENT_DST_HASH=$(sha256sum "${AGENT_DST}" | cut -d ' ' -f 1)
AGENT_OWNER=$(stat -c %U "${AGENT_DST}")
AGENT_PERMS=$(stat -c %a "${AGENT_DST}")
if [ "${AGENT_SRC_HASH}" != "${AGENT_DST_HASH}" ] || [ "${AGENT_OWNER}" != "${SKALD_USER}" ] || [ "${AGENT_PERMS}" != "600" ]; then
  echo "ERROR: agent manifest verification failed (hash/owner/permissions). Transport stays disabled."
  rm -f "${AGENT_DST}"
  exit 1
fi
echo "[OK] Narrative agent manifest installed and verified."

# 9. systemd units
echo "Installing systemd units..."
sudo cp "${SKALD_CODE}/packages/cli/deploy/skald.service" /etc/systemd/system/skald.service
for unit in skald-backup.service skald-backup.timer skald-healthcheck.service skald-healthcheck.timer; do
  sudo cp "${SKALD_CODE}/packages/cli/deploy/${unit}" "/etc/systemd/system/${unit}"
done
sudo systemctl daemon-reload
echo "[OK] Units installed."

# 10. Start server and wait for health
sudo systemctl enable skald.service
sudo systemctl start skald.service
echo "Waiting for server to become healthy..."
for i in $(seq 1 30); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3000/api/health > /dev/null 2>&1; then
    echo "[OK] Server is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Server did not become healthy. Check: journalctl -u skald.service -n 50"
    exit 1
  fi
  sleep 2
done

# 11. Enable timers (only after server confirmed healthy)
sudo systemctl enable --now skald-healthcheck.timer
sudo systemctl enable --now skald-backup.timer
echo "[OK] Timers enabled."

# 12. Production acceptance requires a live AI readiness probe. Accepted
# posture (ADR-0036 amendments 2026-09-12): `(ready|degraded) AND playable`.
# The verdict comes from the tested ai-acceptance helper reading the
# sanitized body (the endpoint still answers HTTP 200 only for `ready`).
echo "Checking AI readiness (loopback probe)..."
# Worst-case probe is two sequential 25s route budgets plus overhead, so the
# curl budget must clear ~55s or a slow-but-healthy probe fails the gate.
AI_RESPONSE=$(curl --silent --show-error --max-time 60 -X POST -H "Content-Type: application/json" -d '{}' -w $'\n%{http_code}' http://127.0.0.1:3000/api/ops/ai-probe 2>&1 || true)
AI_HTTP_STATUS="${AI_RESPONSE##*$'\n'}"
AI_BODY="${AI_RESPONSE%$'\n'*}"
if AI_GATE_OUT=$(printf '%s' "${AI_BODY}" | node --import tsx "${SKALD_CODE}/packages/cli/deploy/ai-acceptance.ts"); then
  echo "[OK] ${AI_GATE_OUT}"
else
  echo "[OK] Simulation is healthy"
  echo "[ERROR] ${AI_GATE_OUT:-AI readiness gate failed} (HTTP ${AI_HTTP_STATUS})"
  echo "Deployment acceptance: FAILED"
  echo "Sanitized readiness report: ${AI_BODY}"
  exit 1
fi

echo ""
echo "=== Installation complete ==="
echo "curl http://127.0.0.1:3000/api/health"
echo "LAN: http://$(hostname -I | awk '{print $1}'):3000"
echo "Logs: journalctl -u skald.service -f"
echo "Update: /usr/local/bin/update-orange-pi.sh"
echo "Backup: /usr/local/bin/backup-skald.sh"
echo Restore: sudo /usr/local/bin/restore-skald.sh BACKUP_FILE
