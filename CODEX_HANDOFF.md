# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-08-01
Branch: main
Working tree: dirty; full review remediation complete, awaiting commit

## Current milestone

Observation and Belief read model is implemented as a pure read-side adapter for
the new visual contract. The repository is on main after the worldbuilding documentation adoption. Review remediation now covers runtime schema freshness, nested snapshot immutability, poisoned-runtime health/restart, single-flight world loading, critical-check recovery, observer-scoped discovery and grid distance gates, plus UI authority boundaries. The normal discoveries endpoint now derives only from the player BeliefModel; unsupported observer identities fail closed, and browser validation covers nested existence explanations. Persistent CLI critical checks now use one durable batch; BeliefModelDTO is v2 with explicit freshness and idempotent decay; observer position replay updates before visibility gates.
Validation: 56 test files, 787 passed, 1 skipped; typecheck and diff-check clean.
API smoke: 10 sequential turns, world time 158 to 167, every response had
`presentation.primary`, duplicate key rejected with HTTP 409; health, state and
all systemd timers verified active after smoke. Browser QA through the fixed NTFS task passed DOM/console/mobile checks;
screenshots and Performance API network evidence were blocked by browser-tool
CDP/runtime limitations.
Normative UI contract v2: docs/OBSERVATION_BELIEF_MODEL.md; freshness decision: docs/adr/0008-belief-model-freshness.md. AGENTS, architecture, UX
contract, authority boundaries, glossary and roadmap now point to this specification.
Observation infrastructure PR-1..PR-8 packages are implemented and type-tested;
world/src/observation remains the compatibility runtime adapter.

Worldbuilding principles v1.0 are installed under docs/worldbuilding/ and
adopted as a governed design/checklist layer by ADR-0007. No new runtime Events,
Rules or persistence were introduced; IntentGraph, Pattern emergence and
parameter calibration remain deferred vertical slices.

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

Commit and push the remediation diff only after npm run validate; then deploy and repeat the API/browser gates on the new revision.
Then deploy through the Orange Pi skill and run API smoke plus the fixed NTFS browser task.
The five npm audit findings (3 moderate, 1 high, 1 critical) remain a separate dependency-security task; Vitest UI must not be exposed to LAN.

## Known blockers

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope for this slice. It is a
small follow-up after the deterministic gate pipeline is accepted.
