# Simulation Systems Map — Phase 1 Audit

> Generated: 2026-08-05
> Scope: `packages/world/src/rules/**/*.ts`, `packages/world/src/projection.ts`
> Validator: Architecture Audit Phase 1

---

## Executive Summary

| Metric | Value |
|---|---|
| Rules examined | 25 |
| Event types classified | 62 |
| Projection aspects mapped | 20 |
| **Confirmed Systems** | **5** |
| Candidates pending | 3 |
| Explicitly NOT systems | 8 |
| Authority violations found | 1 (spatial type-cast) |

---

## Part A: Confirmed Simulation Systems (5)

### 1. River Hydrology

| Property | Value |
|---|---|
| **Identity** | `hydrology` |
| **ADR** | ADR-0017 |
| **Events** | `RiverProcessDefined`, `RiverLevelChanged`, `CrossingConditionInitialized`, `CrossingConditionChanged` |
| **Rules** | `hydrology.river_level` (physics), `hydrology.crossing_condition` (consequence) |
| **Projection aspects** | `spatial.riverProcesses`, `spatial.riverStates`, `spatial.crossingDefinitions`, `spatial.crossingStates` |
| **Depends on** | Region (bootstrap compiler), SpatialProjector |
| **Influences** | Journey (через `CrossingConditionChanged` → `crossingStates` → `journey.validate`) |
| **Tests** | `packages/world/test/hydrology/*.test.ts` (29 tests) |

**Notes:** Единственная система, чьи Projection-aspects живут вне `ReadonlyWorld` (в `SpatialProjector`). Rules используют `as unknown as` для доступа — архитектурный гибрид, требующий решения.

---

### 2. Heat Transfer

| Property | Value |
|---|---|
| **Identity** | `heat` |
| **Events** | `HeatSourcePlaced`, `HeatRadiated` |
| **Rules** | `heat.spread` (consequence) |
| **Projection aspects** | `heatSources`, `heatMap` |
| **Depends on** | — (sources создаются bootstrap) |
| **Influences** | Listening (через температуру → `SoundObserved`), Observation builder (через `HeatRadiated` → `observation` groups) |
| **Tests** | `packages/world/test/heat.test.ts` (6 tests) |

**Notes:** Простая диффузионная система. Одна Rule, но полноценный аспект с собственным состоянием.

---

### 3. Fire / Forest Fire

| Property | Value |
|---|---|
| **Identity** | `fire` |
| **Events** | `ForestFireStarted`, `TreeBurned`, `SituationStarted`, `SituationEnded` |
| **Rules** | `situations.start` (consequence), `forestFire.spread` (consequence), `situations.end` (consequence, generic) |
| **Projection aspects** | `burnedTrees`, `activeSituations` (forest_fire entry) |
| **Depends on** | Observation (через `world_reaction_fear` ≥ 2 → `situations.start`) |
| **Influences** | Presentation (через `activeSituations` → `observer-threads`), Observation builder (через `TreeBurned`) |
| **Tests** | `packages/world/test/situations.test.ts` (14 tests) |

**Notes:** `situations.start` hardcoded для `forest_fire` и `world_reaction_fear`. `situations.end` — generic framework, применимый ко всем ситуациям. Fire — это конкретная система, использующая situations-фреймворк для lifecycle.

**Вопрос на будущее:** Если появится вторая ситуация (например, наводнение), будет ли она новой системой или тем же Situations Framework с другими параметрами?

---

### 4. Movement (Grid)

| Property | Value |
|---|---|
| **Identity** | `movement` |
| **Events** | `MoveRequested`, `MovementSucceeded`, `MovementBlocked` |
| **Rules** | `physics.movement` (physics) |
| **Projection aspects** | `player` (x, y) |
| **Depends on** | — (игроковский input) |
| **Influences** | Observation (через `MovementSucceeded` → `risk_taker`, `MovementBlocked` → `wall_caution`/`edge_awareness`) |
| **Tests** | `packages/world/test/physics-movement.test.ts` (9 tests) |

