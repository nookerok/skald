#!/usr/bin/env bash
set -euo pipefail

SKALD_CODE="/home/nooker/skald"
SKALD_DATA="/home/nooker/skald-data"
SYSTEMD_DIR="/etc/systemd/system"

if [ "$(id -u)" -eq 0 ] || [ "$(id -un)" != "nooker" ]; then
  echo "ERROR: Run this targeted installer as nooker, without external sudo."
  exit 1
fi

cd "${SKALD_CODE}"
if [ "$(git rev-parse --show-toplevel)" != "${SKALD_CODE}" ] || [ "$(git branch --show-current)" != "main" ]; then
  echo "ERROR: expected the deployed main checkout at ${SKALD_CODE}."
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: deployed checkout is not clean."
  git status --short
  exit 1
fi
if ! systemctl is-active --quiet skald.service; then
  echo "ERROR: skald.service is not active; refusing unit installation."
  exit 1
fi
for unit in skald-ai-discovery.service skald-ai-discovery.timer; do
  if [ ! -s "packages/cli/deploy/${unit}" ]; then
    echo "ERROR: missing deployed unit source: packages/cli/deploy/${unit}"
    exit 1
  fi
done

NODE_BINARY="/home/nooker/.nvm/versions/node/v22.23.1/bin/node"
if [ ! -x "${NODE_BINARY}" ] || [ "$("${NODE_BINARY}" --version)" != "v22.23.1" ]; then
  echo "ERROR: expected Node v22.23.1 at ${NODE_BINARY}."
  exit 1
fi

echo "Installing only the bounded AI-discovery units; skald.service is not restarted."
sudo install -d -o nooker -g nooker -m 700 "${SKALD_DATA}/ai-discovery"
for unit in skald-ai-discovery.service skald-ai-discovery.timer; do
  sudo install -o root -g root -m 644 "packages/cli/deploy/${unit}" "${SYSTEMD_DIR}/${unit}"
done
sudo systemctl daemon-reload
sudo systemctl enable --now skald-ai-discovery.timer

ENABLED=$(systemctl is-enabled skald-ai-discovery.timer)
ACTIVE=$(systemctl is-active skald-ai-discovery.timer)
if [ "${ENABLED}" != "enabled" ] || [ "${ACTIVE}" != "active" ]; then
  echo "ERROR: AI-discovery timer is not enabled and active (enabled=${ENABLED}, active=${ACTIVE})."
  exit 1
fi

echo "[OK] AI-discovery timer enabled and active; game service was not restarted."
systemctl list-timers --all skald-ai-discovery.timer --no-pager
