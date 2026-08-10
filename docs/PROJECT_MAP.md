# Skald Project Map

This is a stable navigation map, not an exhaustive file listing. Verify paths against the current tree before editing.

## Start here

| Need | Read first |
|---|---|
| Permanent rules | AGENTS.md |
| Architecture and rationale | docs/ARCHITECTURE.md |
| Normative UI observation contract | docs/OBSERVATION_BELIEF_MODEL.md |
| Current milestone | CODEX_HANDOFF.md |
| Terms | docs/GLOSSARY.md |
| Accepted decisions | docs/DECISIONS.md |
| Worldbuilding principles and checklists | docs/worldbuilding/README.md; docs/adr/0007-worldbuilding-principles.md |
| Canon Model (design-time world knowledge) | docs/WORLD_BIBLE_ARCHITECTURE.md; docs/canon/; docs/adr/0021-world-bible-canon-model.md |
| First living region and observer map | docs/LIVING_WORLD_REGION_ARCHITECTURE.md; docs/adr/0012-first-living-region.md |
| UX-0 product contract | docs/ux/UX_PRODUCT_CONTRACT.md |
| Full validation | scripts/validate.sh |
| Orange Pi operations | .agents/skills/skald-orange-pi-deploy/SKILL.md |
| Browser and visual QA | .agents/skills/skald-ntfs-browser-qa/SKILL.md |

## Package ownership

| Package | Responsibility |
|---|---|
| packages/patterns | Pattern Ontology v1.0 identities, boundaries and lifecycle state machine |
| packages/observation | Observation Contract v2.0, zod validation, JSON Schemas and pipeline skeleton |
| packages/lenses | Pure terrain/ecology/relations/emergence/history/prediction lens transforms |
| packages/belief | Pure evidence -> hypothesis -> belief -> contradiction revisions and decay |
| packages/explain | Structured existence explanations from BeliefModel only |
| packages/trace | Observer-scoped causal tracing from BeliefModel only |
| packages/events | Non-canonical reactive Belief notifications over EventBus |
| packages/event-bus | Event envelope, append, publish, query and persistence interfaces |
| packages/rule-engine | Queue, phases, staged batch and atomic commit |
| packages/world | Projection, world Rules, Narrative, Presentation, observer-threads read model, presence/journal builders |
| packages/intent-parser | Syntax and semantic parsing without world decisions |
| packages/cli | Composition roots, REPL, HTTP, SQLite, UI and deployment |
| docs/ux | UX capability, authority, screen and state contracts |

## Runtime flows

    Browser/REPL -> command boundary -> intent-parser -> command handler
    -> RuleEngine -> staged Domain Events -> EventBus + Projection commit
    -> Presentation/Narrative -> HTTP/CLI output

    Event Log + ReadonlyWorld -> Observation Engine -> BeliefModelDTO
    Pattern Ontology -> Observation Contract -> Observation Engine -> Lenses
    -> Belief -> Explain/Trace -> reactive Belief notifications
    -> normal Knowledge renderer (observer-scoped, uncertainty-preserving)

    Domain Events + ReadonlyWorld -> player-facing journal (skipOfflineTurns)
    -> observer-threads (definitions + aging + checkpoint memory)
    -> ObserverThreadJournalDTO -> /api/worlds/:id/observer-threads,
    entry `threads` field, command `observerThreads` + `observerThreadDelta`
    -> Game Shell "Активные нити" panel (DTO-only cards, montage tags,
    honest lifecycle/certainty labels, no command chips)

    Known Worlds (lazy presence cards, parallelism 3) -> #/world/:id/return
    -> presence entry state machine (idle -> requesting_session -> presence
    -> focus -> acknowledging -> ready; retryable_error / stale_revision /
    unavailable) -> observer-session (checkpoint + drift + presence)

    Browser offline (envelope { input, idempotencyKey, baseRevision } only,
    localStorage queue bounded 20) -> reconnect
    -> POST /api/worlds/:id/offline-command
    -> server re-parses + pure resolveOfflineIntent (base-vs-current world
    replay, shared findExamineTarget predicate)
    -> accepted (normal command cycle) | rejected | conflict |
    already_processed (durable processed_keys) -> offline banner in shell
    -> explicit presence/acknowledge (idempotent, durable same-key retry in
    sessionStorage, writes checkpoint only here; stale/duplicate drop the key
    and re-fetch) -> presence/focus renderers (DTO-only, no client
    classification) -> ACK_SUCCESS -> #/world/:id -> shell unlocked
    -> Belief Reconstruction -> Presence Reconstruction -> Focus -> World

    Region bootstrap authoring bundle -> deterministic bootstrap Domain Events
    -> SpatialWorldProjection (backend truth) -> Observation/Belief
    -> ObserverMapDTO (known/uncertain space only) -> normal Player Map UI

    SQLite open -> Event Log replay -> Projection rebuild -> HTTP readiness

    backup + integrity gate -> fast-forward update -> validation -> restart
    -> health + state + idempotent smoke request

    WSL repository task -> fixed NTFS Codex browser task
    -> in-app browser at LAN URL -> screenshots/DOM/console evidence
    -> PASS/FAIL/BLOCKED returned to repository task

## Authority boundaries

| Component | May read | May write |
|---|---|---|
| Rule | Event and ReadonlyWorld | New Domain Events only |
| Projection | Committed Domain Events | Derived snapshot during commit |
| PresentationTemplate | Event and ReadonlyWorld | Presentation DTO only |
| Narrative/LLM | Selected read-only presentation | Text only |
| Browser normal UI | BeliefModelDTO/current observations and explicitly documented read DTOs | External commands through HTTP |
| Developer diagnostics | Explicitly opened trusted-LAN diagnostics DTOs | None |
| Deployment | Git, SQLite and service state | Operational files/services only |

## Search recipes

    rg "RuleRegistry|register\(" packages
    rg "buildNarrative|narrateLLM|Presentation" packages
    rg "handleCommand|handleNarrative|/api/" packages/cli
    rg "sqlite|integrity_check|restore-skald" packages/cli/deploy docs


## Region canonization authoring

| Need | Read first |
|---|---|
| Reference artifact and image interpretation | docs/worldbuilding/pilot-region/reference/; docs/worldbuilding/pilot-region/interpretation/ |
| Proposals, toponyms and hypotheses | docs/worldbuilding/pilot-region/proposals/; docs/worldbuilding/pilot-region/toponymy/ |
| Author decisions | docs/worldbuilding/pilot-region/reviews/ |
| Deterministic Canon projection | docs/canon/regions/pilot-region/compiler-projection.yaml; scripts/canon/region/load-region-canon.mjs; scripts/canon/region/build-region-ir.mjs |
| Generated runtime bundle | packages/world/src/region/compiled/pilot-region.v5.json |

Authoring files are design-time inputs. Runtime reads only the generated bundle and the Event Log.
