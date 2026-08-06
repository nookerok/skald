# Skald Eval & Simulation Quality System

A deterministic, LLM-runnable conformance and quality surface for the
living-world simulation. Any agent with repo access can run scenarios, read
exactly what a player would see, measure the world's quality with numbers, and
improve the interface from transcripts and consensus signals.

## Commands

```bash
npm run eval                          # pass/fail gate (part of npm run validate)
npm run eval:report                   # write eval-out/report.json + report.html
npm run eval:living                   # Simulation Health Report + Rule Dependency Graph
npm run eval -- --tags                # per-tag scenario coverage
npm run eval -- --json X --html Y     # custom report paths

# CI gate: every PR must prove the world got no worse
npm run eval:compare -- <base.json> <new.json>        # exit 1 on regression

# Transcript Benchmark API
node --import tsx packages/cli/src/eval/run-scenario.ts <scenario.json> --transcript-json
node --import tsx packages/cli/src/eval/benchmark/run-benchmark.ts answers.json
```

## Living World Metrics

`npm run eval:living` runs a long deterministic offline probe on the living
region and prints the engine dashboard (also `eval-out/health.json` +
`eval-out/rule-graph.json`):

```
Livingness: 17   Emergence: 6   Rule reachability: 21 (13/34)
Narrative diversity: 26   Knowledge growth: 10   Idle simulation: 29%
Avg chain depth: 1.6   Dead rules: 21
```

- **Emergence**: causal chains (root-to-leaf causation paths), cross-system
  chains (≥3 distinct event types on one path), average chain depth.
- **Diversity**: distinct event types fired vs registered.
- **Rule reachability**: registered rules that actually fired.
- **Dead / Dormant**: a rule that never fired is `dead` (its trigger event type
  never occurs) or `dormant` (the trigger occurs but the value precondition is
  unmet) — the report finds unreachable systems automatically, e.g. the fire
  loop. Fired rules are `rare` / `common` / `critical` by scenario breadth.

Which metrics are merge-blocking vs informational is defined in
`docs/adr/0022-simulation-evaluation-framework.md`.

## Simulation Quality Report

`npm run eval:report` produces a deterministic report pinned to the current
commit:

```
commit:            a59f8b4…
scenarioPass:      100%
determinism:       100%      two independent runs commit byte-identical logs
purity:            100%      replaying the Event Log rebuilds the same world
presentation:      100%      no raw internal keys in player text
knowledge honesty: 100%      no internal truth state in player DTOs
rule coverage:     38% (13/34)
unused rules:      checks.outcome, consequences.fire, …
```

Compare between commits:

```
npm run eval:compare -- eval-out/report.json <new report>
  ruleCoverageRate  38.2% -> 35.0%  (-3.2%)
  Rules that stopped firing: consequences.fire, situations.start, …
COMPARE FAIL: regressed -> ruleCoverageRate
```

## Rule Coverage Report

Every registered rule is listed with how many scenarios fired it and how many
times. A rule that never fires is either dead code or a missing scenario —
both are valuable findings. The report is in `eval-out/report.json` under
`ruleCoverage`.

## Transcript Benchmark API

`run-scenario.ts --transcript-json` emits the observer-scoped player view of a
scenario (presentation, state, belief, game shell, observer map per turn).
Give that same artifact to several models and ask `benchmark/instructions.md`
questions; each model answers `benchmark/answer.schema.json`. Then:

```bash
node --import tsx packages/cli/src/eval/benchmark/run-benchmark.ts answers.json
```

An issue is **CONSENSUS** when two or more models independently report it — a
strong signal of a real interface problem. Single-model findings stay in
`divergent`. The consensus comparison is deterministic; model calls themselves
stay outside the repository (no external services, no nondeterminism).

## Scenario format (extensible library)

```jsonc
{
  "name": "my-scenario",
  "worldTemplate": "legacy",          // legacy | old_tower | crossroads | living_region
  "description": "what this proves",
  "tags": ["weather", "belief", "relations"],   // domain tags for navigation + per-tag coverage
  "meta": { "domain": "belief", "difficulty": "feature", "goal": "…" },
  "turns": [
    { "input": "examine old cart" },  // one player command (command + tick)
    { "wait": 3 },                    // N offline ticks
    { "assert": { "checks": [ { "kind": "eventTypeSeen", "type": "EntityExamined" } ] } }
  ],
  "finalChecks": [ { "kind": "worldTime", "value": 4 } ]
}
```

### Check vocabulary

| kind | fields | meaning |
|---|---|---|
| `eventTypeSeen` / `eventTypeSeenSinceLast` / `eventTypeAbsent` | `type` | event occurrence |
| `worldTime` | `value` | world time equals value |
| `playerAt` | `x, y` | player grid position |
| `observationAtLeast` | `key, value` | observation counter threshold |
| `consequenceActive` | — | at least one active consequence |
| `situationActive` | `situationId` | a situation is running |
| `presentationContains` | `text` | player-facing text contains substring |
| `beliefCountMin` | `value` | belief DTO `beliefs` length |
| `observerMapPresent` / `observerMapHasLocations` | `value` | observer map served |
| `relationValueAtLeast` | `from, to, relationKind, value` | relation edge strength |

## Invariant audit (always runs)

- **Purity**: replaying the Event Log rebuilds the identical world.
- **worldTime monotonic**: every action advances time by exactly one tick.
- **Idempotency**: replaying a completed command key creates no new events.
- **No truth leak**: player DTOs never contain internal projection keys.
- **Presentation honesty**: player text never exposes raw internal keys.

## Improve the interface

`--transcript` (compact) and `--transcript-json` (full) show exactly what the
browser renders. Run them, read the wording, improve
`packages/world/src/presentation/templates.ts` and `narrative.ts`, re-run
`npm run eval`, and lock the improvement into a scenario assertion. The AI
Benchmark consensus turns subjective impressions into a ranked list of real
interface problems.

## Boundary

The harness drives scripted player intent. It never lets an LLM decide player
actions at runtime (AGENTS #4-6). LLM-authored scenarios and code changes are
design-time work, validated by the deterministic core; nothing here adds
nondeterminism or external service calls to the runtime.
