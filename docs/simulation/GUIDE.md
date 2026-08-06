# Simulation Guide

> Практическое руководство по написанию System Definitions.
> Основано на реальных ошибках из Architecture Review №1 (river-hydrology).
> Статус: Draft (пополняется по мере новых review).

---

## 1. Быстрый старт: как написать System Definition

1. Прочитать `docs/SIMULATION_BIBLE_ARCHITECTURE.md` §1–4.
2. Скопировать `docs/simulation/definitions/weather.yaml` как шаблон.
3. Заменить identity, ownedAspects, Events, Rules, guarantees.
4. Запустить `node scripts/simulation/validate-definition.mjs`.
5. Исправить ошибки → отправить на review.

---

## 2. Типичные ошибки (реальные случаи из Review №1)

### Ошибка 1: Binding внутри Definition

**Что произошло:** `river-hydrology.yaml` содержал секцию `bindings:` с примером привязки к pilot-region.

**Почему это ошибка:** Architecture §4.3: **System Binding — отдельный артефакт**, не часть Definition. Definition — контракт, Binding — экземпляр. Смешение нарушает границу и делает Definition неуниверсальным.

**Как исправить:** Удалить `bindings` из Definition. Создать отдельный файл в `docs/simulation/bindings/` (когда появится соглашение о размещении).

**Проверка:** Валидатор ловит invented top-level fields.

---

### Ошибка 2: Искусственные observationChannels

**Что произошло:** `observationChannels` содержал `direct-observation`, `attempted-travel`, `proximity` — имена придуманы автором, ни один инструмент их не потребляет.

**Почему это ошибка:** Consumer Rule §2.2: поле без потребителя — кандидат на удаление. `grep -r "direct-observation" packages/` возвращает 0 результатов.

**Как исправить:** Либо добавить потребителя (Observation Engine читает channels из SB), либо удалить поле до появления потребителя.

**Проверка:** Ручной `grep` по `packages/`.

---

### Ошибка 3: Текстовые evidence вместо структурированных

**Что произошло:**
```yaml
# Было:
evidence:
  - Rule: riverLevelProcess
  - "ADR-0017 §7 observer boundary"

# Должно быть:
implementionEvidence:
  - kind: Rule
    ref: riverLevelProcess
  - kind: Review
    ref: "ADR-0017 §7"
```

**Почему это ошибка:** Архитектура §4.6 требует `implementationEvidence` с machine-resolvable ссылками. Строка `"ADR-0017 §7 observer boundary"` — prose, которую нельзя проверить автоматически.

**Как исправить:** Каждый элемент `implementationEvidence` обязан иметь `kind` и `ref`.

**Проверка:** Валидатор проверяет `kind ∈ [Rule, Test, Lint, Review]` и наличие `ref`.

---

### Ошибка 4: Повтор параметров в трёх местах

**Что произошло:** Параметры речного процесса (`baselineLevel`, `cycleLengthTicks` и т.д.) существовали в:
- `ADR-0017 §1` (документация)
- `packages/world/src/region/types.ts` (TypeScript тип)
- `packages/world/src/region/compiler.ts` (hardcoded значения)
- `docs/simulation/definitions/river-hydrology.yaml` (`parameterSlots`)

**Почему это проблема:** При изменении параметра нужно менять 4 места. SB должен стать **single source of truth** для слотов/диапазонов; код — для значений (Binding).

**Как исправить:** Сейчас — вручную синхронизировать. В будущем: Compiler генерирует `region/types.ts` из SB.

**Проверка:** Ручной аудит при изменении параметра.

---

### Ошибка 5: Внутренние helper-функции в Public API (V-04)

**Что произошло:** `packages/world/src/index.ts` экспортировал:
```typescript
export { computeRiverLevel, classifyRiverBand, classifyCrossingCondition, computeCrossingTravelTicks }
```

**Почему это ошибка:** Это внутренние helper-функции Private Design. Их экспорт нарушает Stable Interface Principle — внешние потребители начинают зависеть от деталей реализации.

