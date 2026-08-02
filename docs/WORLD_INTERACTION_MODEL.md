# World Interaction Model — v1 (accepted contract)

Продолжение `docs/ARCHITECTURE.md`, не замена. v1 — принятая спецификация
взаимодействия игрока с миром через свободный текст. Решения зафиксированы
в `docs/adr/0013-interaction-model-v1.md`; этот документ — рабочий контракт
для реализации (срезы вертикальной разработки).

## Статус

**Accepted (v1).** Вводится единый канонический пайплайн взаимодействия,
фиксированный набор глаголов v1, единый Target Resolver и выравнивание
Entity/WorldObject. Реализация — строго по срезам §9; каждый срез
закрывается focused-тестами, полным `npm run validate` и ревью.

---

## 1. Зачем это нужно

Игрок формулирует намерение свободно («осмотреть дверь», «попытаться
открыть сундук», «отдать пепел торговцу»); мир детерминированно определяет
намерение, цель, применимый закон и последствия. Без палитры действий, без
угадывания, без скрытых решений. Текущее состояние имело два параллельных
пайплайна (`ActionIntentCommand → ActionAttempted` и `IntentCommand →
InteractionRequested`), русский текст никогда не попадал в узкий пайплайн,
а разрешение цели было first-by-id без неоднозначностей (ADR-0013, Context).

## 2. Терминология

```
Player text → InteractionCommand (transient) → InteractionRequested
  → InteractionTimeValidated → TargetResolved | ActionRejected(ambiguous_target…)
  → InteractionValidated → Domain Events (fact outcomes) → Projection → Narrative
```

- **InteractionCommand** — каноническая transient-команда (не Domain Event,
  не пишется в Event Log), создаётся до Command Handler'а из
  интерпретированного текста.
- **Interaction** — не новая архитектурная сущность: имя всей цепочки
  обработки одной InteractionCommand от первого Domain Event до финального
  исхода. Инварианты §6 — переформулировка существующих инвариантов
  Command/Event/Rule применительно к этой цепочке.
- **Law** — логическая группировка Rule по физическому или социальному
  принципу; namespace, не исполняемый слой. `Rule` остаётся единственным
  контрактом `(Event, ReadonlyWorld) → Event[]`.
- **Gate Event** — подкатегория Domain Event: фиксирует успешное прохождение
  контрольной точки, влияет на дальнейшее применение Rules/Replay/Projection,
  остаётся каноническим событием (не отдельный лог). Narrative Adapter не
  обязан иметь для него шаблон. Примеры: `TargetResolved`,
  `InteractionValidated`, `ActionValidated`.

Слово "Intent" в именах Domain Events не используется (см. §9.9
ARCHITECTURE.md) — только на Command-стороне. `InteractionRequested`
сохраняет имя симметрично `MoveRequested`/`GiveRequested`.

## 3. Data shapes

```ts
// Command-side, никогда не пишется в Event Log
interface InteractionCommand {
  readonly type: "InteractionCommand";
  readonly verb: InteractionVerb;              // канонический глагол, см. §5
  readonly target?: IntentReference;           // как игрок назвал цель (текст, не ID)
  readonly secondaryTarget?: IntentReference;  // give: получатель
  readonly instrument?: IntentReference;
  readonly utterance?: string;
  readonly rawText: string;
  readonly interpretation: InterpretationMeta; // source, confidence, ambiguities
}
```

`InteractionVerb` — объединение восьми канонических значений:
`"observe" | "inspect" | "listen" | "touch" | "take" | "open" |
"apply_force" | "give"`; `examine` — синоним `inspect` на уровне парсера.

Entity — component-based модель (типизированные доменные аспекты, конечный
набор, без универсального ECS; новые типы компонентов — только через
обычный цикл правки схемы):

```ts
interface Entity {
  id: EntityId
  components: {
    material?: MaterialComponent      // { kind: "iron" | "wood" | ... }
    thermal?: ThermalComponent        // { temperature, meltingPoint? }
    physical?: PhysicalComponent      // { weight, intact }
    relation?: RelationComponent      // Relation Edges (§5.11)
    inventory?: InventoryComponent
  }
}
```

**Выравнивание Entity/WorldObject (ADR-0013 §4):** `WorldObject` остаётся
мутабельной физической моделью; `Entity` остаётся совместимым общим
read-view; `InteractionTarget` — чистый адаптер над `ReadonlyWorld`;
`WorldObjectPlaced` даёт и компоненты цели. Оба read model строятся из
одних и тех же событий, без ручной синхронизации. Мутабельное действие на
generic `Entity` без физического `WorldObject` → `not_applicable`. Третьей
канонической модели объектов нет.

## 4. Pipeline — единый канонический пайплайн (ADR-0013 §1)

