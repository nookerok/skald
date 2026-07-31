# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-31
Branch: main
Working tree: clean; Observation and Belief read-model deployed and browser-reviewed

## Current milestone

Observation and Belief read model is implemented as a pure read-side adapter for
the new visual contract. Commit f29e5f2 is pushed to main and deployed on
Orange Pi 192.168.0.5.
Validation: 47 test files, 734 passed, 1 skipped; typecheck and diff-check clean.
API smoke: 10 sequential turns, world time 147 to 157, duplicate key rejected with
HTTP 409. Browser QA through the fixed NTFS task passed DOM/console/mobile checks;
screenshots and Performance API network evidence were blocked by browser-tool
CDP/runtime limitations.
Normative UI contract: docs/OBSERVATION_BELIEF_MODEL.md. AGENTS, architecture, UX
contract, authority boundaries, glossary and roadmap now point to this specification.

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

Keep the Belief Model contract and compatibility shell aligned. Treat the five npm audit findings reported by the updater (3 moderate, 1 high, 1 critical) as a separate dependency-security task; they did not block runtime health.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
