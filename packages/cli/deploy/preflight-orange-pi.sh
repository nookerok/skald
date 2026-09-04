#!/usr/bin/env bash
set -euo pipefail

# This is a local, read-only gate. It deliberately does not discover or
# replace the production target when HTTP and SSH disagree.
SKALD_HOST="192.168.0.5"
SKALD_USER="nooker"
SKALD_SSH_KEY="/home/nook/.ssh/id_ed25519_skald"
SKALD_CODE="/home/nooker/skald"
SKALD_DATA="/home/nooker/skald-data"
SKALD_SERVICE="skald.service"
HEALTH_URL="http://${SKALD_HOST}:3000/api/health"
SSH_ATTEMPTS=5

# This command is intentionally the canonical identity preflight. Do not
# replace it with a discovered user, path or endpoint.
SSH_PREFLIGHT_COMMAND='hostname; whoami; uname -a; test -d /home/nooker/skald; test -d /home/nooker/skald-data; systemctl is-active skald.service'

echo "=== Skald Orange Pi preflight ==="
echo "Target: ${SKALD_USER}@${SKALD_HOST}"

# HTTP liveness and SSH identity are intentionally independent checks. A
# healthy HTTP response never proves which machine owns the SSH endpoint.
if HTTP_STATUS="$(curl --silent --show-error --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}' "${HEALTH_URL}" 2>/dev/null)"; then
  :
else
  HTTP_STATUS="000"
fi

check_remote_path() {
  local path="$1"
  if ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=1 -i "${SKALD_SSH_KEY}" "${SKALD_USER}@${SKALD_HOST}" "test -d ${path}" >/dev/null 2>&1; then
    echo present
  else
    echo absent
  fi
}

SSH_IDENTITY_MISMATCH=0
SSH_IDENTITY_UNVERIFIED=0
SSH_REACHABLE_COUNT=0
SSH_UNREACHABLE_COUNT=0
REMOTE_HOSTNAME=""
REMOTE_USER=""
REMOTE_UNAME=""
REMOTE_REPOSITORY=""
REMOTE_DATA=""
REMOTE_SERVICE=""
MISMATCH_HOSTNAME=""
MISMATCH_USER=""
MISMATCH_UNAME=""
MISMATCH_REPOSITORY=""
MISMATCH_DATA=""
MISMATCH_SERVICE=""

# Two sessions are intentional: a port-forward/NAT that alternates between
# hosts must never pass because one lucky SSH connection reached the Pi.
for attempt in 1 2 3 4 5; do
  SSH_REPORT=""
  SSH_EXIT=0
  SSH_REPORT="$(ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=1 -i "${SKALD_SSH_KEY}" "${SKALD_USER}@${SKALD_HOST}" "${SSH_PREFLIGHT_COMMAND}" 2>/dev/null)" || SSH_EXIT=$?
  if [[ -z "${SSH_REPORT}" ]]; then
    SSH_UNREACHABLE_COUNT=$((SSH_UNREACHABLE_COUNT + 1))
    SSH_IDENTITY_UNVERIFIED=1
    continue
  fi

  SSH_REACHABLE_COUNT=$((SSH_REACHABLE_COUNT + 1))
  mapfile -t SSH_LINES <<< "${SSH_REPORT}"
  OBSERVED_HOSTNAME="${SSH_LINES[0]:-}"
  OBSERVED_USER="${SSH_LINES[1]:-}"
  OBSERVED_UNAME="${SSH_LINES[2]:-}"
  OBSERVED_SERVICE="${SSH_LINES[3]:-}"
  OBSERVED_REPOSITORY="$(check_remote_path "${SKALD_CODE}")"
  OBSERVED_DATA="$(check_remote_path "${SKALD_DATA}")"

  REMOTE_HOSTNAME="${OBSERVED_HOSTNAME}"
  REMOTE_USER="${OBSERVED_USER}"
  REMOTE_UNAME="${OBSERVED_UNAME}"
  REMOTE_REPOSITORY="${OBSERVED_REPOSITORY}"
  REMOTE_DATA="${OBSERVED_DATA}"
  REMOTE_SERVICE="${OBSERVED_SERVICE}"
  if [[ "${OBSERVED_USER}" != "${SKALD_USER}" || "${OBSERVED_UNAME}" != *aarch64* || "${OBSERVED_REPOSITORY}" != "present" || "${OBSERVED_DATA}" != "present" || "${OBSERVED_SERVICE}" != "active" ]]; then
    SSH_IDENTITY_MISMATCH=1
    if [[ -z "${MISMATCH_USER}" ]]; then
      MISMATCH_HOSTNAME="${OBSERVED_HOSTNAME}"
      MISMATCH_USER="${OBSERVED_USER}"
      MISMATCH_UNAME="${OBSERVED_UNAME}"
      MISMATCH_REPOSITORY="${OBSERVED_REPOSITORY}"
      MISMATCH_DATA="${OBSERVED_DATA}"
      MISMATCH_SERVICE="${OBSERVED_SERVICE}"
    fi
  fi
