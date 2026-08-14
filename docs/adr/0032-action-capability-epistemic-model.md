# ADR 0032: Action Capability and Epistemic Evidence Integration

Status: accepted

## Context

The action/capability model must complete the existing Interaction Model without
creating a parallel RPG subsystem. Skald already owns the canonical pipeline:

```text
IntentProposal → InteractionCommand → InteractionRequested → Rules → Events → Projection
```

`WorldObject`, `Entity`, `InteractionTarget`, `WorldProjector`, Observation and
Belief are existing contracts. Inventory, contextual capability and proficiency
evidence are incomplete, while testimony and phenomena must remain
non-authoritative read-side concepts.

## Existing mechanism mapping

| Model concern | Existing authority | Integration point |
|---|---|---|
| Intent and command transport | ActionIntentCommand, InteractionCommand, JourneyIntent | handleCommand and existing interpreter |
| Time and validation gates | durationCheck, interactionResolveTarget, interactionResolveLaw | unchanged pipeline |
| Physical objects | WorldObject, ObjectDefinition, InteractionTarget | metadata extension, no duplicate object model |
| Event sourcing | WorldProjector, append-only Event Log | ActionCapabilityProjector read view |
| Observation | @skald/observation, world observation builder | testimony/evidence events become observer-scoped evidence |
| Belief revision | @skald/belief and PatternBelief model | builder consumes evidence without changing Truth |
| Rule composition | createRules() and RuleRegistry | static action-capability rule registration |
| Legacy force resolution | existing CriticalCheck and Biography | compatibility path, separate migration |

The capability read view is a compatibility adapter over these authorities. It is
not a second simulation state or a second resolver.

## Decision

1. Extend the existing Interaction Registry and Rule Registry. No second action
   resolver is introduced.
2. Represent physical placement and possession with append-only events and
   derive inventory/accessibility from replayed events.
3. Represent item affordances as available physical operations, never numeric
   bonuses or progression values.
4. Represent conditions as requirements, blocked affordances and unavailable
   techniques. Conditions are not stacked RPG penalties.
5. Represent proficiency only through `ProficiencyEvidenceRecorded` events and
   contextual read queries. No scalar skill/proficiency state is persisted.
6. Keep Knowledge/Belief observer-scoped. `TestimonyReceived` is a claim with
   `testimony_only` status and cannot alter World Truth.
7. Resolve phenomena through the same affordance interaction rules as ordinary
   objects. No MagicSystem or SpellSystem is added.
8. Simulation Bible definitions remain design-time artifacts. Runtime receives
   only compiled bootstrap/events and registered Rules.

## Domain events

The initial integration owns `ItemMoved`, `ItemPossessionChanged`,
`ContainerOpened`, `ContainerClosed`, `ItemUsed`, `ConditionApplied`,
`ConditionRemoved`, `KnowledgeAcquired`, `ProficiencyEvidenceRecorded`,
`TestimonyReceived`, `EpistemicEvidenceRecorded`, `PhenomenonObserved` and
`PhenomenonInteracted`. Each event has a Rule or external command boundary,
projection behavior and deterministic replay semantics.

## Consequences

The first vertical slice covers pickup, containment, retrieval, opening and
affordance use. Existing legacy critical checks remain compatible and are
migrated separately; their numeric modifiers are not propagated to the new
capability model.

## Verification

Focused Rule/projection tests cover S1–S9, immutability, deterministic replay,
testimony isolation, knowledge/proficiency separation and phenomenon handling.
The repository gate remains `npm run validate`.

## Legacy gaps

The following remain intentionally outside this integration and require a
separate migration ADR:

- numeric CriticalModifier.delta in legacy critical checks;
- generic ActionResolved.result outcome vocabulary;
- historical overlap between WorldObject and generic Entity projections;
- parser clarification IDs that still use wall-clock time;
- remaining legacy interaction slices that do not yet expose placement or
  affordance facts.

The new events and projections do not reinterpret or rewrite old log entries.
