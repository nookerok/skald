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
| ObservationRecord | Observer-scoped result of the deterministic Observation Engine | Mutable world state |
| Evidence | Typed, time-stamped reason supporting an observation or belief | A hidden Event Log dump |
| BeliefModel | Observer-scoped read model of interpretations, hypotheses, relations and contradictions | A second source of truth |
| PatternBelief | Current interpretation plus supporting evidence and open hypotheses | A confirmed world fact |
| Hypothesis | Provisional interpretation whose confidence can strengthen or weaken | A Rule or player command |
| Freshness | Deterministic decay of how recent an observation remains | Deletion of old evidence |
| Contradiction | Persistent evidence that conflicts with an active interpretation | An error to hide automatically |
| Lens | Allowed observation perspective: terrain, ecology, relations, emergence, history or prediction | A UI filter that changes facts |
| BeliefModelDTO | JSON-safe server DTO consumed by the normal Knowledge renderer | Raw Projection or Event Log |
| Relation | A projection edge with kind/value | Relationship manager service |
| Strategy | Pre-registered condition -> action table for offline ticks | NPC.decide() |
| Narrative | Textual description of existing facts | An authority or decision layer |
| PresentationTemplate | Pure event/world -> player-facing candidate adapter | A Domain Rule |
| Player-facing entry | Server-selected text with importance and source IDs | Raw Event Log |
| Trace | A visible sign left by prior behavior | A new canonical Event type |
| Echo | A delayed or repeated consequence | A separate storage subsystem |
| Omen | A visible indication of possible change | A guaranteed prophecy |
| Discovery | Understanding an existing world law derived from Event Log | Runtime Rule generation |
| DiscoveryDefinition | Static code mapping Domain Events to evidence and stages | A Rule or Event emitter |
| DiscoveryCard | A read-model DTO for one discoverable world law with stage and evidence | A stored entity or projection component |
| WorldId | UUID identifying one independent game world and its Event Log | A save slot or account |
| WorldRecord | Catalog metadata (label, status, timestamps) for one world | A game state source of truth |
| CharacterProfile | Immutable literary traits (wound, promise, principle) snapshotted at world creation | A character sheet or stat block |

Do not introduce quests, missions, XP, levels, classes, mana, cooldowns, skill
trees or talents. Express behavior through Events, Rules, Consequences,
Situations, Observations, Relations and existing world laws.

The normal Knowledge UI is defined by docs/OBSERVATION_BELIEF_MODEL.md.
