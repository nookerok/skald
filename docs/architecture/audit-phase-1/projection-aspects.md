# Projection Aspects — Phase 1 Audit

> Generated: 2026-08-05
> Source: `packages/world/src/projection.ts`

---

## ReadonlyWorld Interface

```typescript
export interface ReadonlyWorld {
  // Grid world (Iteration 0–14)
  readonly player: { readonly x: number; readonly y: number };
  readonly walls: ReadonlySet<string>;

  // Behavioral scoring
  readonly observations: ReadonlyMap<string, number>;

  // Consequence framework
  readonly consequences: ReadonlyMap<string, Consequence>;
  readonly firedConsequences: ReadonlyMap<string, FiredConsequence>;

  // Situations
  readonly activeSituations: ReadonlyMap<string, ActiveSituation>;
  readonly burnedTrees: number;

  // Relations
  readonly relations: ReadonlyMap<string, RelationEdge>;

  // Heat
  readonly heatSources: ReadonlyMap<string, HeatSource>;
  readonly heatMap: ReadonlyMap<string, number>;

  // Action budget
  readonly lastActionTick: number;

  // Offline strategy
  readonly strategy: readonly StrategyEntry[];

  // Metadata
  readonly eventNumber: number;
  readonly time: number;

  // Iteration 15 — Objects & Locations
  readonly objects: ReadonlyMap<string, WorldObject>;
  readonly locations: ReadonlyMap<string, Location>;
  readonly currentLocationId: string;

  // Iteration 15 — Pending critical checks
  readonly pendingChecks: ReadonlyMap<string, CriticalCheckState>;

  // World Interaction Model — generic entities
  readonly entities: ReadonlyMap<string, Entity>;

  // Spatial Movement (ADR-0015)
  readonly journeys: ReadonlyMap<string, JourneyState>;
  readonly activeJourneyId: string | null;
}
```

---

## Aspect Ownership Matrix

| Аспект | Тип | Создаёт | Изменяет | Читают | Владелец | Нарушение DAG-4? |
|---|---|---|---|---|---|---|
| `player` | координаты | `physics.movement` (MovementSucceeded) | — | `observations.risk_taker`, `observations.wall_caution`, `observations.edge_awareness`, `observation` builder, `target-resolver`, `game-shell` | **Movement** | ⚠️ `journey.start` читает для PlayerLocationChanged, но не изменяет |
| `walls` | Set | Bootstrap (`WorldObjectPlaced`) | — | `physics.movement` | **World Setup** | ✅ |
| `observations` | Map<string, number> | `observations.*` ×5 | — | `situations.start`, `player.strategy`, `consequences.repercussion`, `observation` builder | **Player Behavior Scoring** | ⚠️ `player.strategy` читает напрямую; это read, не write |
| `consequences` | Map | `consequences.repercussion` | `consequences.expire` (delete) | `consequences.fire`, `duration-check` (read for traveling block) | **Consequence Framework** | ⚠️ `duration-check` читает `activeJourneyId`, не `consequences` |
| `firedConsequences` | Map | `consequences.fire` | — | — | **Consequence Framework** | ✅ |
| `activeSituations` | Map | `situations.start` | `situations.end` (delete) | `forestFire.spread`, `game-shell`, `observer-threads` | **Situation/Fire** | ✅ |
| `burnedTrees` | number | `forestFire.spread` | — | `forestFire.spread` (read для expected) | **Fire** | ✅ |
| `relations` | Map | `relations.give` | — | — | **Relations** | ✅ (но слабый владелец — только 1 Rule) |
| `heatSources` | Map | `HeatSourcePlaced` (bootstrap) | — | `heat.spread` | **Heat** | ✅ |
| `heatMap` | Map | `heat.spread` (HeatRadiated) | — | — | **Heat** | ✅ |
| `lastActionTick` | number | `duration-check` | `physics.movement`, `interaction.*`, `perception.observe`, `listening.listen`, `journey.start`, `checks.outcome`, `relations.give` (все через разные events) | `duration-check` | **Action Budget / duration-check** | ⚠️ Множество Rules пишут через projection.apply, но единственный логический владелец — `duration-check` |
| `strategy` | array | `StrategySet` (bootstrap) | — | `player.strategy` | **Offline Strategy** | ✅ |
| `eventNumber` | number | Projection.apply (все events) | — | — | **Infrastructure** | ✅ |
| `time` | number | TickPassed | — | многие | **Time / Simulation Core** | ✅ |
| `objects` | Map | `WorldObjectPlaced` | `ObjectTemperatureChanged`, `ObjectIntegrityChanged`, `PassageOpened` (via `objects/projector.ts`) | `interaction.*`, `perception.observe`, `listening.listen`, `checks.outcome` | **Objects** | ⚠️ `interaction.*` читают, но projector владеет mutations |
| `locations` | Map | `LocationDefined` | `PlayerLocationChanged` (via `objects/projector.ts`) | `interaction.*`, `perception.observe`, `listening.listen`, `journey.validate` | **Objects/World Setup** | ✅ |
| `currentLocationId` | string | `PlayerLocationChanged` | — | `interaction.*`, `perception.observe`, `listening.listen`, `journey.validate` | **Movement (Location-based)** | ✅ |
| `pendingChecks` | Map | `CriticalCheckRequested` | `CriticalCheckRolled`, `CriticalCheckResolved` (delete) | — | **Critical Checks** | ✅ |
| `entities` | Map | `ObjectPlaced` | — | `perception.observe`, `interaction.resolve_law`, `target-resolver` | **Entity System** | ✅ |
| `journeys` | Map | `JourneyStarted` | `JourneyCompleted` | — | **Journey** | ✅ |
| `activeJourneyId` | string \| null | `JourneyStarted` | `JourneyCompleted` | `duration-check` | **Journey** | ✅ |

