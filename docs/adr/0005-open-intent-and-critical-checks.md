# ADR 0005 — Open Intent & Critical Checks

## Context

Skald's original design used a constrained command model (`move north`,
`give help to guild`) that reduced player expression to a handful of button
presses. The core product promise — *the player freely describes intentions
in natural language, and the world responds according to its laws* — was
unfulfilled.

Additionally, the world lacked physical objects, locations beyond a grid,
and any form of uncertainty or risk beyond deterministic observation counters.

## Decision

### 1. Open Intent Boundary

Player text flows through a two-stage interpreter pipeline:

```
Raw player text
  → Intent Interpreter (non-authoritative)
    → IntentDraft (not an Event)
      → structural validation / clarification
        → ActionIntentCommand (not an Event)
          → Command Handler
            → ActionAttempted (Domain Event)
              → Rules
```

The interpreter may:
- Identify the primary action mode and operation
- Extract target, instrument, secondary target
- Preserve the player's utterance
- Detect ambiguity and request clarification

The interpreter may NOT:
- Assert object existence or visibility
- Determine object properties
- Assign check difficulty
- Decide success or failure
- Create consequences
- Modify Projection
- Choose actions for the player

### 2. ActionIntentCommand

A compositional transport entity replacing the old MoveCommand/GiveCommand
union. Contains `mode`, `operation`, `target`, `instrument`, `manner`,
`goal`, `utterance`, `rawText`, and `interpretation` metadata.

Rules remain static and deterministic. The interpreter maps infinite linguistic
variety to a finite set of physical operations (`observe`, `listen`, `touch`,
`approach`, `enter`, `apply_force`, `heat`, `cool`, `take`, `place`, `use`,
`create_mark`, `speak`, `call`, `wait`, `unknown`).

### 3. Critical Checks

Uncertain outcomes with meaningful stakes use a dice-based critical check
system:

```
Rule → CriticalCheckRequested
  → Infrastructure Dice Roller (Math.random ONCE)
    → CriticalCheckRolled
      → Deterministic resolution Rule
        → CriticalCheckResolved + world effects
```

Rules:
- A check fires only when outcome is uncertain AND stakes are meaningful
- Difficulty is computed from world facts (no LLM, no browser)
- Roll is recorded in Event Log; replay uses recorded result
- Retry with same idempotency key does not re-roll
- Pending checks auto-resolve after restart
- No rerolling allowed

Modifiers come only from world circumstances (heated loops, darkness, smoke),
never from character stats, levels, or classes.

### 4. World Objects & Locations

The world gains typed physical objects with material, integrity, temperature,
and location-based observation. Locations replace the bare grid coordinate
system for player-facing display.

### 5. Clarification

When confidence is low or multiple interpretations exist, the system returns
a clarification question. Clarification does not advance world time, modify
Event Log, or count as a game turn.

### 6. Response Types

Every player input resolves to one of:
- `ResolvedAction` — action processed, world changed
- `ClarificationRequired` — meaning detected but ambiguous
- `UnsupportedButUnderstood` — meaning clear but no Rule can fulfill it
- `TransportFailure` — technical error, not a game response

No technical messages (`ParseError`, `unknown command`) reach the player.

## Consequences

- New ADR document.
- `ActionIntentCommand` replaces `MoveCommand`/`GiveCommand` in intent-parser.
- New Domain Events: `ActionAttempted`, `ActionResolved`, `ActionBlocked`,
  `ActionHadNoObservableEffect`, `LocationDefined`, `PlayerLocationChanged`,
  `WorldObjectPlaced`, `ObjectObserved`, `ObjectTemperatureChanged`,
  `ObjectIntegrityChanged`, `PassageOpened`, `SoundProduced`,
  `CriticalCheckRequested`, `CriticalCheckRolled`, `CriticalCheckResolved`.
- New projection fields: `locations`, `objects`, `currentLocation`.
- New rules for interaction, heat, force, sound, movement.
- Old Tower bootstrap with 3 locations and 7 objects.
- Dice roller infrastructure in CLI.
- UI removes D-pad, adds textarea command composer.
- Backward compatibility: old MoveRequested/GiveRequested replay preserved.
