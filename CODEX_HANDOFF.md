# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-27
Verified commit: (run git status to confirm)
Branch: verify with git status --short --branch
Working tree: should be clean after Iteration 13 commit

## Current milestone

Iteration 13 — Discovery & Presentation Layer is complete and ready to commit.
- Backend PresentationTemplate/Selector: classification, importance, grouping.
- HTTP API returns presentation in command/wait/narrative responses.
- Playable browser UI: D-pad, social buttons, primary card, notable entries,
  diagnostics collapsed by default.
- 26 test files, 314 passed, 1 skip, tsc clean.

## Completed

- Event Sourcing, deterministic RuleEngine and Projection replay.
- Consequences, Situations, Observations, Biography, Heat, Relations,
  duration checks, idempotency and player strategy.
- Narrative v0/v1, HTTP server, SQLite persistence and Orange Pi deployment.
- Server hardening, immutable snapshots/payloads and poisoning recovery.
- Playability Principles documented (design guidance, not invariants).
- Presentation Layer: types, templates, selector, turn narrative.
- Browser UI: D-pad, social actions, primary/notable/background, diagnostics.

## Current task

Commit Iteration 13 and push. Then deploy to Orange Pi.

## Exact next step

1. Commit and push all changes.
2. Deploy to Orange Pi via deploy/update-orange-pi.sh.
3. Run 10-turn browser smoke test.
4. Start Iteration 14 — Turn Journal & Presentation Threads.

## Known blockers

- Visual browser testing may be unavailable when the in-app browser sandbox
  fails. Do not claim visual QA without an actual run.

## Do not continue

- Do not add Domain Events or Rules for UI behavior.
- Do not modify RuleEngine, EventBus, or canonical Projection schema for
  read-side features.
- Do not install CodeGraph by modifying global configs without a separate
  configuration review.