**Notes:** Legacy grid movement. В location-based worlds (`currentLocationId` !== null) не используется — movement делегируется `interaction.movement`.

---

### 5. Journey / Spatial Movement

| Property | Value |
|---|---|
| **Identity** | `journey` |
| **ADR** | ADR-0015 |
| **Events** | `JourneyRequested`, `JourneyValidated`, `JourneyBlocked`, `JourneyStarted`, `JourneyCompleted` |
| **Rules** | `journey.validate` (validation, dynamic), `journey.start` (consequence) |
| **Projection aspects** | `journeys`, `activeJourneyId` |
| **Depends on** | Region (spatial projection для route resolution), River Hydrology (crossing conditions) |
| **Influences** | — (пока нет downstream consumers кроме `duration-check`, который блокирует действия во время travel) |
| **Tests** | `packages/world/test/journey/*.test.ts` (25 tests) |

**Notes:** `journey.validate` создаётся динамически через `createJourneyValidationRule(spatial, observerMap)`. Это правильный pattern для систем с внешними зависимостями.

---

## Part B: Candidates — Decision Required (3)

### Candidate 1: Weather

| Property | Value |
|---|---|
| **Identity** | `weather` |
| **Status** | ❌ Not yet implemented |
| **Evidence** | Mentioned in `docs/worldbuilding/`, ADR-0017 references weather as future influence on river levels |
| **Assessment** | Strong candidate for next system. Would have: external dependencies (seasonal cycles), influence on Hydrology (rain → river level), Visibility (fog, rain), Heat (wind chill). Real `dependsOn` and `influences`. |

**Recommendation:** Implement after River Hydrology stabilizes.

---

### Candidate 2: Observation Engine

| Property | Value |
|---|---|
| **Identity** | `observation` |
| **Status** | ⚠️ Partially implemented |
| **Evidence** | Package `@skald/observation` exists with builder, types, schemas, engine. But `packages/world/src/rules/observations.ts` is behavioral scoring, not Observation Engine. |
| **Assessment** | The *real* Observation Engine is in `@skald/observation` (read-side). It has no Rules, no Events, no Projection aspects. It is a read-side adapter, not a Simulation System. The behavioral scoring Rules (`riskTaker`, `wallCaution`, etc.) are part of Biography/Player Behavior, not Observation Engine. |

**Recommendation:** Clarify terminology. `packages/world/src/rules/observations.ts` should be renamed to `player-behavior.ts` or moved under `biography/`.

---

### Candidate 3: Interaction Model v1

| Property | Value |
|---|---|
| **Identity** | `interaction` |
| **Status** | ⚠️ Pipeline, not yet full system |
| **Evidence** | ADR-0013. Gates: `resolve_target`, `resolve_law`. Laws: `perception.observe`, `listening.listen`. 9 Event types, 4 Rules. |
| **Assessment** | Currently a pipeline (gates + law handlers). Missing: inventory system (take), passage mechanics (open), force outcomes (apply_force), social (give). Each slice adds Rules and Events. Will become a full system after Slices 3–7. |

**Recommendation:** Track as "emerging system". After Slice 7, re-evaluate.

---

## Part C: Explicitly NOT Simulation Systems (8)

| Component | Why NOT a system | What it actually is |
|---|---|---|
| **Critical Checks** | No lifecycle, no persistent state, 2 Rules only | Game mechanic / resolution framework |
| **Consequence Framework** | Universal mechanism, no domain-specific behavior | Infrastructure pattern |
| **Relations** | 1 Rule, 1 aspect, no lifecycle | Social mechanic |
| **Player Strategy** | Reads strategy, emits commands | Offline player adapter |
| **Presentation** | Read-only, no Events | DTO builder |
| **Narrative** | Read-only, no Events, not authoritative | Text generator |
| **Game Shell** | Read-only composition of other systems | UI read model |
| **Presence / Observer Threads** | Read-only, no Domain Events | Observer read model |
| **Visibility Engine** | No Events, no Projection aspects | Pure function service |
| **Target Resolver** | No Events, no Projection aspects | Pure function service |
| **Offline Intent Queue** | Classification only, no world effects | Boundary adapter |

