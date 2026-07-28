# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-28
Branch: main
Working tree: deploy privilege hardening pending validation and commit

## Current milestone

UX-1 — Current Playable Shell is complete.
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

UX-1 is deployed to Orange Pi at commit 1cf6d76. API smoke passed 10/10
(worldTime 32 to 42, duplicate request 409). Fix the updater restart privilege
gate, install it once on the device, then re-run the updater non-interactively.

## Exact next step

1. Validate, commit and push the restricted restart policy.
2. Run install-orange-pi.sh interactively once to install the policy.
3. Re-run update-orange-pi.sh over non-interactive SSH.
4. Complete the visual browser smoke-test from an NTFS-backed browser task.

## Known blockers

- Visual browser testing may be unavailable when the in-app browser sandbox
  fails in the WSL-backed task. Do not claim visual QA without an actual run.

## Do not continue

- Do not add Domain Events or Rules for UI behavior.
- Do not modify RuleEngine, EventBus, or canonical Projection schema for
  read-side features.
- Do not install CodeGraph by modifying global configs without a separate
  configuration review.