Обе старые команды (`ActionIntentCommand` и узкий `IntentCommand`)
схлопываются в единую transient-форму `InteractionCommand` **до** Command
Handler'а. `InteractionRequested` — канонический старт любого
взаимодействия; `ActionAttempted` остаётся только для легаси-глаголов
(`move`/`wait`/социальные), новые глаголы через него не ходят.

```
Player → InteractionCommand (transient, не хранится)
  → Command Handler (структурная валидация: известен ли verb)
      ├─ невалидна → CommandRejected (без Domain Event с игровой семантикой)
      └─ валидна   → InteractionRequested (первый Domain Event)

  → Rule "simulation.duration_check" (фаза Validation, ЕДИНСТВЕННЫЙ
     владелец InteractionRequested): проверяет action budget
      ├─ времени нет → ActionRejected(reason: "insufficient_time")
      └─ есть время → InteractionTimeValidated

  → Rule "interaction.resolve_target" (фаза Validation, ЕДИНСТВЕННЫЙ
     владелец InteractionTimeValidated): единый Target Resolver (§7)
      ├─ missing     → ActionRejected(reason: "no_such_target")
      ├─ ambiguous   → ActionRejected(reason: "ambiguous_target",
      │                 candidateNames: ["Башенная дверь", "Дверные петли"])
      ├─ environment → TargetResolved(locationId)  // observe/listen без цели
      └─ resolved    → TargetResolved(entityId)

  → Rule "interaction.resolve_law" (фаза Validation, ЕДИНСТВЕННЫЙ владелец
     TargetResolved): verb + компоненты цели против interaction-registry.ts
      ├─ не применимо → ActionRejected(reason: "not_applicable")
      └─ применимо    → InteractionValidated { law, entityId, verb }

  → downstream Law rules (фазы Physics/Consequence, слушают
     InteractionValidated, финальные владельцы исхода) → фактические
     Domain Events (EntityExamined, SoundObserved, ItemTaken, …)

  → World Projection → Narrative (PresentationTemplate, без gate-событий)
```

Никакого специального механизма "Intent Resolver" не существует — это
обычная очередь событий; RuleEngine видит только очередной Event.

## 5. `interaction-registry.ts` — конечная compile-time таблица

Тот же принцип, что `strategy-registry.ts` (§5.8 ARCHITECTURE.md): конечный,
зарегистрированный на старте набор, не runtime-генерация.

```ts
interactionRegistry.register({
  verb: "inspect",
  requiredTarget: "concrete",   // observe/listen: "optional" (разрешается в environment)
  law: "perception",            // namespace/label, НЕ конкретный исход
})
```

Registry отвечает только "какой Law применим"; какой именно Domain Event
получится — решает Rule в рантайме. Registry не знает `producesEvent`.
Поле `law` — часть доменной модели, стабильный курируемый словарь.

**Нормализация verb.** Парсер приводит синонимы и свободные формулировки
(включая русские словоформы и `examine`) к каноническому `verb` **до**
появления `InteractionCommand`. Registry знает только канонические verb'ы;
расширение словаря синонимов не требует изменения Registry.

## 6. Interaction invariants

Переформулировка существующих инвариантов, не новые правила:

- Interaction сама по себе не изменяет мир — меняют только Rules, эмитящие
  Domain Events.
- `InteractionCommand` не содержит результатов и не пишется в Event Log.
- Interaction может быть отклонена на любом gate (`CommandRejected` /
  `ActionRejected(no_such_target)` / `ActionRejected(ambiguous_target)` /
  `ActionRejected(not_applicable)` / `ActionRejected(insufficient_time)`).
  Неоднозначность — отказ с честным списком кандидатов, не долгоживущее
  состояние уточнения и не угадывание.
- Разрешение цели и применимости закона — обычные Validation Rules с
  доступом к `ReadonlyWorld`, не инфраструктура (Парсер не имеет права
  разрешать неоднозначность, требующую знания мира).
- **Single owner** для любого Validation/Gate Event и для каждого исхода:
  один владелец у `InteractionRequested`, один у `InteractionTimeValidated`,
  один у `TargetResolved`, один у `InteractionValidated` на каждый `law`,
  один владелец у `ActionResolved` и финальных fact-событий.
- **Одна команда — одно намерение.** Топ-уровневая команда соответствует
  ровно одному Intent; композитные intent'ы не поддерживаются в v1.
- **Один Target Resolver** у runtime-гейта, offline-классификатора и
  HTTP/интеграционных тестов (продолжение принципа ADR-0011: runtime и
  offline не могут разойтись).

## 7. Target Resolver (ADR-0013 §3)

```ts
type TargetResolution =
  | { kind: "resolved"; target: InteractionTarget }
  | { kind: "environment"; locationId: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: readonly PlayerFacingCandidate[] };
```

Правила:

- Только observer/player scope; точное имя сильнее алиаса; частичное
  совпадение — только если единственный кандидат; два равных совпадения →
  `ambiguous`; невидимые/недоступные цели исключаются; кандидаты не содержат
  внутренних ID.
