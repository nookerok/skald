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
| Pattern | Observer-bounded ontology identity with a lifecycle, not a simulation object | A hidden renderer entity |
| Pattern Ontology | Shared identities, kinds, boundaries and lifecycle states | A business Rule |
| Lens | Pure projection of an ObservationRecord into one semantic view | A renderer component |
| Belief Engine | Pure evidence/hypothesis/revision read-side transformation | A source of world truth |
| ExistenceExplanation | Structured factors derived from BeliefModel | Natural-language authority |
| CausalChain | Observer-scoped trace assembled from known belief relations | Complete hidden causality |
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
| InteractionCommand | Canonical transient player intent (verb + target fields), never a Domain Event (ADR-0013) | A persisted command |
| InteractionVerb | Fixed canonical verb set: observe/inspect/listen/touch/take/open/apply_force/give; examine is a parser alias of inspect | An arbitrary action word |
| TargetResolution | Result of the unified resolver: resolved / environment / missing / ambiguous(candidates) | A guess or clarification dialog |
| ambiguous_target | Honest ActionRejected reason with player-facing candidate names; no internal IDs, no guessing | A long-lived clarification state |
| WorldRecord | Catalog metadata (label, status, timestamps) for one world | A game state source of truth |
| CharacterProfile | Immutable literary traits (wound, promise, principle) snapshotted at world creation | A character sheet or stat block |
| World Process | A time-bounded chain of world activity (fire, situation, consequence) | A UI thread or quest |
| Observer Thread | Observer-scoped reconstruction of a World Process from player-facing journal entries | The hidden process itself |
| Thread Evidence | One player-facing journal entry attached to a thread | A raw Event Log dump |
| Known Lifecycle | What the observer can claim about a process: active, resolved, unknown | A projection state read |
| Knowledge State | How current the observer's knowledge is: observed, remembered, uncertain | A claim about the world |
| Re-observation | A new observation that refreshes or contradicts thread knowledge | A navigation command |
| Observer Thread Journal | Pure read model of long-lived processes as the player knows them | A second source of truth |

Do not introduce quests, missions, XP, levels, classes, mana, cooldowns, skill
trees or talents. Express behavior through Events, Rules, Consequences,
Situations, Observations, Relations and existing world laws.

The normal Knowledge UI is defined by docs/OBSERVATION_BELIEF_MODEL.md.
| Offline Intent Envelope | The only thing the browser stores without a connection: { input, idempotencyKey, baseRevision } | A local Domain Event or optimistic projection |
| Base Revision | The world event number the player last saw; the server replays up to it to reconstruct the base world | A client-claimed truth |
| Offline Intent Resolution | Server decision for an envelope: accepted, rejected, conflict or already_processed | A browser-side guess |

## Living-region spatial terms

**Region** — a stable spatial boundary within a World. Region truth is
initialized and changed by Domain Events; it is not a level file loaded as a
second authority.

**Terrain Tile** — a fine spatial unit used by derived terrain, visibility and
rendering calculations. A tile is not itself a simulation scheduler.

**Simulation Cell** — a coarser unit for grouping deterministic world
processes and causal neighbours. Scheduling must not pause the world based on
player distance.

**Spatial World Projection** — backend-only replayable truth about current
geography, routes, crossings and spatial processes.

**Observer Map** — observer-scoped read model of known, uncertain and stale
spatial beliefs. It is not a masked copy of the truth map.

**Landmark** — a physical spatial subject, not a quest marker.

**TravelRelation** — derived spatial relation with travel parameters
(distanceMetres, baseTravelTicks, terrainCost, passability). Built from
`SpatialRelation` + `TravelMetadataAttached` bootstrap events (ADR-0015).

**JourneyIntent** — canonical transient travel command (never a Domain
Event). Produced by the parser for travel verbs; consumed by Command Handler
which emits `JourneyRequested` (ADR-0015).

**JourneyResolution** — route resolver result: resolved / blocked /
ambiguous. Server-only; never reveals hidden geometry (ADR-0015).

**JourneyState** — Projection state for an active or completed journey.
Survives restart via Event Log replay (ADR-0015).

**JourneyDTO** — API response carrying journey status, from/to names,
elapsed/total ticks, narrative text. No internal IDs (ADR-0015).
