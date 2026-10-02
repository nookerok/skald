# ADR 0038: Interaction Verb and Affordance Catalog Alignment

Status: accepted

Amends ADR-0013 §2 and clarifies ADR-0032 decisions 3 and 7.

## Context

The implemented interaction catalog drifted across three representations:

- `InteractionVerb` contained eleven canonical verbs;
- the intent capability manifest omitted `close`;
- the interaction registry replaced the still-legacy `apply_force` slice with
  an `experiment` verb.

At the same time, `experiment` was already a typed item affordance consumed by
the canonical `use` interaction. Keeping it as both a verb and an affordance
would create two routes to the same law and make the registry, parser contract
and persisted affordance facts disagree.

The affordance union and the runtime membership set were also maintained
separately, so their equality depended on manual review.

## Decision

1. `INTERACTION_VERBS` is the executable source for the canonical verb
   vocabulary. `InteractionVerb` is derived from that tuple and
   `INTENT_CAPABILITIES.interactionVerbs` references the same tuple.
2. The canonical vocabulary is:

   ```text
   observe | inspect | listen | touch | take | open | close |
   apply_force | give | place | use
   ```

3. The interaction registry must contain the same vocabulary except for the
   explicit temporary `apply_force` exception. `apply_force` remains on its
   legacy rule path until ADR-0013 Slice 6 migrates it.
4. The exception is executable and self-expiring:
   `INTERACTION_REGISTRY_PENDING_VERBS` names only `apply_force`, registry
   definitions cannot add that value while it remains pending, and a catalog
   equality test fails if the exception becomes unnecessary without removal.
5. `experiment` is not an `InteractionVerb` and has no registry entry or
   interaction law. It remains a closed `Affordance` value. Natural language
   such as «поэкспериментировать с кристаллом» is normalized to
   `InteractionCommand { verb: "use", goal: "experiment" }`.
6. `AFFORDANCES` is the executable source for the affordance vocabulary;
   `Affordance` and runtime membership validation derive from it.
7. A stale model proposal or stale transient command with verb `experiment`
   is rejected through the existing unsupported/unknown-verb path. It does not
   throw and does not enter the Event Log.

## Scope boundary

This decision does not define or change:

- `MASTER_TURN_AVAILABLE_ACTIONS` or whether it belongs in a model prompt or a
  player-facing DTO;
- Master Turn Gateway referent resolution;
- `ActionRejected(ambiguous_target)` Biography, time or candidate-scope
  semantics;
- the current `touch -> perception` law;
- the implementation of ADR-0013 Slice 6.

Those questions require separate evidence and decisions.

## Persistence and replay

No Domain Event schema, persisted event, Projection or SQLite table changes.
Existing `WorldObjectPlaced.affordances: ["experiment"]` facts keep their
meaning. This ADR makes no broader claim about every historical reader of the
Event Log; it only removes a non-authoritative transient verb route and retains
the persisted affordance vocabulary.

## Consequences

- Adding or removing a canonical verb requires changing one tuple; manifest
  drift becomes impossible by construction.
- The registry equality test checks names, not law behavior. Semantic mappings
  such as `touch -> perception` still need their own focused tests and review.
- ADR-0013 Slice 6 must add the `apply_force` registry definition and remove
  `apply_force` from `INTERACTION_REGISTRY_PENDING_VERBS` in the same change.
- `use` remains bounded by the closed `AFFORDANCES` tuple; `experiment` does
  not turn it into an open string-dispatched catch-all.

## Verification

Focused tests cover exact catalog equality, expiry of the `apply_force`
exception, stale `experiment` rejection, natural-language normalization to
`use` plus `goal: "experiment"`, and the existing S9 phenomenon interaction.
The repository gate remains `npm run validate`.
