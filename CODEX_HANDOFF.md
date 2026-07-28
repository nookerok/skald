# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-28
Branch: main
Working tree: UX-1 implementation complete

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
- 29 test files, 351 tests, 1 skip, tsc clean.

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

Run manual browser smoke-test. Then commit and deploy to Orange Pi.

## Exact next step

1. Run npm run validate.
2. Manual browser playtest: 10 turns → reload → thread filter → pagination
   → offline → reconnect → retry → keyboard → reduced motion.
3. Commit and push.
4. Deploy to Orange Pi via update-orange-pi.sh.

## Known blockers

- Visual browser testing may be unavailable when the in-app browser sandbox
  fails. Do not claim visual QA without an actual run.

## Do not continue

- Do not add Domain Events or Rules for UI behavior.
- Do not modify RuleEngine, EventBus, or canonical Projection schema for
  read-side features.
- Do not install CodeGraph by modifying global configs without a separate
  configuration review.
