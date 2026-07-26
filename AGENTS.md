# Living World — Agent Instructions

Симуляция живого мира на Event Sourcing. Игрок не изучает готовую RPG-систему —
он открывает законы мира, а мир реагирует на его поведение. Полное обоснование
и история решений — `docs/ARCHITECTURE.md`. Этот файл — исполняемая выжимка:
если код противоречит этому файлу, код неправ.

## Stack

- TypeScript, Node.js.
- Тесты: любой стандартный раннер (vitest/jest) — зафиксировать при первой итерации.
- Пакетный менеджер: npm.

## Workspace boundary

Разрешённые top-level пакеты — и только они:

```
packages/
  event-bus/
  rule-engine/
  world/
  intent-parser/
  cli/
```

Новый top-level пакет не создаётся никогда без пересмотра этого файла.
Consequences, Situations, Observations, Biography, Read Models — всё это
реализуется внутри `world/` и `rule-engine/`, не как отдельные пакеты.

## Инварианты (нарушать нельзя без пересмотра всего документа)

1. **Event Log — единственный источник истины**, append-only. Записанные
   события никогда не изменяются и не удаляются.
2. **Projection Purity.** World Projection полностью вычисляется из Event
   Log и не хранит ничего, чего там нет. Обязательный CI-тест: удалить
   Projection → replay всего Event Log → результат идентичен удалённому.
3. **Rule — чистая и детерминированная функция:**
   `(Event, ReadonlyWorld) → Event[]`.
   Запрещено внутри Rule: `Date.now()`, `Math.random()`, UUID на лету, сеть,
   вызов LLM, любое глобальное изменяемое состояние. Rule эмитит только
   новые события — не может вернуть/изменить входящий или уже существующий
   Event.
4. **LLM/Narrative никогда не авторитетны.** Не создают факты, только
   описывают уже случившиеся события. Не принимают решений — ни за мир, ни
   за NPC, ни за персонажа игрока в его отсутствие.
5. **Никакой runtime-генерации правил в v1.** Прогресс — это активация уже
   существующих, заранее зарегистрированных правил, не написание новых.
6. **`NPC.decide()` запрещён** — и для NPC, и для персонажа игрока, когда
   игрок офлайн (см. Player Strategy ниже).
7. **Command ≠ Event.** `PlayerCommand` не пишется в Event Log и не
   поступает в RuleEngine напрямую. Только Domain Events — свершившиеся
   факты — попадают в канонический Event Log.
8. **Snapshot-консистентность.** Во время обработки одного Event все Rules
   читают один и тот же snapshot Projection. Projection обновляется только
   после того, как все правила для этого Event отработали.

## Запрещённые концепции

`Spell`, `MagicSchool`, `Mana`, `Cooldown`, `Class`, `XP`, `SkillTree`,
`Talent`, `QuestManager`, `DialogueTree`, `NPC.decide()`, `LevelSystem`.

Если тянет добавить что-то из этого списка — значит, для задачи ещё не
найдено выражение через Event/Rule/Consequence. Искать его, а не обходить
список.

## Event Flow

```
Player
  → PlayerCommand (не сохраняется; например MoveCommand, GiveCommand)
  → Command Handler (infra, НЕ Rule; без доступа к World;
     только структурная валидация — известный тип, обязательные поля)
      ├─ невалидна → CommandRejected (Domain Event)
      └─ валидна   → <Action>Requested (первый Domain Event, например MoveRequested)
  → RuleEngine (очередь: dequeue → run rules по фазам → enqueue → repeat)
  → Rules по фазам: Validation → Physics → Consequence → Notification
  → новые Domain Events (MovementSucceeded / MovementBlocked / ActionRejected / ...)
  → World Projection (обновляется одним snapshot-update после каждого Event)
  → Narrative (только описывает, не влияет на мир)
```

**Команды игрока (v2):** `move <direction>` (MoveCommand) и
`give <relation> to <target>` (GiveCommand, контракт зафиксирован в
Iteration 6: синтаксис `give help|respect|fear to <target_id>`, 4 слова,
`IntentParser` не делает fuzzy matching). `wait` / `advance N` — REPL
meta-команды, продвигающие время без player command (не PlayerCommand, не
Event — только `TickPassed{playerOffline:true}`).