---

## Важное наблюдение: Spatial Projection

**Spatial аспекты НЕ входят в `ReadonlyWorld`.**

В `river-level.ts` и `crossing-condition.ts` используется type-cast:
```typescript
const spatial = (world as unknown as { spatial?: { ... } }).spatial;
```

Это означает, что `SpatialProjector` живёт **вне** `WorldProjector` и присоединяется к ReadonlyWorld динамически. Это архитектурный гибрид:

| Аспект | Где живёт | Как доступен в Rules |
|---|---|---|
| `riverProcesses` | `SpatialProjector` | Через `world.spatial` (type-cast) |
| `riverStates` | `SpatialProjector` | Через `world.spatial` (type-cast) |
| `crossingDefinitions` | `SpatialProjector` | Через `world.spatial` (type-cast) |
| `crossingStates` | `SpatialProjector` | Через `world.spatial` (type-cast) |

**Оценка:** Это нарушение чистоты `ReadonlyWorld` интерфейса. Spatial projection должна быть либо:
1. Полноценным аспектом `ReadonlyWorld` (с explicit полем `spatial`), или
2. Передаваться в Rules через отдельный параметр (как сейчас `createJourneyValidationRule(spatial, observerMap)`).

Текущий подход (type-cast) делает типизацию хрупкой и скрывает зависимости.

---

## Authority Violations (DAG-4)

### Minor: `lastActionTick` множественные writers
Логический владелец — `duration-check` (validation gate). Но `lastActionTick` обновляется в `projection.ts` через `apply()` для многих event types:
- `MovementSucceeded`, `MovementBlocked`
- `ActionBlocked`, `ActionResolved`
- `ObjectObserved`, `EntityExamined`
- `SoundObserved`, `ActionHadNoObservableEffect`
- `RelationChanged`, `ConsequenceFired`
- `JourneyStarted`, `JourneyBlocked`

**Вердикт:** Не нарушение. `projection.ts` — единый projector, он является владельцем всех аспектов. Rules не пишут напрямую в Projection.

### Minor: `duration-check` читает `activeJourneyId`
`duration-check` — validation gate. Он читает `activeJourneyId` для блокировки действий во время путешествия. Это допустимо: validation может читать состояние мира.

### Существенное: Spatial type-cast
Rules `riverLevelProcess` и `crossingCondition` используют `as unknown as` для доступа к `spatial`. Это скрытая зависимость, не отражённая в типе `ReadonlyWorld`.

**Рекомендация:** Добавить `spatial?: SpatialWorldProjection` в `ReadonlyWorld` или передавать spatial через Rule factory (как `createJourneyValidationRule`).
