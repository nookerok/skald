# World Interaction Model — v0 (draft, требует ревью)

Продолжение `docs/ARCHITECTURE.md`, не замена. Описывает, как узкий фиксированный
словарь команд (`move`/`give`/`wait`/`advance`) вырастает в открытый набор
взаимодействий (`melt`, `push`, `examine`, `persuade`, ...) без нарушения ни
одного инварианта из основной конституции. Этот документ — первая версия,
ожидается несколько раундов ревью перед переносом в AGENTS.md, как и было с
основной архитектурой.

## Статус

Черновик. Для первого вертикального среза `examine/perception` отдельно
согласован implementation gate ниже; остальные решения по-прежнему требуют
того же цикла ревью, что и остальная конституция.

---

## 1. Зачем это нужно

Текущая модель: каждое новое действие — новый `PlayerCommand` + новый `Rule`
с нуля (`MoveCommand`/`physics.movement`, `GiveCommand`/`relations.give`).
Работает, но линейно растёт: N действий = N наборов Command/Rule/Event с нуля,
классическая ловушка RPG-движков.

Цель: игрок формулирует намерение свободно ("расплавить замок"), мир
сопоставляет его с уже существующими законами (Heat, Force, Light, ...),
применёнными к конкретной цели — вместо того чтобы для каждой комбинации
глагол+цель писать отдельный Rule.

## 2. Терминология

```
IntentCommand → InteractionRequested → InteractionTimeValidated → TargetResolved → InteractionValidated → Domain Events
```

