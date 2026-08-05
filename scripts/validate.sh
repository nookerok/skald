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

echo "[validate] node: $(node --version)"
echo "[validate] npm:  $(npm --version)"
echo "[validate] shell syntax"
bash -n scripts/validate.sh packages/cli/deploy/*.sh
echo "[validate] typecheck"
npm run typecheck
echo "[validate] tests"
npm test -- --run
echo "[validate] canon"
npm run canon:validate
echo "[validate] simulation"
npm run simulation:validate
echo "[validate] diff check"
git diff --check
echo "[validate] PASS"
