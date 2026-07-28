# UX Product Contract

Status: UX-0 accepted planning baseline.

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

The production UI may expose only movement, wait, supported social actions,
turn presentation, journal/thread filters, state reload and developer
diagnostics. Every control must map to an existing command/API contract.

Inventory, NPC dialogue, free-form world navigation, multi-world selection,
character creation, accounts, voice and write-capable offline mode are future
concepts until their Events, Rules, Projection fields, persistence and API are
approved.

## Authority boundary

The deterministic backend Playability Selector chooses which existing facts are
player-facing and their importance. Narrative/LLM may rephrase selected facts;
it may not select facts, importance, actions or outcomes. The browser renders
server DTOs and sends external commands; it never becomes a world authority.

## UX-1 scope

The next implementation slice is the current playable shell: Game Screen,
turn presentation, journal, thread filters, loading/reconnect/error states,
developer diagnostics, responsive layout and accessibility. Future screens are
documented separately and are not represented as working controls.
