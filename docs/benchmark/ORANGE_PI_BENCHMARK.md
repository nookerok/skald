# Orange Pi Benchmark Report Template

This document defines the benchmark methodology and report format.
Actual results are stored outside Git at `/tmp/skald-benchmark-results/`.

## Methodology

### Environment Collection

Before each benchmark run, collect:
- Git commit SHA
- Hostname
- Node.js version
- SQLite DB size and event count
- World count
- Timestamp

### Replay Benchmark

10 cold starts + 30 warm starts on isolated DB copy.
Measures: dbOpenMs, eventLoadMs, worldReplayMs, spatialReplayMs, observerIndexMs, readinessMs.
Validates: digest equality (world state, spatial projection, river/crossing state, observer map).

### DTO Size Benchmark

Measures raw JSON, gzip, and brotli sizes for all read endpoints.
Scans for forbidden fields (eventId, causationId, tiles, cells, etc.).
Checks that glimpsed landmarks don't expose exact coordinates.

### Latency Benchmark

10 cold + 100 warm requests per endpoint.
Reports min, p50, p95, p99, max, error rate.
Separates network time, server time, and JSON parse time.

### Memory Benchmark

RSS snapshots after: startup, replay, 100 map reads, 100 command cycles.
Checks for unbounded cache growth, DTO accumulation, request leaks.

### Browser QA

Executed through fixed NTFS task.
Desktop (1440×900) and mobile (390×844) viewports.
Checks: map render, no hidden geometry, legend, list fallback, a11y, no console errors.

## Report Format

```
Commit: <sha>
Device: <hostname>
Node: <version>
DB events: <count>
DB size: <MiB>

Replay:
  cold p50: <ms>  cold p95: <ms>
  warm p95: <ms>
  RSS peak: <MiB>
  digest equality: PASS/FAIL

DTO:
  /map raw: <KiB>  gzip: <KiB>
  forbidden fields: <count>
  size budget: PASS/FAIL

Latency:
  /map cold p95: <ms>  warm p95: <ms>
  /state p95: <ms>
  command p95: <ms>

Memory:
  RSS after startup: <MiB>
  RSS after 100 commands: <MiB>
  growth: <MiB>

Browser:
  desktop: PASS/FAIL/BLOCKED
  mobile: PASS/FAIL/BLOCKED

Overall: PASS/FAIL
```

## PASS/FAIL Rules

### PASS
- replay < 10s
- digest matches
- DTO privacy gate = 0 leaks
- /map latency in budget
- RSS < 256 MiB
- no error rate
- services active
- browser QA independently confirmed

### FAIL
- replay changes state
- DTO leaks hidden geometry
- p95 exceeds budget
- memory grows on long run
- command creates extra events
- production DB modified
- browser shows internal IDs

### BLOCKED
- NTFS task unavailable
- CDP screenshot broken
- viewport override blocked
- network filter blocks API
