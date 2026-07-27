# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-27
Verified commit: (run git status to confirm)
Branch: verify with git status --short --branch
Working tree: should be clean after Iteration 13 commit

## Current milestone

Iteration 14 — Turn Journal & Presentation Threads is complete.
- Single-pass canonical Event Log builder with monotonic timestamp validation.
- Presentation Threads group related cross-turn entries.
- HTTP GET /api/journal with strict pagination.
- Browser journal-view.js connected to app.js, HTML, CSS.
- Full journal model kept separate from thread-filtered view.
- 27 test files, 335 tests, 1 skip, tsc clean.

## Completed

- Event Sourcing, deterministic RuleEngine and Projection replay.
- Consequences, Situations, Observations, Biography, Heat, Relations,
  duration checks, idempotency and player strategy.
- Narrative v0/v1, HTTP server, SQLite persistence and Orange Pi deployment.
- Server hardening, immutable snapshots/payloads and poisoning recovery.
- Presentation Layer (Iteration 13): types, templates, selector, playable UI.
- Turn Journal (Iteration 14): historical replay builder, thread aggregation,
  HTTP API with pagination, browser journal-view.js.

## Current task

Awaiting commit/deploy. Browser smoke-test recommended before deployment.

## Exact next step

1. Run npm run validate.
2. Manual browser playtest (10 turns → reload → thread filter → pagination).
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
