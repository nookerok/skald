# UX Product Contract

Status: Iteration 15 baseline (Open Intent and durable critical checks live).

## Product promise

Skald is a living world whose laws the player discovers through actions and
observable consequences. The interface is a window into the world, not an
administration panel or a second source of truth.

The normal player UI is determined by the Observation & Belief contract:
docs/OBSERVATION_BELIEF_MODEL.md. It renders observer-scoped beliefs and
observations, not authoritative World state or an unfiltered Event Log.

## Current player loop

```text
observe -> describe an intention in your own words -> submit text
-> receive an interpreted proposal or clarification
-> deterministic Rules resolve the authoritative world result
-> read presentation -> notice a new question or thread
-> describe the next intention
```

## Current production scope

Production UI exposes: Main Menu, Continue, multi-world persistence,
free-text intentions, deterministic clarification and rejection, movement,
wait, social and object interactions supported by current Rules, durable
critical checks, turn presentation, journal/thread filters, discovery cards,
onboarding guidance, state reload, diagnostics, responsive layout,
accessibility, reconnect and error recovery.

Character selection and world creation are implemented in UX-4.1
(New Game Flow). Deletion, renaming, archiving and export are deferred.

## Normative Observation & Belief UI contract

The Knowledge surface consumes only BeliefModelDTO and current
ObservationRecord data. It must show interpretation, confidence, freshness,
evidence, hypotheses and contradictions without silently collapsing uncertainty.
The browser does not classify facts, infer outcomes or choose actions. Raw
events and IDs belong only to explicitly opened Developer Diagnostics.

## Interaction contract

The text composer is the primary game control. The player chooses an action by
describing it in their own words. The interface must not replace that choice
with a D-pad, direction buttons, suggested-action chips or a permanent command
menu.

The only game-action button in the composer sends the current text. Buttons for
navigation, journal filters, diagnostics, accessibility, save management and
other interface operations are allowed because they do not express an
in-world intention.

The interface may help the player understand the world, the limits of a parsed
request or a clarification question. It must not silently rewrite the player's
meaning or select an action on their behalf.

In a critical moment the system may display:

- the action and target inferred from the submitted text;
- the stakes of success and failure;
- difficulty and world-derived modifiers;
- the recorded dice roll and authoritative outcome.

This presentation explains how the world resolved the player's intention. It
does not introduce a replacement list of actions. If a materially different
choice is required, the player describes a new intention in words.

## Authority boundary

The deterministic backend Playability Selector chooses which existing facts are
player-facing and their importance. Narrative/LLM may rephrase selected facts;
it may not select facts, importance, actions or outcomes. The browser renders
server DTOs and sends external commands; it never becomes a world authority.

The intent interpreter proposes structure but does not decide outcomes or
mutate the world. Critical-check stakes, modifiers, rolls and results are
produced by the authoritative backend and recorded through the canonical event
flow.

World creation is an operational atomic transaction, not a Domain Event
or a Rule. Character presets and world templates are server-side static
allowlists.
