# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-08-02
Branch: main
Working tree: clean; HEAD == origin/main == 76f609c (UX-6.1 committed and
deployed to Orange Pi: update + backup/integrity + 948 tests on-device +
health/state + lifecycle smoke + idempotency edge cases PASS). Visual QA for
UX-6.1: dispatched to the fixed NTFS browser task (thread
019fa52b-1610-7b23-9567-37891d24c782) — BLOCKED: Codex backend refuses
requests (chatgpt.com/backend-api returns HTTP 403 via Cloudflare,
"Unable to load site"); the assignment is queued in the thread and must be
run once the backend is reachable again. All non-visual gates PASS.

## Current milestone

UX-6.1 "Presence Lifecycle Completion" is implemented (uncommitted; validate
PASS 948 tests):
- 6.1A atomic Entry DTO: `buildObserverSessionAndSummary` in
  packages/world/src/presence/builder.ts derives session + summary in one
  pass (invariant: `session.revision.worldTime === summary.currentWorldTime`,
  checkpointState agrees by construction); both `/observer-session` and
  `/presence` return `{session, summary}`. Honest statuses: none — «Мир
  кажется таким, каким ты его помнишь.»; incompatible — «Твои прежние
  воспоминания нельзя надёжно восстановить. Мир приходится воспринимать
  заново.» 22 presence-http tests.
- 6.1B entry state machine rework: PRESENCE is its own phase; only the
  explicit «Осмотреться»/«Войти» button (client-only `skald:presence-
  continue`) moves to FOCUS; acknowledge («Я здесь») is possible only from
  FOCUS (or durable-pending resume / transport retry). `presence-entry-
  state.js` phases: idle → requesting_session → presence → focus →
  acknowledging_entry → ready, retryable_error, stale_revision, unavailable.
  `presence-view.js`/`focus-view.js` render DTO-only montage + focus blocks
  (location, ambient, cues, remembered context) with 44px targets, one
  landmark per phase, aria-live status, focus trap, `data-phase-title` focus
  handoff.
- 6.1C lease routing: `presence-lease.js` (sessionStorage
  `skald:presence:lease:1:<worldId>`, written only after acknowledge HTTP
  200), `presence-route.js` (pure `resolveWorldRoute`), app.js gates
  `#/world/:id` on the lease and `location.replace`s to `/return` without
  one (no shell frame ever renders); new game → `#/world/:id/return`;
  `skald:presence-ready` → `#/world/:id`; reload keeps lease, new tab
  re-enters presence.
- 6.1D graceful exit: «Выйти» button, `presence-exit-state.js` reducer
  (leave_requested → fetching_current_session → acknowledging_exit →
  leave_ready; stale auto-refetch capped at MAX_STALE_RETRIES=1; transport
  fail keeps the durable `skald:presence:exit-pending:1:<worldId>` body;
  stay/retry), `presence-exit-controller.js` with `initExitFlow({
  onWaitForPendingCommand })`; app.js blocks commands while
  `isExitInProgress()`, waits for the in-flight command before syncing,
  `skald:exit-ready` → menu (lease cleared, checkpoint pinned server-side).
- 6.1E honest loading texts mapped to reducer phases only:
  «Восстанавливаем твои наблюдения…», «Подтверждаем твоё присутствие…»,
  «Сверяем последнее состояние мира…», «Сохраняем точку возвращения…»;
  no timed/fake stages.
- 6.1F tests: entry-state 19, exit-state 12, presence-route 5, view/
  controller/app wiring checks, static whitelist gains the four new JS
  modules, `presence-lifecycle.test.ts` 7 integration tests (entry ack pins
  checkpoint, re-entry zero drift, same-key replay, key+different-body 409,
  stale never overwrites, offline ticks observer-scoped, restart replay).

## Completed

UX-6.0D-F browser entry path (commits b9c02cd, b997058, f0ada36, f044743,
1cbd1ac, d7ce256, deployed): Known Worlds cards from `WorldPresenceSummary`,
deterministic presence entry reducer + view + controller on
`#/world/:id/return`, shell unlock via `skald:presence-ready`, a11y
touch-target fix (44px).

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

Deployment of UX-6.1 is complete (commit 76f609c live on the Orange Pi;
worldTime 204, checkpoint pinned at 204; stale/duplicate 409 gates verified
on production). Run the queued NTFS visual QA assignment once the Codex
backend is reachable (the prompt is already the last message in thread
019fa52b-1610-7b23-9567-37891d24c782; it carries the authorized click
budget: 4 commands, 2 acks, 2 exits). After that: design write-capable
offline actions with explicit synchronization and conflict-resolution
semantics (roadmap open item). The five npm audit findings (3 moderate, 1
high, 1 critical) remain a separate dependency-security task; Vitest UI must
not be exposed to LAN.

Note: ssh from WSL to 192.168.0.5 is currently broken (lands on a stale
endpoint with user `nook`); use the Windows OpenSSH client with
`$env:USERPROFILE\.ssh\id_ed25519_skald` for Pi operations.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
