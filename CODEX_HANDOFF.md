# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-08-01
Branch: main
Working tree: dirty; UX-6 (observer presence reconstruction) review remediation complete, validation green, awaiting commit + push

## Current milestone

UX-6 "Observer presence reconstruction" (ADR-0009) is implemented end to end:
known-worlds entry path `observer-session`, lightweight `presence` read and an
idempotent `presence/acknowledge` that is the only writer of the operational
`observer_checkpoints` row. Command/wait paths never touch the checkpoint
(P0-2); acknowledge idempotency uses a separate `acknowledge_requests` table
with a deterministic `request_hash` (P1-3, 409 on body/key reuse conflicts).
Belief reconstruction is a pure deterministic replay of the checkpoint event
prefix; `resolveCheckpointState` validates the stored FNV-1a digest and treats
`incompatible` checkpoints as no memory (P1-6). Drift uses the ADR caps
(stale 8, contradicted 8, threads 4, changes 8) with dormant threads reported
as informational, never as an unresolved-thread factor (P1-7). Player-facing
presence DTOs are display-safe (no internal IDs); internal identifiers exist
only on `PresenceDiagnosticsDTO` (P1-8). Events during `playerOffline` ticks
are not observable and never enter the Belief Model, discoveries, drift or
focus (P0-1). `focus.timeDescription` is always null — no World Clock law.
Second review defects closed: an incompatible checkpoint behaves as no memory
(P1), `wait` ticks are present ticks while `advance N` ticks are offline (P1),
and an acknowledge retry replays the stored original response before the
staleness gate (P1). Validation: 59 test files, 838 passed, 1 skipped via
npm run validate (typecheck, diff-check clean).

## Completed

UX-6.0A-C: ADR-0009, `packages/world/src/presence/` (types, drift, builder),
SQLite schema v4 (`observer_checkpoints`, `acknowledge_requests`,
additive migration), three HTTP endpoints, offline observability filter in
the observation builder, review remediation above. The existing
world/src/observation builder remains the compatibility adapter consuming the
canonical @skald/observation types.

Iteration 16.0 — Visual Shell: dark atmospheric game shell, contextual world stage, world/you/knowledge rail, honest activity and causal views, free-text composer only, responsive layout and generated map asset. Frontend-only; no new Domain Events, Rules, Projection or API contract changes.

UX-0 through UX-5.0B/C: product contract, open intent UI, multi-world
persistence, game shell, player guidance, and the production shell.

Iteration 15: Open Intent and Critical Checks, deployed to Orange Pi.

World Interaction Model v0 first vertical slice:
- additive entities read model from ObjectPlaced events;
- exact syntax examine <object> -> IntentCommand;
- durable gate chain InteractionRequested -> InteractionTimeValidated ->
  TargetResolved -> InteractionValidated -> EntityExamined;
- one static verb (examine) and one law (perception);
- curiosity observation side effect, Narrative/Presentation output, replay
  purity and same-tick action-budget coverage.

## Next

Commit and push the UX-6 diff (validate is green: 59 files, 838 passed, 1
skipped). Then deploy through the Orange Pi skill and run API smoke
(observer-session, presence, one idempotent acknowledge) plus the fixed NTFS
browser task. The five npm audit findings (3 moderate, 1 high, 1 critical)
remain a separate dependency-security task; Vitest UI must not be exposed to
LAN.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
