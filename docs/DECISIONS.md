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

| D-013 | Observation & Belief Model is the normative observer-scoped UI read contract; confidence/freshness/evidence/hypotheses/contradictions are deterministic and the normal renderer never reads World/Event Log directly | accepted | docs/OBSERVATION_BELIEF_MODEL.md; docs/adr/0006-observation-belief-read-model.md |
| D-014 | Observation infrastructure is layered as Pattern Ontology -> Contract -> Observation -> Lenses -> Belief -> Explain/Trace -> reactive events; these packages are read-side and emit no canonical Domain Events | accepted | AGENTS.md; docs/ARCHITECTURE.md |
| D-015 | Worldbuilding principles are a governed design layer; they add no runtime Events/Rules/persistence until a vertical-slice ADR maps them to current contracts | accepted | docs/adr/0007-worldbuilding-principles.md; docs/worldbuilding/README.md |
| D-016 | BeliefModelDTO v2 makes PatternBelief.freshness explicit; freshness is recomputed from retained evidence and never compounds across read-model decay calls | accepted | docs/adr/0008-belief-model-freshness.md; docs/OBSERVATION_BELIEF_MODEL.md |
| D-017 | Observer Thread Journal is a pure observer-scoped read model of long-lived processes; lifecycle/certainty/change are classified on the backend; absence of observation never resolves a thread and hidden offline state never becomes player-facing truth | accepted | docs/adr/0010-observer-active-threads.md |
| D-018 | Offline intent queue: the browser stores only a Command envelope (input + idempotency key + base revision), never Events/Projection; on reconnect the server re-runs the Intent Parser and classifies accepted / rejected / conflict / already_processed; only accepted executes, conflicts are text, no auto-rebase or silent merge | accepted | docs/adr/0011-offline-intent-queue.md |
| D-019 | The first 20×20 km living region is initialized through bootstrap Domain Events; backend spatial truth and observer-scoped map knowledge are separate derived projections; unknown canonical geometry never reaches the normal browser | accepted | docs/adr/0012-first-living-region.md; docs/LIVING_WORLD_REGION_ARCHITECTURE.md |
| D-020 | Interaction Model v1: one canonical InteractionCommand pipeline (never an Event), fixed v1 verb set (observe/inspect/listen/touch/take/open/apply_force/give), one shared ambiguous-aware Target Resolver for runtime+offline+HTTP, Entity/WorldObject aligned via a pure InteractionTarget adapter, delivered as seven sequential vertical slices | accepted | docs/adr/0013-interaction-model-v1.md; docs/WORLD_INTERACTION_MODEL.md |
| D-021 | First living region slice: deterministic `RegionDefined` bootstrap, separate spatial truth projection, and observer-scoped `/map` DTO; no hidden tile geometry or exact merely-glimpsed landmark coordinates reach the normal browser | accepted | docs/adr/0014-region-bootstrap-observer-map.md; docs/LIVING_WORLD_REGION_ARCHITECTURE.md |
| D-022 | Spatial Movement: JourneyIntent (separate from InteractionVerb), TravelRelation with travel parameters, multi-tick journey via individual TickPassed events, server-only route resolution, JourneyState in Projection, active journey blocks new commands | accepted | docs/adr/0015-spatial-movement-abstract-travel-time.md |
| D-023 | Visibility: pure read-side engine computes observer line-of-sight from terrain, elevation, distance and surface; no Domain Events, no Rules; integrates with ObserverMapDTO; observed/glimpsed/hidden classification; supercover/Bresenham terrain traversal | accepted | docs/adr/0016-visibility-observer-line-of-sight.md |
| D-024 | River Hydrology: deterministic cyclic river level process; CrossingCondition derived from river level; TickPassed triggers RiverLevelChanged → CrossingConditionChanged chain; route resolver reads dynamic crossing states; no weather/seasonality yet | accepted | docs/adr/0017-river-hydrology-and-crossing.md |

New cross-package decisions should use docs/adr/NNNN-*.md and be added to
this index. An ADR records context, alternatives, decision and consequences;
it does not replace executable tests.
