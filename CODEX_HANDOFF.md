# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-30
Branch: main
Working tree: Iteration 16.0 Visual Shell deployed and browser-QA verified; screenshots blocked by browser runtime

## Current milestone

Iteration 16.0 Visual Shell is complete.

46 test files, 718 tests passed + 1 skipped, tsc clean, npm run validate PASS.

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

Iteration 16.0 is deployed on Orange Pi at commit ac32129. NTFS browser QA functionally PASSed at 1536/1024/390 with 10 text intentions (T125→T135), reload, journal/discoveries and zero console errors. Screenshot capture was BLOCKED by browser runtime target-closed; keep this separate from application PASS. Next: review visual evidence limitation and plan the next product iteration.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
