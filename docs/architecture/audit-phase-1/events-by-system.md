# Events by System — Phase 1 Audit

> Generated: 2026-08-05
> Source: `packages/world/src/event-types.ts`

---

## Summary

| Metric | Value |
|---|---|
| Total Event types | 62 |
| Legacy (Iteration 0–14) | 21 |
| Iteration 15 (Objects & Critical Checks) | 13 |
| World Interaction Model v1 | 9 |
| Spatial Movement (ADR-0015) | 8 |
| River Hydrology (ADR-0017) | 3 |
| First Living Region | 2 |

---

## Classification by System

### 1. Movement (Grid)

| Event | Created by | Consumed by |
|---|---|---|
| `MoveRequested` | Player command | `duration-check` |
| `MovementSucceeded` | `physics.movement` | `observations.risk_taker`, `observation` builder |
| `MovementBlocked` | `physics.movement` | `observations.wall_caution`, `observations.edge_awareness`, `observation` builder |

### 2. Journey / Spatial Movement (ADR-0015)

| Event | Created by | Consumed by |
|---|---|---|
| `TravelMetadataAttached` | Bootstrap | — |
| `JourneyRequested` | Player command | `duration-check` |
| `JourneyValidated` | `duration-check` | `journey.validate` |
| `JourneyBlocked` | `journey.validate` | Projection (no-op) |
| `JourneyStarted` | `journey.validate` | `journey.start`, Projection |
| `JourneyCompleted` | `journey.start` | Projection |
| `RouteBlocked` | — (not yet implemented) | — |
| `RouteReopened` | — (not yet implemented) | — |

### 3. River Hydrology (ADR-0017)

| Event | Created by | Consumed by |
|---|---|---|
| `RiverProcessDefined` | Bootstrap / compiler | `SpatialProjector` |
| `RiverLevelChanged` | `hydrology.river_level` | `hydrology.crossing_condition`, `SpatialProjector` |
| `CrossingConditionInitialized` | Bootstrap / compiler | `SpatialProjector` |
| `CrossingConditionChanged` | `hydrology.crossing_condition` | `SpatialProjector` |

### 4. Heat Transfer

| Event | Created by | Consumed by |
|---|---|---|
| `HeatSourcePlaced` | Bootstrap | Projection |
| `HeatRadiated` | `heat.spread` | Projection |

### 5. Fire / Situations

| Event | Created by | Consumed by |
|---|---|---|
| `ForestFireStarted` | `situations.start` | `observer-threads` (via presentation) |
| `TreeBurned` | `forestFire.spread` | Projection |
| `SituationStarted` | `situations.start` | `observer-threads`, `game-shell` |
| `SituationEnded` | `situations.end` | `observer-threads`, `game-shell` |

### 6. Observation / Player Behavior Scoring

| Event | Created by | Consumed by |
|---|---|---|
| `ObservationUpdated` | `observations.*` ×5 | `situations.start`, `consequences.repercussion`, `player.strategy`, `observation` builder |
| `AudacityTriggered` | `consequences.fire` | `observations.world_reaction_fear`, `observation` builder |

### 7. Consequence Framework

| Event | Created by | Consumed by |
|---|---|---|
| `ConsequenceCreated` | `consequences.repercussion`, `interaction.sound_reaction` | Projection |
| `ConsequenceExpired` | `consequences.expire` | `consequences.fire` |
| `ConsequenceFired` | `consequences.fire` | Projection, `observation` builder |

### 8. Relations

| Event | Created by | Consumed by |
|---|---|---|
| `GiveRequested` | Player command / `player.strategy` | `duration-check` |
| `GiveValidated` | `duration-check` | `relations.give` |
| `RelationChanged` | `relations.give` | Projection, `observation` builder |

### 9. Interaction Model v1 (ADR-0013)