**Как исправить:** Убрать экспорт helper-функций из `@skald/world`. Экспортировать только `Rule` объекты и типы.

**Проверка:** Ревью `packages/world/src/index.ts` на предмет экспортов.

---

### Ошибка 6: Invented поля (codeTraces, simulationDepthCompatibility)

**Что произошло:** Автор добавил `codeTraces` и `simulationDepthCompatibility`, потому что "нужно где-то записать эту информацию".

**Почему это ошибка:** Архитектура не определяет этих полей. Они не имеют потребителей. Каждое поле без потребителя — кандидат на удаление (Consumer Rule).

**Как исправить:** Удалить. Кодовые следы — задача Trace stage (D-4.4 этап 5). Canon-depth compatibility — задача V-10 линтера.

**Проверка:** Валидатор ловит invented top-level fields.

---

### Ошибка 7: Hollow Guarantees (V-05)

**Что произошло:** Гарантия `observer-knowledge-lag` не имела dedicated теста. Гарантия `river-event-emission-honest` не имела теста на "emit only on change".

**Почему это ошибка:** §4.6: гарантия без теста или реализации — Hollow Guarantee.

**Как исправить:** Каждая гарантия должна иметь хотя бы один `kind: Test` в `implementationEvidence`.

**Проверка:** Валидатор проверяет наличие `implementationEvidence`. Тестовый mapping — вручную.

---

### Ошибка 8: dependencyEvidence как prose

**Что произошло:**
```yaml
dependencyEvidence:
  - "Route resolver читает crossingStates из spatial projection"
  - "CrossingConditionChanged изменяет passability..."
```

**Почему это ошибка:** V-08 требует конкретное состояние или событие. Prose не machine-checkable.

**Как исправить:**
```yaml
dependencyEvidence:
  - event: CrossingConditionChanged
    consumedBy: journey.validate
    aspect: CrossingState
    effect: "passability: closed блокирует journey"
```

**Проверка:** Валидатор проверяет наличие `event` или `aspect` в каждой entry.

---

### Ошибка 9: Заполнение поля только потому, что оно существует

**Что произошло:** `budget.notes` содержал объяснение, почему `Aggregated` не поддерживается. Поле было заполнено "потому что оно есть в шаблоне".

**Почему это ошибка:** Consumer Rule §2.2. Если поле не имеет потребителя — удалить.

**Как исправить:** Удалить `budget.notes`. Если информация важна — перенести в `rationale` Private Design.

**Проверка:** Ревьюер спрашивает: "кто читает это поле?"

---

## 3. Чеклист перед отправкой на review

- [ ] `node scripts/simulation/validate-definition.mjs` проходит без ошибок
- [ ] Нет invented top-level fields (валидатор проверяет)
- [ ] Все `guarantees` имеют `implementationEvidence` с `kind` и `ref`
- [ ] Все `influences` имеют `dependencyEvidence` с `event` или `aspect`
- [ ] Нет `bindings` внутри Definition
- [ ] Нет `codeTraces`, `simulationDepthCompatibility` и подобных
- [ ] `updateModel ∈ [Static, OnDemand, EventDriven, TickDriven]`
- [ ] `lifecycleStatus ∈ [Proposal, Review, Experimental, Candidate, Core]`
- [ ] `ownedAspects` не пуст
- [ ] `parameterSlots` не пуст
- [ ] Нет `notes` в `budget` без явного потребителя
- [ ] Проверен `grep -r "export.*computeRiverLevel\|classifyRiverBand" packages/world/src/index.ts` — нет V-04

---

## 4. Ссылки

- `docs/SIMULATION_BIBLE_ARCHITECTURE.md` — нормативная архитектура
- `docs/simulation/definitions/weather.yaml` — рекомендуемый шаблон
- `docs/simulation/reviews/001-architecture-review-river-hydrology.md` — полный review с деталями
- `scripts/simulation/validate-definition.mjs` — автоматическая проверка
