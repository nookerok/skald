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
| D-009 | UX-0 separates current production capabilities from future concepts; LLM does not select facts or actions | accepted | docs/ux/UX_PRODUCT_CONTRACT.md |
| D-010 | Discovery is a read model derived from Event Log, not stored as Events; stages are monotonic; LLM does not classify evidence; definitions are static compile-time code | accepted | docs/adr/0001-discovery-read-model.md |
| D-011 | Player Guidance is a read model derived from Event Log + World + DiscoveryJournal; phases are deterministic; suggestions come from a static allowlist; LLM does not select suggestions; browser dismissal is local Presentation state | accepted | docs/adr/0002-player-guidance-read-model.md |
| D-012 | Multi-world persistence uses a single SQLite database with world_id isolation; WorldId = save slot; one character per world; autosave only; world_id is infrastructure, not a Domain Event field | accepted | docs/adr/0003-multi-world-persistence.md |

New cross-package decisions should use docs/adr/NNNN-*.md and be added to
this index. An ADR records context, alternatives, decision and consequences;
it does not replace executable tests.