**Validation gate (зафиксировано в Iteration 7):** текущий RuleEngine не
поддерживает short-circuit фаз. Чтобы для одного `<Action>Requested` ровно
одно правило было владельцем авторитетного исхода (§12.3), validation gate
эмитит pass-through event: `ActionValidated` (для move) или `GiveValidated`
(для give) — пока два типа, по числу действий игрока; конвенция на будущее:
`<Action>Validated` per action-kind, владелец `duration_check` переводит
Request→Validated, downstream rule слушает Validated. Правило
`simulation.duration_check` (фаза Validation) — единственный владелец
`MoveRequested`/`GiveRequested`: эмитит
`ActionValidated`/`GiveValidated` (pass, несёт `originalPayload` вниз по
pipeline) или `ActionRejected{reason:"insufficient_time"}` (fail —
`lastActionTick === event.timestamp`). Downstream rules (`physics.movement`,
`relations.give`) слушают validated-event, а не Requested-event. Таким
образом ровно один авторитетный исход на каждый event в цепочке, без
engine-level short-circuit.

Правила фаз:
- Фаза определяет только порядок обработки, не даёт Rule'ам знать друг о
  друге внутри фазы. Внутри фазы порядок = порядок регистрации.
- Для одного `<Action>Requested` только одно правило в фазе может быть
  "владельцем" авторитетного исхода (например, либо `MovementSucceeded`,
  либо `MovementBlocked`, не оба). Конфликт двух авторитетных исходов —
  ошибка Rule Set, обнаруживается тестами, не runtime-приоритетом.
- Rule не имеет права предполагать, какие Events обработаны раньше него в
  очереди, кроме того, что отражено в его snapshot Projection.

## Транзакция top-level Command

Generated Events накапливаются в in-memory staged Event Log во время
обработки всей очереди, порождённой top-level Command. Коммит в
канонический Event Log и обновление canonical Projection происходят одним
атомарным батчем — только после успешного завершения всей цепочки. Ошибка
Rule (исключение) откатывает всё целиком, ничего не коммитится.

**Известное уточнение (зафиксировано по итогам Iteration 0, не задача для
кода):** `WorldProjector` обновляет canonical Projection **прямым
синхронным вызовом** со стороны `RuleEngine` как часть атомарного коммита
батча — НЕ через `EventBus.subscribe()`. Причина: generic pub/sub не даёт
гарантии, что Projection обновится синхронно и ровно один раз сразу после
коммита canonical Event Log (несколько произвольных подписчиков, порядок и
момент вызова не гарантированы) — а это ровно то, что требует §12.1–12.2.
`EventBus.subscribe()` остаётся доступен для неавторитетных
read-only-потребителей (CLI-printer, будущий Narrative Adapter), которые не
участвуют в каноническом пайплайне и которым не нужна гарантия
синхронности с коммитом. `WorldProjector` таким потребителем не является и
не должен переводиться на `subscribe()` ни в одной из будущих итераций.

Для Iteration 1 и далее: если понадобится ещё один read-only-потребитель
всех событий (например, лог для отладки) — использовать
`EventBus.subscribeAll(handler)` (wildcard-подписка на все закоммиченные
события), а не переиспользовать канал `WorldProjector`.

**Идемпотентность (зафиксировано в Iteration 7, §9.5):** каждая внешняя
команда несёт клиентский `idempotencyKey`; входная граница (CLI/API)
проверяет наличие ключа перед обработкой и игнорирует дубликат. Это
infra-фича в `cli/` (`IdempotencyCache`), НЕ Rule, НЕ Event — не путать с
`ActionRejected` (игровой отказ) или `CommandRejected` (структурная
ошибка).

## Event envelope

```ts
Event {
  eventId: string
  type: string
  schemaVersion: number
  payload: unknown
  timestamp: number        // world.time, не Date.now()
  correlationId: string
  causationId: string | null   // eventId причины; графы строятся запросом, не списком потомков
}
```

Новые поля — только опциональные/с deterministic default. Breaking change —
через явный upcaster, пишется только когда реально понадобится.

## Domain vs Operational

Канонический Event Log (тот, что реплеится в Projection) содержит только
Domain Events — всё, что обрабатывается RuleEngine и/или влияет на
Projection (`MovementSucceeded`, `TickPassed`, `RandomNumberGenerated`,
`ActionRejected` и т.д.). Чисто технические записи (`ProjectionRebuilt`,
`SnapshotCreated`) идут в отдельный неавторитетный Operational Log — не
участвует в replay, не проходит через RuleEngine.

## Rule Registry

```ts
RuleRegistry.register({
  id: string
  phase: "validation" | "physics" | "consequence" | "notification"
  listens: EventType[]
  produces: EventType[]   // декларативно, не enforced в v1
})
```

