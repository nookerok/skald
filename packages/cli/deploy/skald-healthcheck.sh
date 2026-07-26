#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="http://127.0.0.1:3000/api/health"
SERVICE="skald.service"

# Check health endpoint
HTTP_CODE=""
if ! HTTP_CODE=$(curl --silent --show-error --max-time 5 -o /dev/null -w "%{http_code}" "${HEALTH_URL}" 2>/dev/null); then
  HTTP_CODE="000"
fi
HTTP_CODE="${HTTP_CODE//[!0-9]/}"

if [ "${HTTP_CODE}" = "200" ]; then
  echo "[OK] Health check passed."
  exit 0
fi

echo "[WARN] Health check failed (HTTP ${HTTP_CODE}). Restarting ${SERVICE}..."
journalctl -u "${SERVICE}" -n 20 --no-pager || true
systemctl restart "${SERVICE}"
echo "[OK] Restart issued."
