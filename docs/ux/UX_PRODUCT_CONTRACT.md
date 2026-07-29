# UX Product Contract

Status: UX-4.0 baseline (Main Menu, multi-world persistence live).

## Product promise

Skald is a living world whose laws the player discovers through actions and
observable consequences. The interface is a window into the world, not an
administration panel or a second source of truth.

## Current player loop

```text
observe -> choose a supported intention -> submit command
-> receive authoritative world result -> read presentation
-> notice a new question or thread -> choose again
```

## Current production scope

Production UI exposes: Main Menu, Continue, multi-world persistence,
movement, wait, social actions, turn presentation, journal/thread filters,
discovery cards, onboarding guidance, state reload, diagnostics, responsive
layout, accessibility, reconnect and error recovery.

Character selection and world creation are implemented in UX-4.1
(New Game Flow). Deletion, renaming, archiving and export are deferred.

## Authority boundary

The deterministic backend Playability Selector chooses which existing facts are
player-facing and their importance. Narrative/LLM may rephrase selected facts;
it may not select facts, importance, actions or outcomes. The browser renders
server DTOs and sends external commands; it never becomes a world authority.

World creation is an operational atomic transaction, not a Domain Event
or a Rule. Character presets and world templates are server-side static
allowlists.