Все Rules регистрируются при старте. Динамическая регистрация запрещена.

## World Projection — что в ней живёт

Всё — производные данные из Event Log, ничего не хранится отдельно:

- Entities (включая позицию игрока, стены — на MVP-0 это всё)
- Consequences — плоские данные с `expiresAt`; удаление через правило
  `consequences.expire` на `TickPassed`, эмитящее `ConsequenceExpired`
- Observations — счётчики (`risk_taken`, `mercy`, ...), обновляются через
  `ObservationUpdated`, интерпретация — задача Narrative, не World
- Situations — активные/неактивные помечаются в `world.activeSituations`
  (`Map<situationId, ActiveSituation>`); сам Rule проверяет своё присутствие
  там при получении `TickPassed` (решение §10 вопроса №2: вариант (а) —
  проверка внутри Rule, RuleEngine не фильтрует). Завершение Situation —
  duration-based: `SituationStarted` несёт `{ startedAt, duration }`;
  правило `situations.end` на `TickPassed` эмитит `SituationEnded` для всех
  `startedAt + duration ≤ now` — **переиспользование паттерна
  `consequences.expire`**, не внешний «магический» `RainStarted` без
  источника (зафиксировано в Iteration 4).
- Heat — `heatSources` (статические источники) и `heatMap` (накопленное
  тепло по клеткам) в Projection; закон `heat.spread` на `TickPassed`
  эмитит `HeatRadiated` — единый физический закон (§5.6 Magic → World Law),
  не магия; применим к костру, лаве, телу — один и тот же law.
- Relations — рёбра `player→target: {kind, value}` в Projection (`Map`);
  изменяются через `RelationChanged{from, to, kind, delta}`; без
  `RelationshipManager` (§5.11).
- `player.strategy` — декларативная таблица `условие → действие` (массив
  `StrategyEntry`); выводима из `StrategySet` event (bootstrap); предикаты и
  действия — compile-time registered в `packages/world/src/strategy-registry.ts`
  (конечный набор, не расширяется в runtime).
- `lastActionTick` — целое, обновляется на `MovementSucceeded`/
  `MovementBlocked`/`RelationChanged`; используется
  `simulation.duration_check` (§5.12).
- `eventNumber` (техническая версия) отдельно от `world.time` (игровое время)

Read Models (`Player`, `Economy`, `Village` и т.п.) могут быть
специализированными срезами Projection — каждый по-прежнему полностью
выводим из Event Log, ни один не самостоятельный источник истины.

## Time

Нет системных часов внутри Rules. Время — только через события
(`TickPassed`, `DayEnded`, `SeasonChanged`) с явной дельтой игрового времени
в payload.

**Tick Policy (зафиксировано в Iteration 2):** 1 ход = 1 тик. Granularity —
целочисленный ход. `TickPassed` payload: `{ delta: 1, playerOffline?: boolean }`.
Продвигается инфраструктурой (Clock в `cli/`), не PlayerCommand, не Rule.
`world.time` растёт на `delta` за каждый `TickPassed`. TickPassed — Domain
Event (обрабатывается RuleEngine, влияет на Projection). Аналогично
`RandomNumberGenerated` (§9.1) — это infra-pushed Domain Event, а не
PlayerCommand.

`playerOffline: true` в payload `TickPassed` помечает тик как «без player
command» (продвигается REPL meta-командой `wait` / `advance N`). Это input
data в payload события, не projection state — не нарушает Projection Purity.
Rules, реагирующие на офлайн-режим (напр. `player.strategy`), читают это поле
из `event.payload`, не из `world`.

## Parser

Parser делает только синтаксическую/семантическую интерпретацию ввода.
Никогда не принимает игровых решений и не разрешает неоднозначность,
требующую знания мира — это остаётся за Rules после появления Domain Event,
или за уточняющим вопросом пользователю. Правило действует и для будущего
NLP/LLM-парсера.

## Player Strategy (персонаж без игрока)

Не автономный агент. Конечная декларативная таблица `условие → действие` из
заранее зарегистрированного набора предикатов/действий, одобренная игроком,
оцениваемая обычным Rule на `TickPassed` при `PlayerOffline`. LLM не
оценивает условия в моменте ("опасно ли сейчас") — только детерминированный
Rule над Projection.

