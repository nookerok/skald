#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE_BIN_DIR="${SKALD_NODE_BIN_DIR:-/home/nook/.nvm/versions/node/v22.23.1/bin}"
if [ -x "$NODE_BIN_DIR/node" ] && [ -x "$NODE_BIN_DIR/npm" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
fi
command -v node >/dev/null
command -v npm >/dev/null

# Temp ownership: NO shared-base sweep here. The old EXIT trap ran the hygiene
# CLI with --ttl-minutes=0 over the shared base tmp, so one validate run's exit
# could delete ANOTHER concurrent run's ACTIVE scratch dirs (cross-run flake
# root cause, reproduced). Cleanup is ownership-scoped instead: after the base
# headroom step below, every run gets a PRIVATE TMPDIR root and an EXIT trap
# that removes only that root (see scripts/validate-tmp-root.sh).

echo "[validate] node: $(node --version)"
echo "[validate] npm:  $(npm --version)"
echo "[validate] shell syntax"
bash -n scripts/validate.sh scripts/validate-tmp-root.sh packages/cli/deploy/*.sh
# This only verifies that the read-only smoke harness is callable. A real
# browser/production run needs the fixed NTFS task and is reported separately.
echo "[validate] browser smoke harness (not browser QA)"
npm run browser:smoke -- --help >/dev/null
echo "[validate] typecheck"
npm run typecheck
# Managed temp hygiene: clean stale skald-* scratch dirs and fail early if the
# temp root is still too full (a full tmpfs breaks the suite with ENOSPC).
# TTL-scoped only (never ttl 0): active dirs of other runs are spared; a low
# headroom after this pass is a hard error, never a forced wipe of live dirs.
echo "[validate] temp hygiene"
node scripts/tmp-hygiene.mjs --root="${TMPDIR:-/tmp}" --prefix=skald- --ttl-minutes=120 --min-free-mb=200
# Private temp root + ownership-scoped EXIT trap for everything below.
. "${ROOT_DIR}/scripts/validate-tmp-root.sh"
skald_validate_tmp_init
echo "[validate] temp root: ${TMPDIR}"
echo "[validate] tests"
npm test -- --run
echo "[validate] canon"
npm run canon:validate
echo "[validate] simulation"
npm run simulation:validate
echo "[validate] eval"
npm run eval
echo "[validate] adventure acceptance"
npm run acceptance:adventure
echo "[validate] diff check"
git diff --check
echo "[validate] PASS"