- `observe`/`listen` могут разрешаться в `environment` без цели;
  `take`/`open`/`touch`/`apply_force` требуют конкретную цель; `give`
  требует предмет из инвентаря игрока плюс наблюдаемого получателя.
- Неоднозначность → `ActionRejected { reason: "ambiguous_target",
  candidateNames: [...] }` с читаемыми именами.

## 8. Явное архитектурное ограничение v1

> Один Intent на Command; отсутствие палитры действий (composer — единый
> элемент управления: textarea + «Отправить»; никаких D-pad, кнопок-глаголов,
> action chips или автодополнений, подменяющих намерение). LLM может только
> перефразировать факты, выбранные сервером; выбор фактов, важности и
> действий — за бэкендом. Критический бросок кубика — только после успешного
> переподключения/классификации (offline); конфликт никогда не молчаливый
> rebase.

## 9. Вертикальные срезы (порядок обязателен)

Каждый срез: focused-тесты → `npm run validate` → ревью; следующий срез
начинается только после закрытия предыдущего.

| # | Срез | Каноническая цепочка | События |
|---|------|----------------------|---------|
| 1 | observe + inspect | `InteractionRequested → InteractionTimeValidated → TargetResolved → InteractionValidated(law: perception) → EntityExamined / ObjectObserved → ObservationRecord` | `EntityExamined`, `ObjectObserved` (существующее), `ObservationRecord` |
| 2 | listen | аудиальный закон | `SoundObserved`, `ActionHadNoObservableEffect` |
| 3 | touch | тактильный закон | `EntityTouched`, `ObservationUpdated`, `ConsequenceCreated` (только реальная опасность) |
| 4 | take + инвентарь | possession-закон | `ItemTaken`, `ItemDropped` |
| 5 | open | access-закон | `ObjectOpened`, `ObjectClosed`, `PassageOpened` |
| 6 | apply_force + критическая проверка | force-закон, миграция | `CriticalCheckRequested → CriticalCheckRolled → CriticalCheckResolved → ObjectIntegrityChanged / PassageOpened / ConsequenceCreated` |
| 7 | give | transfer-закон | `ItemTransferred { itemId, fromOwnerId, toOwnerId }` |

Требования к срезам:

- **Срез 1:** осмотр без цели описывает только окружение; inspect требует
  конкретную цель; скрытые свойства не раскрываются; повторный осмотр
  обновляет свежесть ObservationRecord; неоднозначность в словах;
  существующий `examine` продолжает работать; offline-`examine` использует
  тот же новый резолвер после нормализации.
- **Срез 2:** событие несёт читаемое описание источника, громкость и
  дистанцию в доменных единицах, observer scope; скрытая причина никогда
  не раскрывается.
- **Срез 3:** тактильные свойства: горячее/холодное, шероховатость,
  подвижность, влажность, вибрация, целостность поверхности; кубик — только
  при реальной неопределённости со ставками.
- **Срез 4:** проверки: существует/рядом/доступен/собираем/не
  принадлежит/не закреплён/вес допустим; инвентарь — проекция из Event Log
  (не SQLite, не состояние браузера); UI показывает только наблюдаемое
  содержимое.
- **Срез 5:** исходы: открывается свободно/заперто/заклинило/уже открыто/не
  открывается/нужен инструмент или сила; open НЕ переходит автоматически в
  apply_force; честное сообщение.
- **Срез 6:** бросок только после всех гейтов; один модификатор применяется
  один раз; DC фиксирован моделью; восстановление после падения
  (durable roll); один владелец `ActionResolved`; нет двойного урона/шума;
  replay использует записанный бросок; у провала тоже есть понятное
  последствие.
- **Срез 7:** два разрешённых target'а (предмет игрока + наблюдаемый
  получатель); Transfer Rule никогда не назначает благодарность/страх/
  доверие — это могут делать только downstream Rules.

## 10. Offline-граница (ADR-0013 §7)

`inspect`/`examine` переходят на новый общий резолвер немедленно.
`listen`/`touch`/`take`/`open`/`apply_force`/`give` — онлайн-only на
старте; офлайн-расширение — отдельная работа UX-6.4. Критический бросок —
никогда до успешного переподключения/классификации; конфликт — никогда
молчаливый rebase.

## 11. Definition of Done

Полный словесный цикл «осмотреться → прислушаться → изучить дверь →
коснуться петель → взять пепел → попытаться открыть дверь → навалиться на
неё → пройти внутрь → отдать найденный предмет персонажу» исполняется через
единый канонический пайплайн: факты и последствия, без угадывания
неоднозначности, кубик только при реальном риске, UI не предлагает
действий, Event Log — единственная истина, replay/restart идентичны,
полный `npm run validate` проходит, реальный браузерный QA записан (PASS /
FAIL / BLOCKED).
