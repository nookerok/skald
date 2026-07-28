# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-28
Branch: main
Working tree: UX-2 implementation complete

## Current milestone

UX-2 — Discovery Presentation is complete.
- ADR 0001: Discovery read model (derived from Event Log, no new Events/Rules).
- Discovery builder: deterministic, deep-frozen, monotonic timestamps check.
- First discovery law: risk_draws_attention (trace → hypothesis → discovered).
- Discovery marks in Presentation: ObservationUpdated(risk_taken)→trace,
  AudacityTriggered→omen, ConsequenceCreated(audacity)→omen,
  ConsequenceFired(audacity)→echo.
- GET /api/discoveries endpoint, POST returns 405.
- Third UI tab «Открытия» with card sidebar + detail + evidence list.
- Evidence click navigates to Journal tab via skald:navigate event.
- Active card persisted to sessionStorage; survives reload.
- Discoveries state model (loading/available/empty/stale/unavailable).
- 34 test files, 429 tests, 1 skip, tsc clean.

## Completed

- Event Sourcing, deterministic RuleEngine and Projection replay.
- Consequences, Situations, Observations, Biography, Heat, Relations,
  duration checks, idempotency and player strategy.
- Narrative v0/v1, HTTP server, SQLite persistence and Orange Pi deployment.
- Server hardening, immutable snapshots/payloads and poisoning recovery.
- Presentation Layer (Iteration 13): types, templates, selector, playable UI.
- Turn Journal (Iteration 14): historical replay builder, thread aggregation,
  HTTP API with pagination, browser journal-view.js.
- UX-1: client-state machine, command recovery, reconnect loop, keyboard
  navigation, responsive CSS, accessibility tokens, status rendering.
- UX-2: Discovery read model, definition registry, discovery builder,
  presentation marks, API endpoint, three-tab UI with evidence detail.
- Client-state.js: pure state machine (booting/ready/disconnected/reconnecting/fatal).
- status-view.js: renders connection status, command states, journal states.
- Command recovery: timeout/transport failure keep pending key for retry.
- Duplicate 409 triggers state + journal reconciliation.
- Reconnect loop with exponential backoff (1s → 2s → 5s → 10s).
- Keyboard navigation: arrows/WASD for movement, Space for wait.
- CSS custom properties, responsive layout, focus-visible, aria attributes.
- Empty state, pending message, error messages without raw HTTP codes.
- 31 test files, 392 tests, 1 skip, tsc clean.
- Thread filter persisted to sessionStorage; survives reload and re-render.
- Journal pagination dedup prevents duplicate turns on <Ранее> load.
- aria-pressed on active thread button; aria-expanded on turn accordions.
- Retry reuses the original idempotency key (sendCommand bypass, not handle()).
- Polling guard blocks overwrite during PENDING as well as SUCCEEDED.

## Completed

- Event Sourcing, deterministic RuleEngine and Projection replay.
- Consequences, Situations, Observations, Biography, Heat, Relations,
  duration checks, idempotency and player strategy.
- Narrative v0/v1, HTTP server, SQLite persistence and Orange Pi deployment.
- Server hardening, immutable snapshots/payloads and poisoning recovery.
- Presentation Layer (Iteration 13): types, templates, selector, playable UI.
- Turn Journal (Iteration 14): historical replay builder, thread aggregation,
  HTTP API with pagination, browser journal-view.js.
- UX-1: client-state machine, command recovery, reconnect loop, keyboard
  navigation, responsive CSS, accessibility tokens, status rendering.

## Current task

UX-1 and deploy privilege hardening are live on Orange Pi at commit f59ffce.
API smoke passed 10/10 (worldTime 32 to 42, duplicate request 409).
Non-interactive updater regression passed backup, 395 tests, restart and health.
Visual browser QA remains pending because the WSL-backed browser sandbox fails.

## Exact next step

1. Open an NTFS-backed Codex browser task.
2. Test http://192.168.0.5:3000 with ten real control clicks.
3. Verify reload, thread filter, pagination, reconnect and retry.
4. Start UX-2 only after visual QA is recorded.

## Known blockers

- Visual browser testing may be unavailable when the in-app browser sandbox
  fails in the WSL-backed task. Do not claim visual QA without an actual run.

## Do not continue

- Do not add Domain Events or Rules for UI behavior.
- Do not modify RuleEngine, EventBus, or canonical Projection schema for
  read-side features.
- Do not install CodeGraph by modifying global configs without a separate
  configuration review.
