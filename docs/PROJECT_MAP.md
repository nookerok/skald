# Skald Project Map

This is a stable navigation map, not an exhaustive file listing. Verify paths against the current tree before editing.

## Start here

| Need | Read first |
|---|---|
| Permanent rules | AGENTS.md |
| Architecture and rationale | docs/ARCHITECTURE.md |
| Current milestone | CODEX_HANDOFF.md |
| Terms | docs/GLOSSARY.md |
| Accepted decisions | docs/DECISIONS.md |
| UX-0 product contract | docs/ux/UX_PRODUCT_CONTRACT.md |
| Full validation | scripts/validate.sh |

## Package ownership

| Package | Responsibility |
|---|---|
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

    SQLite open -> Event Log replay -> Projection rebuild -> HTTP readiness

    backup + integrity gate -> fast-forward update -> validation -> restart
    -> health + state + idempotent smoke request

## Authority boundaries

| Component | May read | May write |
|---|---|---|
| Rule | Event and ReadonlyWorld | New Domain Events only |
| Projection | Committed Domain Events | Derived snapshot during commit |
| PresentationTemplate | Event and ReadonlyWorld | Presentation DTO only |
| Narrative/LLM | Selected read-only presentation | Text only |
| Browser | API DTOs | External commands through HTTP |
| Deployment | Git, SQLite and service state | Operational files/services only |

## Search recipes

    rg "RuleRegistry|register\(" packages
    rg "buildNarrative|narrateLLM|Presentation" packages
    rg "handleCommand|handleNarrative|/api/" packages/cli
    rg "sqlite|integrity_check|restore-skald" packages/cli/deploy docs
