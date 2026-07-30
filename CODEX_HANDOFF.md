# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-30
Branch: main
Working tree: World Interaction Model v0 examine/perception vertical slice complete, validated, awaiting commit

## Current milestone

World Interaction Model v0 — first vertical slice is complete.

45 test files, 703 tests passed + 1 skipped, tsc clean, npm run validate PASS.

## Completed

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

Review this vertical slice, then commit it. A second verb or law requires a
separate design/implementation iteration; do not widen this registry casually.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
