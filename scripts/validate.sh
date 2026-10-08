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

# Always clean managed scratch dirs on exit — success OR failure — and preserve
# the original exit code, so a failed step cannot leave the tmpfs filling up.
tmp_cleanup() {
  local code=$?
  node scripts/tmp-hygiene.mjs --root="${TMPDIR:-/tmp}" --prefix=skald- --ttl-minutes=0 --min-free-mb=200 >/dev/null 2>&1 || true
  exit "$code"
}
trap tmp_cleanup EXIT

echo "[validate] node: $(node --version)"
echo "[validate] npm:  $(npm --version)"
echo "[validate] shell syntax"
bash -n scripts/validate.sh packages/cli/deploy/*.sh
# This only verifies that the read-only smoke harness is callable. A real
# browser/production run needs the fixed NTFS task and is reported separately.
echo "[validate] browser smoke harness (not browser QA)"
npm run browser:smoke -- --help >/dev/null
echo "[validate] typecheck"
npm run typecheck
# Managed temp hygiene: clean stale skald-* scratch dirs and fail early if the
# temp root is still too full (a full tmpfs breaks the suite with ENOSPC).
echo "[validate] temp hygiene"
node scripts/tmp-hygiene.mjs --root="${TMPDIR:-/tmp}" --prefix=skald- --ttl-minutes=120 --min-free-mb=200
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
