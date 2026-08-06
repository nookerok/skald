# Rules Inventory — Phase 1 Audit

> Generated: 2026-08-05
> Source: `packages/world/src/rules/**/*.ts`, `packages/world/src/checks/**/*.ts`
> Method: direct source inspection

---

## Summary

| Metric | Value |
|---|---|
| Total Rule files | 12 |
| Total Rule definitions | 25 |
| validation phase | 4 |
| physics phase | 8 |
| consequence phase | 13 |

---

## By File

### 1. `packages/world/src/rules/duration-check.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `simulation.duration_check` | validation | ActionAttempted, MoveRequested, GiveRequested, InteractionRequested, JourneyRequested | ActionValidated, GiveValidated, InteractionTimeValidated, JourneyValidated, ActionRejected |

**Notes:** Central validation gate. Owns action budget (one action per tick). Blocks actions while traveling. Legacy compatibility for MoveRequested/GiveRequested.

---

### 2. `packages/world/src/rules/journey-validation.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `journey.validate` | validation | JourneyValidated | JourneyStarted, JourneyBlocked |

**Notes:** Created dynamically via `createJourneyValidationRule(spatial, observerMap)`. Conditional registration — only when spatial + observerMap provided. Uses `resolveJourneyRoute`.

---

### 3. `packages/world/src/rules/physics-movement.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `physics.movement` | physics | ActionValidated | MovementSucceeded, MovementBlocked |

**Notes:** Grid movement (Iteration 0–14 legacy). Skipped when `world.currentLocationId` is set (location-based worlds). Checks walls and boundaries.

---

### 4. `packages/world/src/rules/observations.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `observations.risk_taker` | consequence | MovementSucceeded | ObservationUpdated |
| `observations.wall_caution` | consequence | MovementBlocked | ObservationUpdated |
| `observations.edge_awareness` | consequence | MovementBlocked | ObservationUpdated |
| `observations.impatience` | consequence | CommandRejected | ObservationUpdated |
| `observations.world_reaction_fear` | consequence | AudacityTriggered | ObservationUpdated |

**Notes:** Player behavior scoring rules. Each maps a specific event to an observation key. Not the Observation Engine — these are behavioral trackers.

---

### 5. `packages/world/src/rules/interaction.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `interaction.observe` | physics | ActionValidated | ObjectObserved, ActionResolved, ActionHadNoObservableEffect |
| `interaction.heat` | physics | ActionValidated | ObjectTemperatureChanged, SoundProduced, ActionResolved |
| `interaction.force` | physics | ActionValidated | CriticalCheckRequested, ActionResolved, ActionHadNoObservableEffect, SoundProduced |
| `interaction.sound_reaction` | consequence | SoundProduced | ConsequenceCreated |
| `interaction.movement` | physics | ActionValidated | PlayerLocationChanged, ActionBlocked, ActionResolved |

**Notes:** Iteration 15 interaction rules. Mixed physics/consequence. `interaction.force` triggers critical checks. `interaction.sound_reaction` creates noise consequences. `interaction.movement` handles location-based movement (approach/enter).

---

### 6. `packages/world/src/rules/world-interaction.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `interaction.resolve_target` | validation | InteractionTimeValidated | TargetResolved, ActionRejected |
| `interaction.resolve_law` | validation | TargetResolved | InteractionValidated, ActionRejected |

**Notes:** ADR-0013 Interaction Model v1 gates. `resolve_target` uses shared `resolveInteractionTarget` (shared with offline classifier). `resolve_law` checks entity components against registry.

---

### 7. `packages/world/src/rules/interactions/perception.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `perception.observe` | physics | InteractionValidated | EntityExamined, ObjectObserved, ActionResolved |
| `observation.curiosity_from_examination` | consequence | EntityExamined | ObservationUpdated |

**Notes:** ADR-0013 Slice 1. `perception.observe` handles observe/inspect verbs. `examinedCuriosity` is side-effect scoring (separate from perception law).

---

### 8. `packages/world/src/rules/interactions/listening.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `listening.listen` | physics | InteractionValidated | SoundObserved, ActionHadNoObservableEffect |

**Notes:** ADR-0013 Slice 2. Deterministic: hot objects (> TEMPERATURE_HOT) crackle, everything else is honest silence. Never guesses.

---