done

if [[ "${SSH_IDENTITY_MISMATCH}" -eq 1 ]]; then
  IDENTITY_STATE="mismatch"
elif [[ "${SSH_IDENTITY_UNVERIFIED}" -eq 1 ]]; then
  IDENTITY_STATE="unverified"
else
  IDENTITY_STATE="match"
fi
if [[ "${SSH_UNREACHABLE_COUNT}" -gt 0 && "${SSH_REACHABLE_COUNT}" -gt 0 ]]; then
  SSH_TRANSPORT="partial"
elif [[ "${SSH_UNREACHABLE_COUNT}" -gt 0 ]]; then
  SSH_TRANSPORT="unreachable"
else
  SSH_TRANSPORT="reachable"
fi

if [[ "${IDENTITY_STATE}" == "mismatch" ]]; then
  REMOTE_HOSTNAME="${MISMATCH_HOSTNAME}"
  REMOTE_USER="${MISMATCH_USER}"
  REMOTE_UNAME="${MISMATCH_UNAME}"
  REMOTE_REPOSITORY="${MISMATCH_REPOSITORY}"
  REMOTE_DATA="${MISMATCH_DATA}"
  REMOTE_SERVICE="${MISMATCH_SERVICE}"
fi

if [[ "${HTTP_STATUS}" == "200" && "${IDENTITY_STATE}" == "mismatch" ]]; then
  PREFLIGHT_STATE="HTTP_ALIVE_SSH_IDENTITY_MISMATCH"
  PREFLIGHT_EXIT=1
elif [[ "${HTTP_STATUS}" == "200" && "${IDENTITY_STATE}" == "unverified" ]]; then
  PREFLIGHT_STATE="HTTP_ALIVE_SSH_IDENTITY_UNVERIFIED"
  PREFLIGHT_EXIT=1
elif [[ "${HTTP_STATUS}" == "200" ]]; then
  PREFLIGHT_STATE="HTTP_ALIVE_SSH_IDENTITY_MATCH"
  PREFLIGHT_EXIT=0
elif [[ "${IDENTITY_STATE}" == "mismatch" ]]; then
  PREFLIGHT_STATE="HTTP_UNAVAILABLE_SSH_IDENTITY_MISMATCH"
  PREFLIGHT_EXIT=1
elif [[ "${IDENTITY_STATE}" == "unverified" ]]; then
  PREFLIGHT_STATE="HTTP_UNAVAILABLE_SSH_IDENTITY_UNVERIFIED"
  PREFLIGHT_EXIT=1
else
  PREFLIGHT_STATE="HTTP_UNAVAILABLE_SSH_IDENTITY_MATCH"
  PREFLIGHT_EXIT=1
fi

echo "state=${PREFLIGHT_STATE}"
echo "http_status=${HTTP_STATUS}"
echo "ssh_attempts=${SSH_ATTEMPTS}"
echo "ssh_transport=${SSH_TRANSPORT}"
echo "ssh_identity=${IDENTITY_STATE}"
echo "ssh_hostname=${REMOTE_HOSTNAME:-unknown}"
echo "ssh_user=${REMOTE_USER:-unknown}"
echo "ssh_uname=${REMOTE_UNAME:-unknown}"
echo "repository=${REMOTE_REPOSITORY:-absent}"
echo "data=${REMOTE_DATA:-absent}"
echo "service=${REMOTE_SERVICE:-unknown}"

if [[ "${PREFLIGHT_EXIT}" -ne 0 ]]; then
  echo "Preflight: BLOCKED"
  echo "No commit, push, updater, restart or migration was run."
else
  echo "Preflight: PASS"
fi

exit "${PREFLIGHT_EXIT}"
