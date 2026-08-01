# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-08-02
Branch: main
Working tree: clean; HEAD == origin/main == f044743 (UX-6.0D-F entry path
deployed to Orange Pi, API smoke + ten-turn gameplay smoke passed; visual QA
recorded separately — dispatch through the fixed NTFS browser task)

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
World Clock law. Validation: 59 test files, 885 passed, 1 skipped via
npm run validate (typecheck, diff-check clean).

UX-6.0D-F browser entry path shipped on top (commits b9c02cd, b997058,
f0ada36, all behind origin):
- UX-6.0D: `GET /presence` now also returns the ready-to-render
  `WorldPresenceSummary` card (schemaVersion 1, worldId, checkpointState,
  currentWorldTime, worldTimeDelta, driftLevel, stale/dormant counts,
  `presenceStatus`/`knowledgeStatus` player-facing lines). Known Worlds menu
  rewritten: «Известные миры», «Вернуться», «Открыть новый мир»;
  `known-worlds-view.js` + `presence-card-view.js` render cards from the DTO
  with lazy /presence fetches at parallelism 3 and loading/available/
  unavailable/corrupt states; one failed card never hides the others; no raw
  ids/timestamps/event numbers in card content.
- UX-6.0E: deterministic `presence-entry-state.js` pure reducer (idle →
  requesting_session → presence → focus → acknowledging → ready; retryable_
  error, stale_revision, unavailable) with 16 unit tests; API client
  `fetchObserverSession`/`acknowledgePresence`; fake BUSY_STAGES cycling and
  setInterval removed from the Game Shell (single truthful loading phrase
  «Восстанавливаем твоё присутствие…»).
- UX-6.0F: `presence-view.js` (six modes from checkpointState + drift.level,
  DTO-only montage, reobservation doubts without buttons), `focus-view.js`
  (real PresenceFocus blocks only, null blocks skipped, single «Я здесь»
  acknowledge button), `presence-entry-controller.js` (session fetch, durable
  same-key retry via sessionStorage `skald:presence-ack:1:<worldId>`, reload
  recovery, stale/duplicate → drop key + re-fetch session, graceful return
  with a fresh key). Entry lives on `#/world/:id/return`; the Game Shell
  stays locked until ACK_SUCCESS fires `skald:presence-ready`, then the app
  switches to `#/world/:id` and connects. Dialog a11y (role=dialog, labelled,
  focus trap, 44px targets) and prefers-reduced-motion.

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

Visual QA for UX-6.0D-F must go through the fixed NTFS browser task
($skald-ntfs-browser-qa): Known Worlds cards, entry screen, focus, «Я здесь»
ack, shell unlock — production URL http://192.168.0.5:3000 (deployed commit
f044743; local preview also on http://localhost:3100 in WSL). After that:
design write-capable offline actions with explicit synchronization and
conflict-resolution semantics (roadmap open item). The five npm audit
findings (3 moderate, 1 high, 1 critical) remain a separate
dependency-security task; Vitest UI must not be exposed to LAN.

Note: ssh from WSL to 192.168.0.5 is currently broken (lands on a stale
endpoint with user `nook`); use the Windows OpenSSH client with
`$env:USERPROFILE\.ssh\id_ed25519_skald` for Pi operations.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
