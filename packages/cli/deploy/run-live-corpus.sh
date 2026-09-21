#!/usr/bin/env bash
#
# Run the live interpretation corpus with the SAME provider environment as
# skald.service, without printing any secret values.
#
# The service reads its keys through systemd EnvironmentFile
# (/home/nooker/skald-data/skald.env). A plain SSH login shell does NOT have
# those variables, so running the corpus directly over SSH would score the
# deterministic fallback instead of the provider. This wrapper sources the
# same file into the current shell (no echo, no xtrace) and runs the runner.
#
# Run as the deployment user (never with external sudo):
#   packages/cli/deploy/run-live-corpus.sh
#
# Output is the sanitized scorecard only; key names/values are never printed.

set -euo pipefail

ENV_FILE="${SKALD_DATA:-/home/nooker/skald-data}/skald.env"
CODE_DIR="${SKALD_CODE:-/home/nooker/skald}"

if [ ! -r "${ENV_FILE}" ]; then
  echo "[ERROR] provider env file not readable: ${ENV_FILE}" >&2
  exit 1
fi

# Never trace; source the service env so the router sees the same providers.
set +x
set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

cd "${CODE_DIR}"
exec npm run acceptance:interpretation:corpus
