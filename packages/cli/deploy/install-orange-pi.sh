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
  echo "[INFO] ${ENV_FILE} created. Add LLM API keys if desired."
else
  echo "[OK] ${ENV_FILE} already exists."
fi

# 8. Helper scripts first
echo "Installing helper scripts..."
for script in update-orange-pi.sh backup-skald.sh restore-skald.sh skald-healthcheck.sh; do
  sudo cp "${SKALD_CODE}/packages/cli/deploy/${script}" "/usr/local/bin/${script}"
  sudo chmod +x "/usr/local/bin/${script}"
done
echo "[OK] Scripts installed."

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

echo ""
echo "=== Installation complete ==="
echo "curl http://127.0.0.1:3000/api/health"
echo "LAN: http://$(hostname -I | awk '{print $1}'):3000"
echo "Logs: journalctl -u skald.service -f"
echo "Update: /usr/local/bin/update-orange-pi.sh"
echo "Backup: /usr/local/bin/backup-skald.sh"
echo Restore: sudo /usr/local/bin/restore-skald.sh BACKUP_FILE
