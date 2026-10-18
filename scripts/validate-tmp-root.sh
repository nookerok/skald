#!/usr/bin/env bash
# Per-run temp ownership for scripts/validate.sh (sourced, not executed).
#
# Every validation run gets a PRIVATE temp root and exports TMPDIR to it, so
# every mkdtempSync(tmpdir()) scratch dir of this run lives inside that root.
# The EXIT trap removes ONLY this run's root — it can never touch another
# concurrent run's dirs. This replaces the old `--ttl-minutes=0` sweep of the
# shared base tmp, which let one validate run delete another run's ACTIVE
# SQLite files (the cross-run flake root cause).
#
# LIVENESS: the root carries `.owner` with the owning shell PID. Any hygiene
# sweep MUST skip a managed dir whose owner is still alive, regardless of age —
# TTL alone would still let a long or hung run be deleted mid-flight.
#
# Usage (from validate.sh, after the base headroom/hygiene step):
#   . scripts/validate-tmp-root.sh
#   skald_validate_tmp_init
#
# The helper preserves the shell's exit code: the trap records `$?` first,
# removes the owned root, then re-exits with the original status.

skald_validate_tmp_init() {
  local base="${TMPDIR:-/tmp}"
  # mktemp under the BASE tmp: our own namespaced, unique directory.
  SKALD_VALIDATE_TMP_ROOT="$(mktemp -d "${base%/}/skald-validate-run-XXXXXX")" || {
    echo "[validate] cannot create private temp root under ${base}" >&2
    return 1
  }
  # Children (npm → vitest → tests → mkdtempSync(tmpdir())) inherit this.
  export TMPDIR="$SKALD_VALIDATE_TMP_ROOT"
  # Ownership marker: `pid=<shell pid>` — liveness beats TTL in every sweep.
  printf 'pid=%s\n' "$$" > "$SKALD_VALIDATE_TMP_ROOT/.owner"
  # Replace any previous EXIT trap: cleanup must be ownership-scoped.
  trap 'skald_code=$?; rm -rf "$SKALD_VALIDATE_TMP_ROOT"; exit "$skald_code"' EXIT
}