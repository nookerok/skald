#!/usr/bin/env bash
#
# Run the live interpretation corpus with the SAME provider environment as
# skald.service, without printing any secret values.
#
# The service reads its keys through systemd EnvironmentFile
# (/home/nooker/skald-data/skald.env). A plain SSH login shell does NOT have
# those variables, so running the corpus directly over SSH would score the
# deterministic fallback instead of the provider.
#
# This wrapper does NOT source the file as a shell script: systemd's
# EnvironmentFile rules differ from Bash (see packages/cli/deploy/env-policy.ts).
# It passes the path via SKALD_ENV_FILE and the runner parses it with the
# project's systemd-subset parser, adding the keys as data. Values are never
# printed.
#
# It also pins the Node runtime and PATH the way the deploy scripts do, so the
# runner starts without an interactive shell.
#
# Run as the deployment user (never with external sudo):
#   packages/cli/deploy/run-live-corpus.sh

set -euo pipefail

ENV_FILE="${SKALD_DATA:-/home/nooker/skald-data}/skald.env"
CODE_DIR="${SKALD_CODE:-/home/nooker/skald}"
NODE_BIN="${SKALD_NODE_BIN:-/home/nooker/.nvm/versions/node/v22.23.1/bin/node}"

if [ ! -r "${ENV_FILE}" ]; then
  echo "[ERROR] provider env file not readable: ${ENV_FILE}" >&2
  exit 1
fi

export PATH="$(dirname "${NODE_BIN}"):/usr/local/bin:/usr/bin:/bin:${PATH:-}"

cd "${CODE_DIR}"
SKALD_ENV_FILE="${ENV_FILE}" exec "${NODE_BIN}" --import tsx packages/cli/src/acceptance/run-interpretation-corpus.ts