### 9. `packages/world/src/rules/consequences.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `consequences.repercussion` | consequence | ObservationUpdated | ConsequenceCreated |
| `consequences.expire` | consequence | TickPassed | ConsequenceExpired |
| `consequences.fire` | consequence | ConsequenceExpired | ConsequenceFired, AudacityTriggered |

**Notes:** Consequence framework. `repercussion` creates audacity consequence when risk_taken ≥ 3. `expire` removes expired consequences. `fire` handles consequence expiration (audacity → AudacityTriggered).

---

### 10. `packages/world/src/rules/situations.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `situations.start` | consequence | ObservationUpdated | ForestFireStarted, SituationStarted |
| `situations.end` | consequence | TickPassed | SituationEnded |
| `forestFire.spread` | consequence | TickPassed | TreeBurned |

**Notes:** `situations.start` is hardcoded for forest_fire only (world_reaction_fear ≥ 2). `forestFire.spread` burns trees at SPREAD_INTERVAL. `situations.end` is generic — ends any situation whose duration expired.

---

### 11. `packages/world/src/rules/heat.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `heat.spread` | consequence | TickPassed | HeatRadiated |

**Notes:** Propagates heat from sources to neighbors (Moore neighborhood, intensity × 0.5 for non-self).

---

### 12. `packages/world/src/rules/relations.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `relations.give` | consequence | GiveValidated, ActionValidated | RelationChanged |

**Notes:** Legacy + new format support. Single relation rule.

---

### 13. `packages/world/src/rules/player-strategy.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `player.strategy` | consequence | TickPassed | MoveRequested, GiveRequested |

**Notes:** Offline strategy. Only fires when `playerOffline: true`. Reads `world.strategy` entries, matches predicates, emits actions.

---

### 14. `packages/world/src/rules/journey-start.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `journey.start` | consequence | JourneyStarted | TickPassed, PlayerLocationChanged, JourneyCompleted |

**Notes:** ADR-0015. Emits TickPassed × plannedTicks, then PlayerLocationChanged + JourneyCompleted.

---

### 15. `packages/world/src/rules/river-level.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `hydrology.river_level` | physics | TickPassed | RiverLevelChanged |

**Notes:** ADR-0017. Deterministic cyclic river level (rise → high → fall → low). Computes from `RiverProcessDefinition`.

---

### 16. `packages/world/src/rules/crossing-condition.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `hydrology.crossing_condition` | consequence | RiverLevelChanged | CrossingConditionChanged |

**Notes:** ADR-0017. Updates crossing states when river level changes. Classifies: open / difficult / closed.

---

### 17. `packages/world/src/checks/resolution-rule.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `checks.resolution` | consequence | CriticalCheckRolled | CriticalCheckResolved |

**Notes:** Determines outcome from roll + modifiers vs difficulty. Natural 1/20 are critical.

---

### 18. `packages/world/src/checks/outcome-rule.ts`

| Rule ID | Phase | Listens | Produces |
|---|---|---|---|
| `checks.outcome` | consequence | CriticalCheckResolved | ObjectIntegrityChanged, PassageOpened, ConsequenceCreated, ActionResolved |

**Notes:** Applies world effects from check outcome. Success → damage, failure → noise consequence.

---

## Phase Distribution

```
validation (4):  duration_check, journey.validate, interaction.resolve_target, interaction.resolve_law
physics    (8):  physics.movement, interaction.observe, interaction.heat, interaction.force,
                 interaction.movement, perception.observe, listening.listen, hydrology.river_level
consequence (13): observations.*×5, interaction.sound_reaction, consequences.*×3,
                  situations.start, situations.end, forestFire.spread, heat.spread,
                  relations.give, player.strategy, journey.start, hydrology.crossing_condition,
                  checks.resolution, checks.outcome, observation.curiosity_from_examination
```

---

## Observations

1. **Consequence phase is largest** (13/25 = 52%). This is expected — most game logic reacts to events.
2. **Validation phase is thin** (4/25 = 16%). Only gates and budget checks.
3. **Physics phase** (8/25 = 32%) handles direct world manipulation.
4. **Hardcoded coupling:** `situations.start` is hardcoded to `forest_fire` and `world_reaction_fear`. No generic situation start mechanism exists.
5. **Observation rules** (5 Rules in `observations.ts`) are behavioral trackers, not the Observation Engine. They should not be confused with `@skald/observation`.
6. **interaction.ts Rules** mix physics and consequence in one file — `interaction.sound_reaction` is consequence-phase while others are physics-phase.
