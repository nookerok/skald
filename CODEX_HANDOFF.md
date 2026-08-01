# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-08-01
Branch: main
Working tree: clean; HEAD == origin/main == 26e515f (UX-6 shipped, validated,
deployed, API smoke passed; visual QA recorded separately per skill)

## Current milestone

UX-6 "Observer presence reconstruction" (ADR-0009) is shipped end to end:
known-worlds entry path `observer-session`, lightweight `presence` read and an
idempotent `presence/acknowledge` that is the only writer of the operational
`observer_checkpoints` row. Command/wait paths never touch the checkpoint
(P0-2); acknowledge idempotency uses a separate `acknowledge_requests` table
with a deterministic `request_hash` and stores the original result, so a
replayed key reproduces the first response byte-for-byte before the staleness
gate (P1-3, 409 on body/key reuse conflicts). Belief reconstruction is a pure
deterministic replay of the checkpoint event prefix; `resolveCheckpointState`
validates the stored FNV-1a digest AND the stored time/event-number (safe
non-negative integers, no clamping beyond the log, the replayed prefix must
end exactly on `lastPresenceWorldTime`); `incompatible` checkpoints are
treated as no memory everywhere, including the Known Worlds summary time
(P1-6, review round 2). Drift uses the ADR caps (stale 8, contradicted 8,
threads 4, changes 8) with dormant threads reported as informational, never
as an unresolved-thread factor (P1-7). Presence journal threads are collected
under observer scope (`skipOfflineTurns`): offline turns still advance the
historical projection but produce no presentation/thread entries, so hidden
continuations do not un-dormant known threads (P1, review round 2). Player-
facing presence DTOs are display-safe (no internal IDs); internal identifiers
exist only on `PresenceDiagnosticsDTO` (P1-8). Events during `playerOffline`
ticks are not observable and never enter the Belief Model, discoveries,
drift, focus or threads (P0-1). `focus.timeDescription` is always null — no
World Clock law. Validation: 59 test files, 846 passed, 1 skipped via
npm run validate (typecheck, diff-check clean).

## Completed

UX-6.0A-C: ADR-0009, `packages/world/src/presence/` (types, drift, builder),
SQLite schema v4 (`observer_checkpoints`, `acknowledge_requests`,
additive migration), three HTTP endpoints, offline observability filter in
the observation builder, both review-remediation rounds above. The existing
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

UX-6.0D-F: wire the browser entry-path UI (reconstruction screen and focus
transition are still not connected to `observer-session`/`presence`/
`acknowledge`), then design write-capable offline actions with explicit
synchronization and conflict-resolution semantics (roadmap open item). The
five npm audit findings (3 moderate, 1 high, 1 critical) remain a separate
dependency-security task; Vitest UI must not be exposed to LAN.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