| Event | Created by | Consumed by |
|---|---|---|
| `ObjectPlaced` | Bootstrap | Projection |
| `InteractionRequested` | Player command | `duration-check` |
| `InteractionTimeValidated` | `duration-check` | `interaction.resolve_target` |
| `TargetResolved` | `interaction.resolve_target` | `interaction.resolve_law` |
| `InteractionValidated` | `interaction.resolve_law` | `perception.observe`, `listening.listen` |
| `EntityExamined` | `perception.observe` | `observation.curiosity_from_examination`, `observation` builder |
| `SoundObserved` | `listening.listen` | `observation` builder |

### 10. Legacy Interaction (Iteration 15)

| Event | Created by | Consumed by |
|---|---|---|
| `ActionAttempted` | Player command | `duration-check` |
| `ActionValidated` | `duration-check` | `physics.movement`, `interaction.*`, `interaction.movement` |
| `ActionRejected` | `duration-check`, `interaction.resolve_target`, `interaction.resolve_law` | Presentation |
| `ActionResolved` | `interaction.observe`, `interaction.heat`, `interaction.force`, `interaction.movement`, `perception.observe`, `checks.outcome` | Presentation |
| `ActionBlocked` | `physics.movement`, `interaction.movement` | `observation` builder, Presentation |
| `ActionHadNoObservableEffect` | `interaction.observe`, `interaction.force`, `listening.listen` | Presentation |
| `LocationDefined` | Bootstrap | `objects/projector` |
| `PlayerLocationChanged` | `interaction.movement`, `journey.start` | `objects/projector`, `observer-map` |
| `WorldObjectPlaced` | Bootstrap | `objects/projector` |
| `ObjectObserved` | `interaction.observe`, `perception.observe` | `observation` builder, Projection |
| `ObjectTemperatureChanged` | `interaction.heat` | `objects/projector` |
| `ObjectIntegrityChanged` | `interaction.force`, `checks.outcome` | `objects/projector` |
| `PassageOpened` | `interaction.force`, `checks.outcome` | `objects/projector` |
| `SoundProduced` | `interaction.heat`, `interaction.force` | `interaction.sound_reaction`, `observation` builder |

### 11. Critical Checks

| Event | Created by | Consumed by |
|---|---|---|
| `CriticalCheckRequested` | `interaction.force` | Projection |
| `CriticalCheckRolled` | Player command (external) | Projection, `checks.resolution` |
| `CriticalCheckResolved` | `checks.resolution` | Projection, `checks.outcome` |

### 12. Offline Strategy

| Event | Created by | Consumed by |
|---|---|---|
| `StrategySet` | Bootstrap | Projection |
| `TickPassed` | `journey.start`, external | Множество Rules (см. ниже) |

### 13. First Living Region

| Event | Created by | Consumed by |
|---|---|---|
| `RegionDefined` | Bootstrap / compiler | `SpatialProjector` |
| `SpatialObservationRecorded` | `observer-map` | `observer-map` (rebuild) |

### 14. Legacy (Iteration 0–14)

| Event | Created by | Consumed by |
|---|---|---|
| `PlayerSpawned` | Bootstrap | — |
| `WallPlaced` | Bootstrap | — |
| `CommandRejected` | Command handler | `observations.impatience` |

---

## TickPassed Consumers

`TickPassed` — самый "шумный" Event (слушают 8+ Rules):

| Rule | Phase | Что делает |
|---|---|---|
| `simulation.duration_check` | validation | Проверяет action budget |
| `consequences.expire` | consequence | Удаляет просроченные consequences |
| `forestFire.spread` | consequence | Распространяет огонь |
| `situations.end` | consequence | Завершает истёкшие ситуации |
| `heat.spread` | consequence | Распространяет тепло |
| `player.strategy` | consequence | Офлайн-стратегия игрока |
| `hydrology.river_level` | physics | Обновляет уровень реки |
| `checks.resolution` / `checks.outcome` | consequence | Не слушают TickPassed напрямую |

**Наблюдение:** TickPassed — это "heartbeat" симуляции. Большинство систем реагируют на него для прогрессии времени.
