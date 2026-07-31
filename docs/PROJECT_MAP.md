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
| UX-0 product contract | docs/ux/UX_PRODUCT_CONTRACT.md |
| Full validation | scripts/validate.sh |
| Orange Pi operations | .agents/skills/skald-orange-pi-deploy/SKILL.md |
| Browser and visual QA | .agents/skills/skald-ntfs-browser-qa/SKILL.md |

## Package ownership

| Package | Responsibility |
|---|---|
| packages/patterns | Pattern Ontology v1.0 identities, boundaries and lifecycle state machine |
| packages/observation | Observation Contract v1.0, zod validation, JSON Schemas and pipeline skeleton |
| packages/lenses | Pure terrain/ecology/relations/emergence/history/prediction lens transforms |
| packages/belief | Pure evidence -> hypothesis -> belief -> contradiction revisions and decay |
| packages/explain | Structured existence explanations from BeliefModel only |
| packages/trace | Observer-scoped causal tracing from BeliefModel only |
| packages/events | Non-canonical reactive Belief notifications over EventBus |
| packages/event-bus | Event envelope, append, publish, query and persistence interfaces |
| packages/rule-engine | Queue, phases, staged batch and atomic commit |
| packages/world | Projection, world Rules, Narrative and Presentation |
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
