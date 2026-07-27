# Decision Index

This file indexes accepted decisions. Detailed rationale remains in
docs/ARCHITECTURE.md; do not duplicate the entire architecture here.

| ID | Decision | Status | Source |
|---|---|---|---|
| D-001 | Event Log is the canonical source of truth | accepted | docs/ARCHITECTURE.md |
| D-002 | Projection is rebuilt by replay and updated synchronously at commit | accepted | docs/ARCHITECTURE.md |
| D-003 | Rules are deterministic and cannot call LLM/network/time | accepted | docs/ARCHITECTURE.md |
| D-004 | Commands are not Events and idempotency is infra | accepted | docs/ARCHITECTURE.md |
| D-005 | Validation uses pass-through validated Events | accepted | docs/ARCHITECTURE.md |
| D-006 | LLM/Narrative are read-only and non-authoritative | accepted | docs/ARCHITECTURE.md |
| D-007 | Presentation importance is classified on backend | accepted | docs/PLAYABILITY_PRINCIPLES.md |
| D-008 | Deployment is operational and outside RuleEngine | accepted | AGENTS.md |

New cross-package decisions should use docs/adr/NNNN-*.md and be added to
this index. An ADR records context, alternatives, decision and consequences;
it does not replace executable tests.
