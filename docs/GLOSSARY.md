# Skald Glossary

| Term | Canonical meaning | Not this |
|---|---|---|
| Domain Event | A fact stored in the canonical Event Log | A command or UI message |
| PlayerCommand | An external intention before validation | A persisted Event |
| Rule | Deterministic (Event, ReadonlyWorld) -> Event[] function | HTTP handler or LLM |
| RuleEngine | Ordered queue and phase processor | A game decision-maker |
| Projection | State derived entirely by replaying Domain Events | Independent database truth |
| ReadonlyWorld | Immutable snapshot for Rules and read adapters | Mutable world service |
| Consequence | A derived world effect with lifecycle data | Quest or XP reward |
| Situation | A time-bounded active world state | Dialogue tree or mission |
| Observation | Deterministic count of a recurring pattern | An LLM interpretation |
| Relation | A projection edge with kind/value | Relationship manager service |
| Strategy | Pre-registered condition -> action table for offline ticks | NPC.decide() |
| Narrative | Textual description of existing facts | An authority or decision layer |
| PresentationTemplate | Pure event/world -> player-facing candidate adapter | A Domain Rule |
| Player-facing entry | Server-selected text with importance and source IDs | Raw Event Log |
| Trace | A visible sign left by prior behavior | A new canonical Event type |
| Echo | A delayed or repeated consequence | A separate storage subsystem |
| Omen | A visible indication of possible change | A guaranteed prophecy |
| Discovery | Understanding an existing world law | Runtime Rule generation |

Do not introduce quests, missions, XP, levels, classes, mana, cooldowns, skill
trees or talents. Express behavior through Events, Rules, Consequences,
Situations, Observations, Relations and existing world laws.