- **Intent** — то, что хочет игрок. Существует как расширение уже принятой
  философии (§2.4 ARCHITECTURE.md: "игрок описывает намерение, не выбирает
  способность"). На уровне данных — `IntentCommand`, новый вариант
  `PlayerCommand` (наравне с `MoveCommand`/`GiveCommand`), не их замена.
- **Interaction** — не новая архитектурная сущность и не новый тип объекта.
  Это имя для всей цепочки обработки одного `IntentCommand` от первого
  Domain Event до финального исхода. Инварианты Interaction (см. §6) —
  переформулировка уже существующих инвариантов Command/Event/Rule
  применительно к этой цепочке, не новые правила.
- **Law** — логическая группировка Rule по физическому или социальному
  принципу (`rules/heat/*`, `rules/force/*`). Law не имеет собственного
  жизненного цикла, интерфейса исполнения или отдельного Registry — это
  namespace, не архитектурный уровень поверх Rule Registry. `Rule`
  остаётся единственным исполняемым контрактом
  `(Event, ReadonlyWorld) → Event[]`.
- **Gate Event** — подкатегория Domain Event (не новая категория Event Log,
  см. §9.3 ARCHITECTURE.md): **Domain Event, который фиксирует успешное
  прохождение архитектурной контрольной точки. Он может не описывать
  изменение мира непосредственно, но является частью наблюдаемой доменной
  истории, так как влияет на дальнейшее применение Rules, Replay и
  Projection.** Примеры уже в проекте: `ActionValidated`/`GiveValidated`
  (Iteration 7); новые примеры этого документа: `TargetResolved`/
  `InteractionValidated`. Остаётся каноническим Domain Event по уже
  действующему критерию §9.3, просто Narrative Adapter не обязан иметь для
  него шаблон. Не выносится в отдельный internal/non-canonical лог — это
  создало бы прецедент, ретроактивно противоречащий уже реализованному
  `ActionValidated`/`GiveValidated`.

Явно избегаем слова "Intent" в именах Domain Events (см. §9.9
ARCHITECTURE.md, почему `IntentCreated` был отклонён ранее) — только на
Command-стороне. `InteractionRequested` сохраняет то же имя (симметрично
`MoveRequested`/`GiveRequested` — оба уже означают "запрос, не факт мира",
переименование создало бы асимметрию без выгоды).

## 3. Data shapes

```ts
// Command-side, никогда не пишется в Event Log
interface IntentCommand {
  type: "IntentCommand"
  verb: string          // из конечного реестра, см. §5
  object: string        // как игрок назвал цель (текст, не EntityId — резолвится Rule'ом)
  instrument?: string
  location?: string
  modifiers?: string[]
}
```

Component-based модель Entity вместо property bag (устраняет риск
нетипизированного ECS):

```ts
interface Entity {
  id: EntityId
  components: {
    material?: MaterialComponent      // { kind: "iron" | "wood" | ... }
    thermal?: ThermalComponent        // { temperature: number, meltingPoint?: number }
    physical?: PhysicalComponent      // { weight: number, intact: boolean }
    relation?: RelationComponent      // уже существует как Relation Edges (§5.11)
    inventory?: InventoryComponent
  }
}
```

Rule декларирует, каким компонентам он соответствует (расширение `produces`
из §12.6 ARCHITECTURE.md, не новый Registry) — правило `heat.melting`
регистрируется с пометкой "применимо к Entity с `thermal` + `material`".

**Ограничение (снимает риск дрейфа в нетипизированный ECS):** Components —
типизированные доменные аспекты Entity, заранее определённый конечный набор
(`MaterialComponent`, `ThermalComponent`, `PhysicalComponent`,
`RelationComponent`, `InventoryComponent`, ...), а не универсальная
ECS-модель. Rules не могут динамически создавать или удалять типы
компонентов во время выполнения — новый тип компонента добавляется тем же
процессом, что новый Domain Event (правка кода, ревью, не runtime).

## 4. Pipeline — цепочка Validation Gate, без специального механизма Resolver

Ключевое решение: разрешение цели и применимости закона — это **обычные
Validation-phase Rules**, использующие уже принятый паттерн Validation Gate
(§5.12 ARCHITECTURE.md, `simulation.duration_check` → `ActionValidated`), не
новый инфраструктурный компонент.

```
Player → IntentCommand (не хранится)
  → Command Handler (структурная валидация: известен ли verb, есть ли object)
      ├─ невалидна → CommandRejected
      └─ валидна   → InteractionRequested (первый Domain Event)

  → Rule "simulation.duration_check" (фаза Validation, ЕДИНСТВЕННЫЙ
     владелец InteractionRequested): проверяет action budget
      ├─ времени нет → ActionRejected(reason: "insufficient_time")
      └─ есть время → InteractionTimeValidated (pass-through)

  → Rule "interaction.resolve_target" (фаза Validation, ЕДИНСТВЕННЫЙ
     владелец InteractionTimeValidated): читает ReadonlyWorld, ищет Entity
     рядом/видимую, соответствующую object
      ├─ не найдена → ActionRejected(reason: "no_such_target")
      └─ найдена    → TargetResolved (pass-through, несёт entityId + verb + modifiers)

  → Rule "interaction.resolve_law" (фаза Validation, ЕДИНСТВЕННЫЙ владелец
     TargetResolved): смотрит verb + компоненты найденной Entity против
     interaction-registry.ts (см. §5)
      ├─ не применимо → ActionRejected(reason: "not_applicable")
      └─ применимо    → InteractionValidated (pass-through, несёт закон + Entity)

  → downstream Law rules (фазы Physics/Consequence, слушают
     InteractionValidated, финальные владельцы исхода) → реальные Domain
     Events (`MeltingStarted`, `ObjectIgnited`, ...)

  → World Projection → Narrative
```

Никакого "Intent Resolver" как отдельного механизма не существует — это
такая же очередь событий, что и всегда (RuleEngine ничего не знает об
Interaction как о концепции, видит только очередной Event).

## 5. `interaction-registry.ts` — конечная compile-time таблица

Тот же принцип, что `strategy-registry.ts` (§5.8 ARCHITECTURE.md): конечный,
зарегистрированный на старте набор, не runtime-генерация.

```ts
interactionRegistry.register({
  verb: "melt",
  requiresComponents: ["thermal", "material"],
  law: "heat",   // namespace/label, НЕ конкретный исход — см. §6 Law
})
```

**Важно:** Registry не знает и не должен знать `producesEvent` или любой
другой конкретный исход. Это была бы утечка доменной логики в диспетчер —
Registry отвечает только "какой Law применим", а какой именно Domain Event
получится (`MeltingStarted` / `NothingHappened` / `ObjectDestroyed`) —
решает конкретное Rule внутри `rules/heat/*` в рантайме, читая состояние
Entity. `InteractionValidated` несёт `{ law: "heat", entityId, verb,
modifiers }`; Rules внутри `rules/heat/*` сами фильтруют по `law` в теле
правила (или через `listens`, если это станет узким местом — деталь
реализации, не архитектурное решение).

**Поле `law` — часть доменной модели, не технический идентификатор
Registry.** То, что значение вычислено диспетчером (Registry), не делает
само значение инфраструктурным — так же, как `direction` в `MoveRequested`
вычислен `IntentParser`, но остаётся доменным полем. Значения `law`
(`heat`/`force`/`light`/...) — такой же стабильный, специально
курируемый словарь, как имена самих Domain Event `type`. Изменение состава
этого словаря — обычное изменение схемы, уже покрытое Event Schema
Evolution (§9.7 ARCHITECTURE.md); отдельного механизма развязки
(`interactionKind` → `law`) не вводится, так как он не убирает связность, а
просто переносит её на шаг дальше без выгоды.

**Нормализация verb.** `verb` — канонический идентификатор взаимодействия.
Любые синонимы, языковые варианты и свободные формулировки ("ignite",
"burn", "set fire to") нормализуются Parser/LLM-классификатором до
канонического `verb` **до** появления `IntentCommand` — так же, как в Шаге 1
LLM-классификатор уже нормализует "иду на север"/"двигаюсь к северу" до
единого `MoveCommand{direction: "north"}`. `interaction-registry.ts` знает
только канонические `verb`, никогда синонимы — расширение словаря
синонимов (тюнинг классификатора) не требует изменения Registry.

LLM-классификатор (расширение Шага 1) мапит свободный текст на `verb` **из
этого реестра** — не изобретает новые verb'ы, ровно так же, как раньше мапил
на 4 фиксированные команды. Размер словаря растёт, механизм классификации —
нет.

## 6. Interaction invariants

Переформулировка существующих инвариантов, не новые правила:

- Interaction (цепочка от `IntentCommand` до финального исхода) сама по себе
  не изменяет мир — меняют только Rules, эмитящие Domain Events (уже
  §2.2/§9.9 ARCHITECTURE.md).
- `IntentCommand` не содержит результатов — как и любой `PlayerCommand`, он
  transient, не в Event Log (§9.9).
- Interaction может быть отклонена на любом gate (`CommandRejected` /
  `ActionRejected(no_such_target)` / `ActionRejected(not_applicable)`) — как
  и любой другой Domain Event отказа (§9.4).
- Разрешение цели и применимости закона — обычные Validation Rules с
  доступом к `ReadonlyWorld`, не инфраструктура (прямое следствие §12.8:
  Parser не имеет права разрешать неоднозначность, требующую знания мира —
  значит это не может быть частью Parser/Command Handler).
- Только Rules порождают финальные Domain Events (§2.2).
- **Single owner для любого Validation/Gate Event** (не новый принцип —
  прямое применение уже действующего §12.3 ARCHITECTURE.md):
  `InteractionRequested` имеет ровно одного владельца
  (`simulation.duration_check`), `InteractionTimeValidated` — одного
  (`interaction.resolve_target`), `TargetResolved` — одного
  (`interaction.resolve_law`), `InteractionValidated` — одного на каждый
  `law` (при появлении конфликта — разделять правило, не вводить приоритет).

## 7. Явное архитектурное ограничение v1: один Intent на Command

> В v1 top-level Command соответствует ровно одному Intent. Композитные
> intent'ы ("подожги масло и столкни бочку") не поддерживаются — это
> сознательное ограничение, не недоработка. Требует отдельной модели
> транзакций (порядок исполнения нескольких Interaction внутри одной
> команды, поведение при частичном отказе) и рассматривается отдельным
> документом, когда актуализируется.

## 8. Открытые вопросы (по аналогии с §11 ARCHITECTURE.md — сознательно отложено)

- **Версионирование компонентной схемы Entity** при добавлении новых
  компонентов — вероятно решается тем же принципом, что Event Schema
  Evolution (§9.7), но не прорабатывается заранее.
- **UX для "неприменимо" vs "цель не найдена"** — оба сейчас `ActionRejected`
  с разным `reason`, но нарративная подача, вероятно, должна отличаться
  (см. Шаг 1, честный редирект вместо системной ошибки) — решается на
  Narrative-слое, не архитектурно.

---

*Черновик. Следующий шаг — ревью (аналогично циклу для основной
конституции), затем перенос согласованных решений в ARCHITECTURE.md/AGENTS.md
до начала реализации.*
