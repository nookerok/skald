# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-31
Branch: main
Working tree: Iteration 16.0.1 corrective patch; local validation passed, production redeploy and browser recheck pending

## Current milestone

Iteration 16.0.1 corrective patch is implemented locally; do not close until production browser QA is repeated.

46 test files, 723 tests passed + 1 skipped, tsc clean, npm run validate PASS.

## Completed

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

Iteration 16.0 is deployed on Orange Pi at commit 3dc4097. A read-only NTFS browser review found mobile Knowledge/Journal navigation, Retry mobile visibility, critical failure-stake presentation and overlay Escape/ARIA defects. The corrective patch fixes these locally; deploy and repeat browser QA before acceptance.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
