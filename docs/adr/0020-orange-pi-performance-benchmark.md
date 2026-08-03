# ADR 0020: Orange Pi Performance Benchmark

Status: accepted

## Context

The Skald server runs on an Orange Pi with limited resources (ARM, ~1GB RAM).
Performance regressions can silently degrade the player experience. Currently
there is no systematic way to measure replay time, DTO sizes, API latency or
memory usage on the target device.

Observable gaps:
- No cold/warm replay measurements.
- No DTO size budget enforcement.
- No API latency tracking across deployments.
- No memory leak detection for long-running processes.
- Browser QA is manual and ad-hoc.

## Decision

Create a benchmark framework that measures four independent layers without
modifying gameplay Rules, Event Log or production database state.

### 1. Operational tooling

Benchmark is operational, not a game Rule or Domain Event. It uses
`performance.now()` for measurements and never writes to the canonical
Event Log.

### 2. Isolated benchmark DB

State-changing benchmarks (command path) run against a copy of the production
database at `/tmp/skald-benchmark/<commit>/events.sqlite`. Production service
stays on `127.0.0.1:3000`; benchmark server runs on `127.0.0.1:3101`.

### 3. Four measurement layers

| Layer | What | Budget |
|-------|------|--------|
| Replay | Cold/warm startup, event count, replay equality | < 10s |
| DTO Size | Raw/gzip/brotli, forbidden field scan | < 250 KiB |
| Latency | Read endpoints, command path, p50/p95/p99 | /map < 250ms |
| Memory | RSS after operations, long-run growth | < 256 MiB |

### 4. Forbidden field gate

Automatically scan DTOs for leaked internal state:
`eventId`, `causationId`, `tiles`, `cells`, `activeSituations`, `fullRegion`,
exact `glimpsed` coordinates.

### 5. Report template

Standardized report format stored in `docs/benchmark/ORANGE_PI_BENCHMARK.md`.
Actual results stored outside Git at `/tmp/skald-benchmark-results/`.

### 6. Browser QA

Executed through the fixed NTFS task, never from the repository task.
Desktop and mobile viewports tested separately.

## Consequences

- **New files**: `packages/cli/src/benchmark/` (5 modules), `scripts/benchmark-orange-pi.sh`, `docs/benchmark/ORANGE_PI_BENCHMARK.md`.
- **No new packages**: benchmark code lives inside `packages/cli/`.
- **No production changes**: benchmark never modifies the production database.
- **Deterministic**: same commit + same DB = same results.

## Definition of Done

One reproducible report exists for a specific commit showing replay < 10s,
DTO privacy gate = 0 leaks, /map latency in budget, RSS < 256 MiB, and
browser QA PASS/FAIL/BLOCKED independently recorded.
