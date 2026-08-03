#!/bin/bash
# Benchmark Orange Pi — ADR-0020
# Runs replay, DTO size, latency and memory benchmarks on the target device.
# Does NOT modify production database or gameplay state.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="/home/nooker/skald"
DATA_DIR="/home/nooker/skald-data"
RESULTS_DIR="/tmp/skald-benchmark-results"
BENCHMARK_PORT=3101
PROD_PORT=3000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[BENCH]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

# Preflight checks
preflight() {
  log "Preflight checks..."
  if [ "$(whoami)" != "nooker" ]; then
    fail "Must run as nooker, got $(whoami)"
    exit 1
  fi
  if ! systemctl is-active --quiet skald.service; then
    fail "skald.service is not active"
    exit 1
  fi
  if ! curl -sf "http://127.0.0.1:${PROD_PORT}/api/health" > /dev/null 2>&1; then
    fail "Production health check failed"
    exit 1
  fi
  COMMIT=$(git -C "$REPO_DIR" rev-parse HEAD)
  log "Commit: $COMMIT"
  log "Node: $(node --version)"
  log "Production service: active on port $PROD_PORT"
}

# Collect environment info
collect_environment() {
  log "Collecting environment info..."
  mkdir -p "$RESULTS_DIR/$COMMIT"
  cat > "$RESULTS_DIR/$COMMIT/environment.json" <<EOF
{
  "commit": "$COMMIT",
  "hostname": "$(hostname)",
  "nodeVersion": "$(node --version)",
  "npmVersion": "$(npm --version 2>/dev/null || echo 'unknown')",
  "dbEvents": $(sqlite3 "$DATA_DIR/events.sqlite" "SELECT COUNT(*) FROM events" 2>/dev/null || echo 0),
  "dbBytes": $(stat -c%s "$DATA_DIR/events.sqlite" 2>/dev/null || echo 0),
  "worldCount": $(sqlite3 "$DATA_DIR/events.sqlite" "SELECT COUNT(DISTINCT world_id) FROM events" 2>/dev/null || echo 1),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  log "Environment saved to $RESULTS_DIR/$COMMIT/environment.json"
}

# Replay benchmark
run_replay_benchmark() {
  log "Running replay benchmark..."
  cd "$REPO_DIR"

  # Run the TypeScript benchmark
  npx tsx packages/cli/src/benchmark/replay-benchmark.ts \
    --db "$DATA_DIR/events.sqlite" \
    --runs 10 \
    --warmup 3 \
    > "$RESULTS_DIR/$COMMIT/replay.json" 2>&1 || true

  log "Replay benchmark complete"
}

# DTO size benchmark
run_dto_benchmark() {
  log "Running DTO size benchmark..."
  cd "$REPO_DIR"

  npx tsx packages/cli/src/benchmark/dto-size-benchmark.ts \
    --base-url "http://127.0.0.1:${PROD_PORT}" \
    --world-id "latest" \
    > "$RESULTS_DIR/$COMMIT/dto-size.json" 2>&1 || true

  log "DTO size benchmark complete"
}

# Latency benchmark
run_latency_benchmark() {
  log "Running latency benchmark..."
  cd "$REPO_DIR"

  npx tsx packages/cli/src/benchmark/latency-benchmark.ts \
    --base-url "http://127.0.0.1:${PROD_PORT}" \
    --world-id "latest" \
    --cold-runs 10 \
    --warm-runs 100 \
    > "$RESULTS_DIR/$COMMIT/latency.json" 2>&1 || true

  log "Latency benchmark complete"
}

# Memory snapshot
run_memory_benchmark() {
  log "Collecting memory metrics..."
  PID=$(pgrep -f "skald" | head -1)
  if [ -n "$PID" ]; then
    ps -o pid,rss,vsz,etime,cmd -p "$PID" > "$RESULTS_DIR/$COMMIT/memory.txt" 2>&1 || true
    log "Memory snapshot saved"
  else
    warn "No skald process found"
  fi
}

# Generate report
generate_report() {
  log "Generating report..."
  cd "$REPO_DIR"

  npx tsx packages/cli/src/benchmark/report.ts \
    --results-dir "$RESULTS_DIR/$COMMIT" \
    > "$RESULTS_DIR/$COMMIT/report.md" 2>&1 || true

  log "Report saved to $RESULTS_DIR/$COMMIT/report.md"
}

# Summary
print_summary() {
  echo ""
  echo "========================================="
  echo "  Benchmark Complete: $COMMIT"
  echo "========================================="
  echo ""
  echo "Results: $RESULTS_DIR/$COMMIT/"
  echo ""
  ls -la "$RESULTS_DIR/$COMMIT/" 2>/dev/null || true
  echo ""
}

# Main
main() {
  preflight
  collect_environment
  run_replay_benchmark
  run_dto_benchmark
  run_latency_benchmark
  run_memory_benchmark
  generate_report
  print_summary
}

main "$@"
