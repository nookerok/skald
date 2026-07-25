# Skald — Living World

Симуляция живого мира на Event Sourcing. Игрок не изучает заранее прописанную
RPG-систему — он открывает законы мира, а мир реагирует на его поведение и
помнит его.

Полное обоснование и история решений — в [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Исполняемая выжимка для агента/разработчика — в [`AGENTS.md`](AGENTS.md).
Если код противоречит `AGENTS.md`, код неправ.

> **Статус:** v2 архитектура завершена. 18 рабочих правил, 215 тестов,
> все сознательно отложенные v2-блоки (§5 ARCHITECTURE.md) реализованы.
> v3+ направления (Runtime Rule Synthesis, распределённый RuleEngine,
> Narrative Adapter с LLM, Biography pruning) сознательно отложены (§11).

---

## Что это

Не RPG-движок и не игра. Это **вертикально проработанный фундамент** для мира,
который существует независимо от игрока: накапливает наблюдения о его
действиях, порождает долгоживущие последствия, Live-процессы (Situations),
запускают эффекты спустя игровое время, а персонаж игрока действует по
одобренной декларативной политике, когда игрок офлайн.

Три отличительные фичи проекта (ARCHITECTURE.md §7):

1. **Consequences как долгоживущие объекты** — порождают новые события спустя
   часы или игровые месяцы после создания (`Iteration 2-3`).
2. **Биография как граф причинно-следственных связей** — строится запросом
   над Event Log, не отдельным хранилищем (`Iteration 5`).
3. **Мир, адаптирующийся к поведению игрока** — через долгоживущие процессы
   (Situations), запускаемые накопленными Observation-порогами (`Iteration 4`).

---

## Стек

- **TypeScript** strict mode, ESM, Node.js
- **npm workspaces** monorepo
- **vitest** — тест-раннер (зафиксирован в Iteration 0)
- Никаких баз данных, внешних сервисов, LLM в runtime v2 — всё in-memory,
  детерминировано, воспроизводимо из Event Log

---

## Архитектура

```
Player
  → PlayerCommand (не сохраняется; например MoveCommand)
  → Command Handler (infra, НЕ Rule; без доступа к World;
     только структурная валидация)
      ├─ невалидна → CommandRejected (Domain Event)
      └─ валидна   → <Action>Requested (первый Domain Event)
  → RuleEngine (очередь: dequeue → run rules по фазам → enqueue → repeat)
  → Rules по фазам: Validation → Physics → Consequence → Notification
  → новые Domain Events (MovementSucceeded / MovementBlocked / ...)
  → World Projection (атомарный snapshot-update после всего батча)
  → Narrative (только описывает, не влияет на мир — будущий v3+)
```

### Инварианты (AGENTS.md, нарушать нельзя)

1. **Event Log — единственный источник истины**, append-only.
2. **Projection Purity** — World Projection полностью выводится из Event Log.
   CI-тест: удалить Projection → replay → результат идентичен.
3. **Rule — чистая детерминированная функция** `(Event, ReadonlyWorld) → Event[]`.
   Запрещено: `Date.now()`, `Math.random()`, UUID на лету, сеть, LLM,
   глобальное изменяемое состояние.
4. **LLM/Narrative никогда не авторитетны** — только описывают, не решают.
5. **Никакой runtime-генерации правил** — прогресс = активация заранее
   зарегистрированных, не написание новых.
6. **`NPC.decide()` запрещён** — и для NPC, и для персонажа игрока офлайн.
7. **Command ≠ Event** — `PlayerCommand` не пишется в лог, не попадает в
   RuleEngine. Только Domain Events — свершившиеся факты.
8. **Snapshot-консистентность** — все Rules для одного event читают один
   снимок Projection, сделанный в момент dequeue.

### Запрещённые концепции

`Spell`, `MagicSchool`, `Mana`, `Cooldown`, `Class`, `XP`, `SkillTree`,
`Talent`, `QuestManager`, `DialogueTree`, `NPC.decide()`, `LevelSystem`.
Если тянет добавить что-то из этого — значит для задачи ещё не найдено
выражение через Event/Rule/Consequence.

---

## Пакеты

```
packages/
  event-bus/        DomainEvent + EventBus (append-only log + pub/sub)
  intent-parser/    parseCommand → PlayerCommand | ParseError (move / give)
  rule-engine/      RuleRegistry + RuleEngine (phased queue, staged commit,
                    MAX_ITERATIONS, snapshot-consistency)
  world/            WorldProjector, ReadonlyWorld, rules, biography,
                    strategy-registry
  cli/              createApp (composition root), runCommand, runTick, REPL
```

Новые top-level пакеты не создаются (AGENTS.md "Workspace boundary").
Расширение функциональности реализуется внутри существующих.

---

## Domain Events (v2)

| Категория | Типы |
|---|---|
| **Bootstrap** | `PlayerSpawned`, `WallPlaced`, `HeatSourcePlaced`, `StrategySet` |
| **Movement** | `MoveRequested`, `ActionValidated`, `MovementSucceeded`, `MovementBlocked` |
| **Give** | `GiveRequested`, `GiveValidated`, `RelationChanged` |
| **Validation** | `ActionRejected` (reason: `insufficient_time`) |
| **Time** | `TickPassed` (payload: `{ delta: 1, playerOffline?: boolean }`) |
| **Observations** | `ObservationUpdated` (keys: `risk_taken`, `wall_caution`, `edge_awareness`, `impatience`, `world_reaction_fear`) |
| **Consequences** | `ConsequenceCreated`, `ConsequenceExpired`, `ConsequenceFired`, `AudacityTriggered` |
| **Situations** | `SituationStarted`, `SituationEnded`, `ForestFireStarted`, `TreeBurned` |
| **Heat** | `HeatSourcePlaced`, `HeatRadiated` |
| **Command** | `CommandRejected` |

Все события несут envelope: `eventId`, `type`, `schemaVersion`, `payload`,
`timestamp` (world.time, не `Date.now()`), `correlationId`, `causationId`.

---

## Rules (18 рабочих)

### Validation (1)

- **`simulation.duration_check`** — `MoveRequested`/`GiveRequested` →
  `ActionValidated`/`GiveValidated` (pass) или `ActionRejected{insufficient_time}`
  (fail, если `lastActionTick === event.timestamp`). Реализует §5.12 —
  «одно действие за тик».

### Physics (1)

- **`physics.movement`** — `ActionValidated` → `MovementSucceeded` или
  `MovementBlocked{reason:"wall"|"boundary"}`. Единственный авторитетный
  исход для движения в фазе Physics (AGENTS §12.3).

### Consequence (16)

- **`observations.risk_taker`** — `MovementSucceeded` → `ObservationUpdated{risk_taken:+1}`
- **`observations.wall_caution`** — `MovementBlocked{wall}` → `ObservationUpdated{wall_caution:+1}`
- **`observations.edge_awareness`** — `MovementBlocked{boundary}` → `ObservationUpdated{edge_awareness:+1}`
- **`observations.impatience`** — `CommandRejected` → `ObservationUpdated{impatience:+1}`
- **`observations.world_reaction_fear`** — `AudacityTriggered` → `ObservationUpdated{world_reaction_fear:+severity}`
- **`consequences.repercussion`** — `ObservationUpdated{risk_taken}` newValue≥3 → `ConsequenceCreated{audacity, expiresAt:now+5}`
- **`consequences.expire`** — `TickPassed` → `ConsequenceExpired` для всех `expiresAt≤now`
- **`consequences.fire`** — `ConsequenceExpired` → `ConsequenceFired` + `AudacityTriggered` (для `type:"audacity"`)
- **`situations.start`** — `ObservationUpdated{world_reaction_fear}` newValue≥2 → `ForestFireStarted` + `SituationStarted{duration:8}`
- **`forest_fire.spread`** — `TickPassed` (если `forest_fire` активна) → `TreeBurned` каждые 2 тика
- **`situations.end`** — `TickPassed` → `SituationEnded` для ситуаций с `startedAt+duration≤now`
- **`relations.give`** — `GiveValidated` → `RelationChanged{player→target:+1}`
- **`heat.spread`** — `TickPassed` → `HeatRadiated` (источник + соседние клетки, intensity÷2)
- **`player.strategy`** — `TickPassed{playerOffline:true}` → `MoveRequested`/`GiveRequested` (первое сработавшее match из `world.player.strategy`)

Все правила регистрируются при старте (`createApp`), динамическая регистрация
запрещена. Порядок внутри фазы = порядок регистрации (AGENTS §9.10).

### Strategy predicates/actions (compile-time registered)

`packages/world/src/strategy-registry.ts`:

**Предикаты:** `always`, `never`, `danger_nearby`, `heat_at_player`.
**Действия:** `move_south`, `move_north`, `give_help_to_guild`, `idle`.

Конечный набор, расширяется только кодом. Без LLM в условиях — жёсткое
ограничение §5.8 (равносильно запрету `NPC.decide()`).

---

## Запуск

```bash
source ~/.nvm/nvm.sh && nvm use 22    # WSL Ubuntu (или любой Node >= 22)
npm install
npm test          # vitest run, 215 тестов
npm run typecheck # tsc --noEmit, strict

# REPL (интерактивный):
node --import tsx packages/cli/src/repl.ts
# команды: move north/south/east/west, give help to guild, wait, advance N
```

Монорепо реализовано через npm workspaces, но TypeScript собирается через
единый root `tsconfig.json` с path-алиасами `@skald/*` (project references
с刻意 не используются — они создают артефакты внутри `src/`).

---

## Демонстрационный цикл (playthrough)

```
> move north      # тик 1: риск +1
> move north      # тик 2: риск +2
> move north      # тик 3: риск +3 → ConsequenceCreated{audacity, expiresAt:8}
> move east       # тик 4
> move east       # тик 5: стена (2,0) → wall_caution+1
> wait            # тик 6 (офлайн): strategy → give help to guild
> wait            # тик 7
> wait            # тик 8: audacity истекает → ConsequenceFired → AudacityTriggered → world_reaction_fear+1
> wait            # тик 9: world_reaction_fear≥2 → ForestFireStarted → SituationStarted
> wait            # тик 10: TimerTick → TreeBurned #1
> wait            # тик 12: TreeBurned #2
...
> wait            # тик 16: situation ends (startedAt=9 + duration=8 = 17 ≤ 16? — см. вывод)
```

Демонстрируется: Observation accumulation → Consequence → expiry → fire →
Situation launch → spread → end. Полный цикл адаптации мира к поведению игрока.

---

## Testing

- **215 тестов, 16 файлов** — все зелёные.
- Каждое правило — отдельный unit-тест по шаблону `Given Event + ReadonlyWorld
  → Rule → Expected Events` (AGENTS §Testing), БЕЗ RuleEngine.
- **Projection Purity CI-тест** — обязателен: удалить Projection → replay
  всего Event Log → результат идентичен. Расширяется на каждой итерации
  (последняя — `strategy`, `lastActionTick`, `heatMap`, `relations`).
- Интеграционные тесты (с Iteration 1, когда ≥5 правил) — в
  `packages/cli/test/integration.test.ts`, доказывают связку end-to-end.

### Известное отклонение (зафиксировано в AGENTS.md)

`WorldProjector` обновляется **прямым синхронным вызовом** из `RuleEngine`
как часть atomic commit, **НЕ через `EventBus.subscribe()`**. AGENTS §12.2
требует атомарного обновления Projection вместе с log commit — generic pub/sub
этого не гарантирует. `EventBus.subscribe()` остаётся для неавторитетных
read-only потребителей (Narrative Adapter будущего, CLI-printer). Введение
`subscribeAll()` для wildcard-подписки зарезервировано для будущих read models.
Это отклонение невидимо для Projection Purity тестов.

---

## Итерации

Каждая итерация — самодостаточный вертикальный срез, не ломающий предыдущие.
Каждый коммит на отдельной ветке `iteration-N`.

| Iter | Фичи | Правил | Тестов | Ветка |
|---|---|---|---|---|
| 0 | Pipeline MVP (EventBus, RuleEngine, Projector, 1 rule) | 1 | 40 | `iteration-1` (commit base) |
| 1 | Observations + world boundaries (5 rules → интеграционные тесты разрешены) | 5 | 67 | `iteration-1` |
| 2 | Consequences + Tick Policy (зафиксирована) | 7 | 86 | `iteration-2` |
| 3 | **Consequences fire** — флагман №1 замкнут | 9 | 100 | `iteration-3` |
| 4 | **Situations** — флагман №3 заложен (heat-based processes) | 12 | 125 | `iteration-4` |
| 5 | **Biography graph** — флагман №2 завершён (read-side utility) | 12 | 147 | `iteration-5` |
| 6 | Heat law + Relations (§5.6 Magic → World Law, §5.11 Social Graph) | 15 | 177 | `iteration-6` |
| 7 | Time budget + Idempotency (§5.12, §9.5 — продакшн-готовность) | 16 | 186 | `iteration-7` |
| 8 | **Player Strategy** (§5.8 — мир без игрока) — v2 final | 18 | 215 | `iteration-8` |

`main` содержит все коммиты (fast-forward merge).

---

## Что сознательно НЕ реализовано (v3+, §11 ARCHITECTURE.md)

- **Runtime Rule Synthesis** — генерация новых правил миром в ответ на
  накопленное поведение игрока. Требует проработки безопасности (валидация,
  песочница). Запрещено в v1/v2.
- **Narrative Adapter с LLM** — read-side слой для описания событий и
  генерации диалогов. Никогда не авторитетен (§6 Authority Hierarchy).
- **Distributed / Parallel RuleEngine** — сейчас последователен и однопотен.
- **Biography pruning policy** — граф `causationId`-связей при миллионах
  событий. Решается по факту реального объёма.
- **Snapshot persistence** — кэш Projection. Оптимизация, не источник истины.

---

## Ключевые файлы

- [`AGENTS.md`](AGENTS.md) — исполняемая выжимка архитектуры (норматив).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — полное обоснование
  (инварианты, Execution Model, v2-блоки, исследовательские вопросы).
- [`packages/world/src/projection.ts`](packages/world/src/projection.ts) —
  `ReadonlyWorld`, `WorldProjector` (единственный источник нового состояния
  мира).
- [`packages/rule-engine/src/index.ts`](packages/rule-engine/src/index.ts) —
  generic, world-agnostic RuleEngine (phased queue, staged commit).
- [`packages/world/src/ids.ts`](packages/world/src/ids.ts) — детерминированная
  генерация `eventId` (no UUID, replay воспроизводит идентичные id).
- [`packages/world/src/biography.ts`](packages/world/src/biography.ts) —
  read-side utility: `buildBiographyGraph`, `findCausalChain`,
  `findCrossReference` (решает cross-tick causation gap).
- [`packages/cli/src/index.ts`](packages/cli/src/index.ts) — composition root
  (`createApp`), `runCommand`, `runTick`, `IdempotencyCache`.

---

## Лицензия

Private / personal project. No license granted.