**Реализация (зафиксировано в Iteration 8):** стратегия хранится в
`world.player.strategy` (массив `StrategyEntry`), выводима из `StrategySet`
event (bootstrap). Предикаты — функции `(ReadonlyWorld) => boolean`,
действия — функции, возвращающие intent (`move`/`give`/`idle`); оба набора
compile-time registered в `packages/world/src/strategy-registry.ts`
(конечный, не расширяется в runtime). Rule `player.strategy` на
`TickPassed{playerOffline:true}` итерирует strategy, для первого
сработавшего предиката генерирует `MoveRequested`/`GiveRequested` — которые
проходят через полный pipeline (validation → physics → consequence). НИКАКОЙ
LLM в условиях — жёсткое ограничение §5.8 (равносильно запрету `NPC.decide()`).

## MVP-0 — единственная задача первой итерации

> **Статус (по итогам Iteration 11.1):** v2 архитектура завершена. 16 рабочих
> правил, 301 тест (+1 opt-in skip). Все сознательно отложенные v2-блоки
> (§5 ARCHITECTURE.md) реализованы: Consequences (Iter 2-3), Biography (Iter 5),
> Situations (Iter 4), Heat Law (Iter 6), Relations (Iter 6), Time Budget
> (Iter 7), Idempotency (Iter 7), Player Strategy (Iter 8).
> Narrative Adapter v0 (шаблонный, Iter 9) и v1 (LLM, Iter 10) реализованы.
> HTTP сервер + SQLite persistence + systemd deployment (Iter 11).
> v3+ направления (Runtime Rule Synthesis, распределённый RuleEngine,
> Biography pruning) сознательно отложены (ARCHITECTURE.md §11).

Цель: не игра, не магия, не NPC — рабочий цикл событий целиком.

Реализовать:
- `EventBus`: `append()`, `publish()`, `subscribe()`, `query()`.
- `IntentParser`: только `move north/south/east/west`, без NLP.
- `Command Handler`: минимальная структурная валидация → `MoveRequested`.
- `RuleEngine`: очередь без рекурсии.
- `World Projection`: только позиция игрока и стены.
- Правило `physics.wall_block` (фаза Physics): `MoveRequested` → если стена,
  `MovementBlocked`, иначе `MovementSucceeded`.
- `CLI`: REPL, печатает события и текущую позицию.
- Тесты: publish/subscribe, parser, wall blocks/succeeds, projection
  update, очередь до опустошения.

Не реализовывать на этом шаге: магию, NPC, Consequences, Situations,
Observations, Biography, Economy, LLM.

> **NB:** этот список относился к Iteration 0 (MVP-0). К итогам Iteration 8
> все перечисленные v2-блоки — Consequences, Situations, Observations,
> Biography, Heat (вместо магии), Player Strategy — реализованы; см. статус
> выше. Economy и LLM остаются за рамками v2 (§11 ARCHITECTURE.md).

## Pull Request Codex

Каждый PR отвечает на три вопроса:
1. Какой новый закон мира появился? (не "добавил механику" — а "теперь
   тепло распространяется")
2. Какие события этот закон слушает?
3. Какие события он создаёт?

Нет ответа — PR отклоняется.

## Testing

Каждое Rule — отдельный unit-тест: `Given Event + Readonly World → Rule →
Expected Events`. Интеграционные тесты — не раньше пяти рабочих правил.

## Orange Pi Deployment Rule

Это operational rule для доставки приложения, не игровое Rule, не Domain Event и не часть RuleEngine.

1. Deployment разрешен только из чистой ветки после bash -n packages/cli/deploy/*.sh, npm run typecheck, npm test -- --run и git diff --check.
2. Сначала изменения коммитятся и отправляются в remote; на Orange Pi разрешен только fast-forward update той же ветки.
3. Installer и updater запускаются пользователем nook без внешнего sudo; runtime фиксирован на Node v22.23.1 и проверяется до изменений.
4. Перед update обязательны непустой SQLite source, online backup и PRAGMA integrity_check = ok. Любая ошибка останавливает deployment.
5. Restore выполняется только через /usr/local/bin/restore-skald.sh: integrity gate, остановка timers/services, замена БД, удаление WAL/SHM, запуск сервера, HTTP 200 health gate, запуск timers.
6. Deployment успешен только после systemctl is-active, GET /api/health, GET /api/state и одного идемпотентного игрового smoke-запроса.
7. При сбое используются сохраненные commit и backup для rollback; успешный статус до восстановления health запрещен.
8. Сервер без authentication/TLS разрешено публиковать только в доверенной LAN; интернет-доступ требует отдельного security review.
