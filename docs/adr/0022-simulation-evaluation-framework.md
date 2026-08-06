# ADR 0022 — Simulation Evaluation Framework

Status: accepted

Date: 2026-08-06

## Context

SKALD's constitution guarantees determinism, Event Log authority and
observer-scoped honesty, but nothing measured whether the world is *alive and
understandable* — only whether it runs. Until now the only gate was
`npm run validate` (typecheck + unit/integration tests), which answers
"nothing is broken" but not "is the world getting better".

Development of SKALD is meant to be driven by different LLM agents over a long
horizon. Without a common, quantitative standard of simulation quality, each
agent argues from impressions: a change "feels" better or worse, rule coverage
is guessed, unreachable game loops are found by a human reading the code (as
happened with the fire loop, ADR-0017-era).

An eval harness already existed as scripts
(`packages/cli/src/eval/`, `npm run eval`): deterministic scripted scenarios
over the canonical core with an invariant audit (purity, determinism,
idempotency, no truth leak, presentation honesty). This ADR promotes that
harness from a convenient tool into an official, governed evaluation framework
with normative metrics, regression semantics and an extension contract.

## Alternatives

1. Keep only pass/fail scenario tests (status quo). Rejected: they cannot tell
   whether the world became more alive, more diverse or more reachable; no
   signal for direction of development.
2. Rely on human/LLM code review to judge quality. Rejected: subjective, not
   comparable across commits, and exactly the failure mode this ADR removes.
3. Build the evaluation system inside the game runtime (metrics emitted as
   events). Rejected: violates the Event Log authority and purity — metrics
   would become a second truth; the evaluator must stay a read-side tool that
   only ever *replays* the canonical log.
4. One monolithic "simulation score". Rejected: hides which quality regressed;
   the framework needs independently actionable metrics.

## Decision

Add an official **Simulation Evaluation Framework** (`packages/cli/src/eval/`)
with three reports, all deterministic (no timestamps, no randomness, no
external services; pinned to the current git commit):

1. **Scenario Quality Report** (`npm run eval:report`) — per-scenario
   assertions + invariant audit, aggregated into rates.
2. **Simulation Health Report** (`npm run eval:living`) — a long offline probe
   over `living_region` measuring:
   - **Emergence**: causal chains (root-to-leaf causation paths), cross-system
     chains (>=3 distinct event types on one path), average chain depth;
   - **Diversity**: distinct event types fired vs registered (`EventType`);
   - **Rule reachability**: registered rules that actually fired;
   - **Knowledge growth**: observer belief count before vs after the probe;
   - **Idle simulation**: share of churn/gate events (TickPassed, HeatRadiated,
     gate events) vs meaningful change;
   - **Dead rules**: rules that never fire, classified `dead` (trigger event
     type never occurs) or `dormant` (trigger occurs, precondition unmet).
3. **Rule Dependency Graph** (`eval-out/rule-graph.json`) — rule → event →
   rule edges from the registered composition and observed firing, with the
   dead/dormant/rare/common/critical classification.

### Normative metrics and regression semantics

A metric is **normative** when a regression blocks merge. The normative set:

- `scenarioPassRate` — every committed scenario must pass;
- `determinismRate`, `purityRate` — replay and re-run stability are
  constitutional invariants; any drop is a blocker;
- `presentationHonestRate`, `noTruthLeakRate` — observer contract; any drop is
  a blocker;
- `ruleCoverageRate` — must not decrease; a rule that stopped firing is a
  regression (dead code or a lost scenario).

The remaining Health Report metrics — `livingness`, `emergence`,
`narrativeDiversity`, `knowledgeGrowth`, `idleSimulation`,
`averageChainDepth`, `deadRules` — are **informational**: they are reported and
compared but do not block merge. They define the direction of development
(where the world is empty) instead of policing it.

`npm run eval:compare -- <base.json> <new.json>` implements the normative gate:
exit 1 when any normative metric regressed or a rule stopped firing. Wiring it
into CI makes "the world got no worse" a machine-checked PR requirement.

### Determinism and the dice infrastructure

Critical checks use the random-dice infrastructure (`rollD20`, `Math.random()`),
which lives outside Rules by constitutional exception and records its result in
the Event Log. A scenario that triggers `CriticalCheckRequested` is therefore
not reproducible across runs: the framework reports `determinism: false` for
such a scenario honestly (and never assumes it), rather than hiding the roll.
Check-triggering scenarios are excluded from the determinism claim by design.

### Extension contract

- **New scenario**: add a JSON file to `packages/cli/eval-scenarios/` with
  `tags`/`meta`; it is picked up automatically by `npm run eval`.
- **New metric**: add a pure function in `packages/cli/src/eval/`, unit-test
  it, and either make it normative (add to the compare gate and this ADR's
  normative list) or informational (report only).
- **New assertion**: extend the `Check` vocabulary in
  `packages/cli/src/eval/checks.ts`; every new check gets a unit test.
- The framework never changes game behaviour: rules are wrapped only inside a
  freshly-created registry of an evaluation run, and the evaluator only reads
  the canonical log through the standard composition roots.

## Consequences

Positive: any change can be measured ("rule coverage −3%", "presentation +5%")
instead of argued about; unreachable systems (e.g. the fire loop, whose rules
are classified `dead`) are surfaced by the report, not by a human reading code;
different LLM agents share one standard for what counts as better; the quality
reports become comparable artifacts across commits.

Negative: the Health Report's composites (`livingness`, emergence ratios) are
deliberately simple and heuristic — they are directional signals, not physics;
idle-simulation and narrative-diversity depend on the probe's scripted actions
and must be read with that context. Scenarios take time to author; a thin
library under-reports coverage, which the `dead`/`dormant` distinction already
helps to read correctly.

## Operational gates

- `npm run eval` is part of `npm run validate` (pass/fail gate).
- `npm run eval:report` / `npm run eval:living` write `eval-out/` (git-ignored,
  deterministic, commit-pinned).
- `npm run eval:compare` is the CI gate for the normative metrics.