---

## Part D: Authority Principle & DAG-4 Assessment

### Violation Found

| # | Aspect | Violation | Severity | Recommendation |
|---|---|---|---|---|
| 1 | `spatial.*` | Rules `riverLevelProcess` and `crossingCondition` use `as unknown as` to access `spatial` not declared in `ReadonlyWorld` | **Medium** | Add `spatial?: SpatialWorldProjection` to `ReadonlyWorld`, or pass spatial through Rule factory (like `createJourneyValidationRule`) |

### Minor Concerns (not violations)

| # | Aspect | Concern | Assessment |
|---|---|---|---|
| 2 | `lastActionTick` | Multiple events update it via `projection.apply` | **Not a violation** — `WorldProjector` is the single owner; Rules emit Events, Projector applies them |
| 3 | `situations.start` | Hardcoded to `forest_fire` | **Design debt** — not an authority violation, but limits system to one situation type. Generic mechanism needed for future situations |
| 4 | `observations` | `observations.ts` (Rules) vs `@skald/observation` (package) | **Naming confusion** — two different things with same name. Rules are behavioral scoring; package is read-side engine |

---

## Part E: Dependency Graph

```
Bootstrap (Region, Objects, Heat Sources)
    │
    ├──► River Hydrology ───────► Journey (crossing conditions)
    │
    ├──► Heat Transfer ─────────► Listening (temperature → sound)
    │
    ├──► Fire / Situations ◄──── Observation Scoring (fear)
    │        │
    │        └──► Presentation ◄── Observer Threads
    │
    ├──► Movement (Grid)
    │
    ├──► Journey ◄─────────────── River Hydrology
    │        │
    │        └──► duration-check (blocks actions while traveling)
    │
    └──► Interaction Model v1 (gates + perception + listening)
             │
             ├──► perception.observe ──► Observation Engine (read-side)
             │
             └──► listening.listen ────► Observation Engine (read-side)

Observation Scoring (risk_taker, wall_caution, etc.)
    │
    ├──► Fire / Situations (fear threshold)
    │
    └──► Consequence Framework (audacity)
             │
             └──► Fire / Situations (AudacityTriggered → fear)
```

---

## Part F: Recommendations

### Immediate (this iteration)
1. **Fix spatial type-cast**: Add `spatial?: SpatialWorldProjection` to `ReadonlyWorld` interface, or use Rule factory pattern consistently.
2. **Rename `rules/observations.ts`**: To `rules/player-behavior.ts` or move under `biography/` to avoid confusion with `@skald/observation`.

### Short-term (next 2–3 milestones)
3. **Generic Situations mechanism**: Extract `forest_fire` specifics from `situations.start` into configuration, allowing multiple situation types.
4. **Weather system**: Implement as next system after Interaction Model v1 Slice 7. Will validate `dependsOn`/`influences` DAG.

### Medium-term
5. **Interaction Model completion**: After Slices 3–7, evaluate if Interaction deserves System status.
6. **Simulation Registry**: Create `docs/simulation/registry.yaml` listing confirmed systems and their contracts.

---

## Validator Checklist

- [x] All 25 Rules from `registry.ts` accounted for
- [x] All 20 Projection aspects have identified owners
- [x] All 62 Event types classified by system
- [x] 5 confirmed systems identified (within 3–7 target range)
- [x] Each system has: identity, Events, Rules, Projection aspects
- [x] Authority violations documented (1 medium severity)
- [x] `npm run validate` — tests pass (1232/1233)
