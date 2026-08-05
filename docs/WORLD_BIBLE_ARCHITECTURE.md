# World Bible Architecture — Canon Model

**Статус:** draft, подлежит принятию через ADR (зафиксировать как наследника
ADR-0007 для design-time слоя знаний о мире).
**Происхождение:** архитектурное интервью, Блоки 0–7 (2026-08-04). Каждое
решение ниже трассируется к блоку и вопросу интервью.
**Связанные документы:** `docs/ARCHITECTURE.md` (runtime-конституция),
`docs/adr/0007-worldbuilding-principles.md` (governed design layer),
`docs/adr/0012-first-living-region.md`, `docs/LIVING_WORLD_REGION_ARCHITECTURE.md`,
`docs/OBSERVATION_BELIEF_MODEL.md`.

Этот документ — не World Bible. Это архитектура системы знаний о мире:
что такое Canon, как он устроен, кто его читает, как он попадает в мир,
как живёт и как умирает. Содержание мира здесь не создаётся.

---

## 1. Философия

### 1.1. Canon — авторский исходный код мира

Большинство проектов строят цепочку `Lore → Designer → ручной код`.
SKALD строит иную:

```
Canon Model → Compilation → Bootstrap Events → Event Log
    → Simulation → Discovery → Narrative → UI
```

Canon — не энциклопедия и не сборник лора. Canon — операционная модель
мира: минимальный набор утверждений, достаточный для детерминированного
порождения всего остального знания о мире. Любой элемент Canon существует
потому, что способен влиять на состояние мира.

### 1.2. Мастер-фильтр Canon

Перед любым другим вопросом о факте задаётся один:

> **Почему без этого факта мир становится хуже?**

Не «что это», не «где хранится», не «как связано». Факт, не имеющий
ответа, не существует в Canon (см. A−2).

### 1.3. Три разделённых авторитета

```
Canon Model   = design authority     (что задумано о мире)
Event Log     = runtime authority    (что произошло в мире)
Observation   = evidence authority   (что измерено в прожитом мире)
```

Ни один не подменяет другой. Связь между ними — только в одном
направлении каждая: Canon компилируется в Event Log; Event Log порождает
evidence; evidence через решение автора уточняет Canon. Обратного канала
runtime → Canon не существует (A−4, A−7).

### 1.4. World Bible — проекция, не источник

World Bible (WB) — человекочитаемая read-модель Canon Model, наравне с
Region Compiler input, Codex Context и Validation input. WB — не сам
Canon, не место хранения всех знаний, не runtime state (A−1).

---

## 2. Аксиомы (принципы)

Аксиомы нумеруются сквозным реестром по порядку принятия. Изменение
любой аксиомы — только через ADR (A−13).

### 2.1. Бытие и границы

- **A−1. Первичность Canon Model.** Canon определён через контракт и не
  зависит от представления. Markdown, YAML, граф, БД — read-модели Canon.
  WB — одна из них. (Блок 0.12-B)
- **A0. Разделение авторитетов.** Canon Model — единственный авторитет
  design-time; Event Log — единственный авторитет runtime. Canon никогда
  не читается исполняемой системой. Единственный путь Canon в мир —
  детерминированная компиляция в Domain Events. (Блок 0.5-C)
- **A−2. Consequence Requirement.** Факт без потенциального следствия —
  не Canon Fact. Поле `consequences` обязательно. (Блок 0, A−2)
- **A1. Минимальный канон** (поглощена A−2): если удаление факта не
  изменит симуляцию, Discovery, архитектурные решения или авторскую
  идентичность мира — факт не существует в Canon. (Блок 0.6)
- **A2. Стабильность между экземплярами.** Canon описывает только то,
  что стабильно между экземплярами миров: Universal и Regional слои.
  Именованные экземпляры — только через реестр Canonical Anchors (3.6).
  Инстансное — Event Log и Historical Projection, никогда Canon.
  (Блоки 0.7-B, 2.5)
- **A3. Canonical Compression.** Canon хранит минимальное порождающее
  ядро. Выводимое — не Canon, а Derived Canon: генерируется, не
  редактируется, имеет provenance, восстановимо после удаления. (Блок 0.11-C)

### 2.2. Проекции и потребители

- **A−3. Projection Purity (design-time).** Любая проекция Canon —
  потеря информации, никогда — источник новой:
  `Projection(Canon) ⊆ Canon`. (Блок 1)
- **A−11. Narrative Separation.** Narrative Assets существуют рядом с
  Canon Model, не внутри. Не компилируются, не создают фактов, не имеют
  статуса Canon. (Блок 3.4)
- **A−12. Derived Simulation Metadata.** Любая информация, выводимая из
  compiler/runtime связей, не хранится вручную (Simulation Relevance —
  вычисляется, не записывается). (Блок 3.5-B)

### 2.3. Путь в мир

- **A−4. Runtime Authority Direction.** `Canon → Compiler → Event Log →
  Projection`. Обратного канала нет. (Блок 2)
- **A−5. Event Genesis Principle.** Всё, что влияет на состояние мира,
  обязано иметь происхождение в Event Log (закон — `LawRegistered`,
  канал наблюдения — `ObservationChannelRegistered`, не скрытая
  конфигурация). (Блок 2.2)
- **A−6. Compiler Purity.** Canon Compiler — чистая функция
  `(Canon, Schema, Version) → Bootstrap Events`. Никаких `Date.now()`,
  `Random()` без seed из входа, LLM, сети. Replay-тест: перекомпиляция
  того же входа = идентичный батч. (Блок 2.7)
- **A−7. No Reverse Canonization.** Симуляция никогда не изменяет Canon
  напрямую. Канонизация эмерджентного — только через решение автора
  (5.5). (Блок 2.6-B)

### 2.4. Структура

- **A−8. Canon is a Graph, not a Tree.** Canon Model — граф Concepts с
  типизированными рёбрами, не иерархия документа. Граф ацикличен.
  (Блок 3.2)
- **A−9. Трёхмерная классификация.** Каждый Concept определяется осями
  `Scope × Domain × Temporal Scale`. (Блок 3.1-C)
- **A−10. Concept lifecycle aggregation.** `Fact.status ≤ Concept.status`.
  Компилятор получает только Canon-факты Canon-Concept'ов. (Блок 3.3-B)

### 2.5. Жизненный цикл и governance

- **A−13. Canon Governance Evolution.** Правила изменения Canon Model
  сами являются Canon Governance и меняются только через ADR. (Блок 4)
- **A−14. Proposal ≠ Authority.** Источник предложения не определяет
  истинность. `proposedBy` и `acceptedBy` — разные поля. (Блок 4.1-B)
- **A−15. Promotion Gate Scales with Impact.** Чем глубже Simulation
  Depth, тем выше стоимость принятия. (Блок 4.2)
- **A−16. Compiled Canon Becomes Historical.** Факт, вошедший в Genesis
  Digest, не может быть тихо изменён: только `supersedes` или
  `deprecatedReason`. (Блок 4.4-C)
- **A−17. Deprecated Is Historical State.** Deprecated ≠ удалить;
  означает «не участвует в создании новых миров». (Блок 4.5-B)
- **A−18. Version Is Projection, Digest Is Identity.** SemVer — для
  людей; Genesis Digest — абсолютная идентичность мира. (Блок 4.6-C)

### 2.6. Глубина симуляции

- **A−19. Simulation Depth is a commitment.** Глубина — обязательство
  перед runtime, не тег. `Simulated`/`CoreSimulation` обязаны иметь
  Runtime Mapping или `plannedRuntime` через ADR. (Блок 5.1-B)
- **A−20. Simulation follows consequences.** Симулируется только то,
  чьи уникальные причинные следствия нельзя получить дешевле статической
  структурой. Не важность, не красота, не богатство лора. (Блок 5.2-C)
- **A−21. Not Simulated is first-class knowledge.** Отказ моделировать —
  такое же архитектурное решение, как решение моделировать. (Блок 5.3-A)
- **A−22. Determinism is not a cost category.** Недетерминированные
  процессы — не `TooExpensive`, а `ForbiddenByConstitution`. (Блок 5.4-D)

### 2.7. Pilot Region и эволюция

- **A−23. Canon completeness is projection-relative.** Canon не обязан
  быть завершённым вообще; обязан быть достаточным для конкретного
  потребителя. (Блок 6.1)
- **A−24. Pre-Canon worlds are historical objects.** Миры, рождённые до
  Canon Model, — не ошибка, а часть истории происхождения системы.
  (Блок 6.5-C)
- **A−25. Code can be a Canon source, but never authority.** `Code →
  Canon` только через governance (`ImportedFromCode` + Review Gate).
  `Code == Canon` — никогда. (Блок 6.2-A)
- **A−26. First region produces evidence, not truth.** Pilot Region
  создаёт `CalibrationEvidence` и `ImportedFromWorld`, не Canon
  напрямую. (Блок 6.4-C)

### 2.8. Tooling

- **A−27. Tooling follows Canon maturity.** Инструмент создаётся, когда
  его отсутствие стало ограничением развития Canon: `Canon → repeated
  pain → tooling proposal → ADR → implementation`. Не наоборот. (Блок 7.6)

---

## 3. Структура Canon Model

### 3.1. Типы записей

Canon Model содержит четыре типа записей. NarrativeAsset — пятый тип,
живущий рядом, но не внутри (A−11).

#### Concept — атом ревью и жизненного цикла

```yaml
Concept:
  id:                    # обязательно
  scope:                 # Universal | Regional — обязательно
  domain:                # см. 3.2 — обязательно
  temporalScope:         # { scale, mutation } — обязательно
  lifecycle:             # Experimental | Proposed | Canon | Deprecated | Archived
  facts: []              # Fact[]
  relations: []          # Relation[] (типизированные, 3.3)
  simulationDepth:       # NarrativeOnly | Observable | Simulated | CoreSimulation
  provenance:            # { proposedBy, acceptedBy } — разные поля (A−14)
```

#### Fact — атом хранения (CanonFact v0.1)

```yaml
Fact:
  # минимальный Canon Fact (обязательные поля):
  id:
  statement:             # формализованное утверждение, не проза
  type:                  # открытый список, критерий — различимое следствие
  temporalScope:         # { scale, mutation }
  provenance:
  consequences:          # A−2: что порождает / что ломается при удалении

  # расширенные поля:
  observability:         # DirectObservation | Artifact | GeologicalTrace |
                         # BiologicalTrace | Testimony | Ritual |
                         # Astronomical | MathematicalInference | Impossible
  knowledgeCost:         # Common | Uncommon | Rare | Lost | Impossible
                         # относительно Observer Model, не прогрессии игрока
  relations: []
  causes: []
  constraints: []
```

Правила полей:

- `observability: Impossible` допустим, но `Impossible + no consequences`
  — запрещено. (Блок 0.14)
- Количественные значения — Canon только если число часть онтологии
  («вода замерзает ниже T»). Значения калибровки (`frostDamage=0.15`) —
  Parameters, не Canon. Разделение: Canon — «что существует и какие
  отношения имеют место»; Rules — «как вычисляется»; Parameters — «какие
  значения используются». (Блок 0.13)
- Допустимые типы утверждений — открытый список (структурные, причинные,
  исторические, аксиоматические, количественные-онтологические, факты о
  сознании культур). Недопустимы: оценочные, эмоциональные,
  метафорические как канон — их место в Narrative Assets. (Блок 0.13)

#### CanonicalAnchor — контракт Canon ↔ Compiler ↔ Region

```yaml
CanonicalAnchor:
  id:
  conceptId:
  regionId:
  obligation:            # required
```

Якорь — единственный способ Canon содержать именованный экземпляр
(исключение из A2). Реестр явный и малый: линтер предупреждает о росте
числа якорей. Добавление якоря — кандидат на ADR. (Блок 3.6-B)

#### NotSimulatedClaim — Canon о границах ответственности симуляции

```yaml
NotSimulatedClaim:
  id:
  statement:
  category:              # PerformanceLimit | CalibrationLimit |
                         # DeterminismConstraint | DesignChoice |
                         # DeferredCapability
  reason:
  consequences:          # что теряем, не симулируя
  reviewAfter:           # триггер пересмотра
  provenance:
```

`DeterminismConstraint` — не дороговизна: `LLM в контуре Rules`,
внешние API, скрытая случайность — `ForbiddenByConstitution`
(A−22), место — рядом с инвариантами, не в реестре цен. (Блок 5.3/5.4)

#### NarrativeAsset (вне Canon Model, A−11)

```yaml
NarrativeAsset:
  conceptRefs: []        # только ссылки, никогда дублирование фактов
  cultureRefs: []
  style:
  tone:
  provenance:
```

Допустимо: «церемониальная медленная речь». Недопустимо: «Монолит
ужасен» — только как «культура X воспринимает Монолит как ужасный»
(и тогда это кандидат в Fact о сознании культуры). (Блок 3.4)

### 3.2. Оси классификации (A−9)

```
Scope:     Universal | Regional
Domain:    Metaphysics | Laws | History | Space | Biology |
           Culture | Society | Technology | Entities
Temporal:  { scale: Eternal | Epoch | HistoricalEvent | Seasonal | Momentary,
             mutation: Immutable | Evolving | Mutable }
```

Иерархия L1–L7 исходного брифа заменена матрицей; она сохраняется только
как presentation-порядок разделов в генерируемом WB, не как структура
Canon Model. (Блок 3.1-C)

Примеры: закон отношений — `Universal × Metaphysics × Eternal/Immutable`;
Монолит — `Regional × Entities × Epoch`; падение империи —
`Universal × History × HistoricalEvent`.

### 3.3. Зависимости (A−8)

Concept Graph ацикличен — минимальный enforceable инвариант (линтер:
cycle detection + missing references). Рёбра типизированы:

```
grounds | causes | locatedIn | contains | exemplifies |
predates | dependsOn | contradicts
```

Relation compatibility matrix (какие пары «тип ребра × домены» запрещены)
— направление, не текущий инвариант: вводится с tooling по A−27.
(Блок 3.2)

### 3.4. Противоречия (Блок 0.16-B/C)

Объективный слой Canon внутренне согласован: два несовместимых WorldFact
— ошибка компиляции. Допустимы как данные:

```
Canon contradiction
  ├── Author error              ❌ (ошибка компиляции/линтера)
  ├── Cultural contradiction    ✅ (EpistemicConflict: культура A верит X,
  │                                 культура B верит ¬X — факты о верованиях)
  ├── Historical uncertainty    ✅
  └── Observer limitation       ✅
```

Противоречие как данные мира ≠ противоречие как ошибка Canon.

---

## 4. Потребители и проекции

### 4.1. Модель потребителей

```
                 Canon Model  (независимая схема; не принадлежит потребителям)
                       |
     +---------+-------+--------+-----------+
     |         |        |        |           |
 WB Adapter  Compiler  Codex  Narrative  Future
 (human)   Projection Projection Projection Consumers
```

Сложность адаптации оплачивается адаптерами, не схемой Canon. (Блок 1.1-C)

### 4.2. Правила проекций

1. Все потребители получают проекции, не полную модель. (Блок 1.2-B)
2. Проекция может уменьшать информацию, никогда — добавлять (A−3).
3. Фильтрация по статусам: Compiler — `Canon` only; Codex —
   `Canon + Proposed`; Author — всё. (Блок 1.2)
4. **Narrative Projection не содержит Canon Truth.** Narrative Context —
   только факты о наблюдателях, культурах и языках. Narrative не знает
   «Монолит создан цивилизацией X», если персонаж этого не знает; знает
   «культура X считает Монолит священным», если контекст разрешает.
   (Блок 1.3-D)
5. Codex получает Canon как ограничение разработки; enforcement
   поэтапно: `canonicalRef` recommended → required (с Compiler) → PR
   rejected (с RuleRegistry/линтером). (Блок 1.4-C)
6. Новый потребитель Canon = новая проекция + ADR. Генераторы
   проектируются, когда появится первый реальный генератор. (Блок 1.5-A)

---

## 5. Путь Canon в runtime

### 5.1. Единственный путь

```
Canon Model → Compiler → Bootstrap Events → Event Log → Projection
```

Любое состояние мира до первого события игрока обязано иметь
трассируемое происхождение из Canon. Переходный режим (до появления
Compiler): ручная компиляция, где каждое bootstrap-событие несёт
`canonicalRefs: [factId]`. Ручной bootstrap без factId запрещён —
переходный период является неавтоматизированным компилятором, а не
обходом Canon. (Блок 2.1-B→A)

### 5.2. Каналы компиляции (A−5)

Compiler может создавать несколько read-model выходов, но источник
истины runtime — только Event Log. Всё, влияющее на поведение мира,
обязано иметь Event-представление: закон — `LawRegistered`, канал
наблюдения — `ObservationChannelRegistered`, модель знания —
`KnowledgeModelRegistered`. Скрытая конфигурация мимо Event Log
запрещена: она ломает replay. (Блок 2.2)

### 5.3. Genesis Digest (A−18)

Каждый мир маркируется кортежем:

```yaml
genesis:
  canonDigest:       # хэш compiler-проекции Canon
  schemaVersion:     # версия схемы CanonFact
  compilerVersion:   # версия компилятора (manual — в переходный период)
  bootstrapDigest:   # хэш порождённого батча (самопроверка replay)
```

«Тот же Canon + новый Compiler» и «новый Canon + тот же Compiler» —
разные миры. (Блок 2.3-C)

### 5.4. Ретроканон (Блок 2.4-D)

Универсальной стратегии нет; каждый случай — Migration ADR, выбирающий:

- **A.** Новый Canon — только для новых миров (живущие остаются на своём
  digest навсегда);
- **B.** Компенсирующие события: мир *узнаёт* новое через аппенд
  Domain Events; bootstrap не заменяется;
- **C.** Полная пересборка (новый bootstrap + replay старого лога) —
  **запрещена конституционно**: идентичность не гарантируется.

> История мира — исторический артефакт. Canon не переписывает прошлое
> существующих миров.

### 5.5. Канонизация эмерджентного (A−7)

```
World Instance → Event Range → Human Review → New Canon Fact
provenance: { type: ImportedFromWorld, worldId, eventRange }
```

Автоматический канал `Simulation → Canon` запрещён. Emergence Detector
(кандидаты из Event Log → Human Review) — отложенный слой tooling
(Блок 7.6). Экспериментальные миры (будущее, 4.3) канонизируются только
через тот же путь. (Блок 2.6-B)

### 5.6. Instance-уровень: Historical Projection

То, что произошло внутри конкретной симуляции, никогда не является
Canon: это Event Log или его производная read-модель — Historical
Projection («пещера обрушилась на 34 году» — Historical Fact of World
Instance). Термин «Instance Canon» запрещён как ложная семантика.
(Блок 2.5)

### 5.7. Дисциплина компилятора (A−6)

Разделение: Canon Authoring может использовать LLM и генераторы
(инструменты автора); Canon Compiler — чистая функция с replay-тестом
в CI. LLM может предлагать факты; LLM не компилирует мир. (Блок 2.7)

---

## 6. Simulation Layers

### 6.1. Шкала Simulation Depth

```
NarrativeOnly → Observable → Simulated → CoreSimulation
```

Глубина — обязательство (A−19):

- `NarrativeOnly`, `Observable` — не требуют существования Rule/Event
  цепочки;
- `Simulated`, `CoreSimulation` — обязаны иметь Runtime Mapping (§9)
  или зарегистрированный `plannedRuntime` через ADR.

Текущий инвариант: `Deep Canon → Runtime Mapping`.
Целевой инвариант: `Canon ↔ Runtime bidirectional traceability`
(синхронно развитию обратных ссылок, 5.1 и Блок 0.9-D).

### 6.2. Критерий глубины (A−20)

```
Fact
 ├── нет уникальных следствий        → Observable / bootstrap
 └── уникальные причинные следствия  → Simulated
```

Симулировать необходимо только то, чьи последствия невозможно получить
дешевле статической структуры. Для зрелого runtime добавляется
инвариант: Simulated-факт обязан иметь потребителей (Rules / Projection
dependencies) — иначе это декоративная симуляция. Порядок роста следует
зависимостям: World Clock → свет → погода → гидрология → сезоны;
каждый слой становится Simulated, когда нижний уже проживается
(LIVING_WORLD §16). (Блок 5.2)

### 6.3. Миграция глубины (Блок 5.5-D)

Асимметричная стоимость:

- **Повышение** (`Observable → Simulated`) = Canon expansion: Runtime
  Mapping, Rule/Event design, dry-run, impact review;
- **Понижение** (`Simulated → Observable`) для скомпилированных миров =
  Migration ADR: старые миры уже прожили механизм, Event Log содержит
  последствия, digest обещал иной уровень поведения.

---

## 7. Canon Lifecycle

### 7.1. Статусы и переходы

```
Experimental → Proposed → [Promotion Gate] → Canon → Deprecated → Archived
```

- **Experimental** — некомпилируемый исследовательский слой (виден
  Author/Codex). Экспериментальные миры с маркированным digest — будущая
  возможность; канонизация их результатов — только через 5.5. (Блок 4.3)
- **Proposed** — прошёл минимальную схему, ждёт ревью.
- **Canon** — принят; компилируем (если в compiler-проекции).
- **Deprecated** — не участвует в создании новых миров; обязательные
  `deprecatedReason` и (если есть) `supersededBy`. (A−17)
- **Archived** ≠ deleted: хранится, исключён из всех проекций, кроме
  авторской.

### 7.2. Рождение факта (A−14)

Источники предложений: `AuthorDecision | AgentProposal(taskRef) |
ImportedFromWorld(worldId, eventRange) | ImportedFromCode(source) |
InterviewDecision(block, question) | DerivedFrom(factIds) |
CompilationConstraint(compiler/version) | CalibrationEvidence`.

Правила:

- Авторство предложения и авторство решения — разные поля:
  `proposedBy` ≠ `acceptedBy`; Canon-статус — только решением автора.
- Provenance нельзя использовать как аргумент истины: `AuthorDecision`
  означает «так принято», не «это верно». (Блок 0.17)
- Импорт (из кода, из мира) ≠ автоматическое принятие: любой импорт —
  кандидат, проходящий Review Gate (A−25, A−26).

### 7.3. Promotion Gate (A−15)

Дифференцирован по Simulation Depth:

- **NarrativeOnly / Observable:** provenance, обязательные поля, линтер,
  авторское ревью.
- **Simulated / CoreSimulation:** дополнительно Runtime Mapping (§9),
  dry-run компиляции, проверка anchors, проверка конфликтов объективного
  слоя (3.4), проверка affected Concepts (blast radius по графу).

> Runtime Mapping обязателен не для каждого факта, а для каждого факта,
> претендующего влиять на симуляцию. (Блок 4.2)

### 7.4. Модель изменения (A−16)

```
Canon до компиляции      → редактируем (Proposed/Experimental — свободно)
Canon после Genesis Digest → immutable history:
    исправление = новый факт + supersedes: [oldFactId]
    отказ       = deprecatedReason
```

Граница определяется вхождением в Genesis Digest хотя бы одного мира.
До появления digest-реестра граница отслеживается процедурно (честная
дисциплина), с реестром — машинно. (Блок 4.4-C)

### 7.5. Удаление (Блок 4.5-B)

Физическое удаление разрешено только при доказанном `never compiled +
never referenced` и через ADR — для ошибочных черновиков,
неиспользованных Proposed, временных генераций. Удаление — единственная
«правка прошлого»; её порог не ниже ретроканона (5.4).

---

## 8. Версионирование (A−18)

Canon Version — SemVer, человекочитаемая проекция; Genesis Digest —
абсолютная идентичность.

- **PATCH:** не меняет компилируемый мир (правки описаний, Deprecated
  Proposed, provenance updates).
- **MINOR:** добавление совместимого Canon (существующие миры не
  меняются).
- **MAJOR:** меняет происхождение мира — изменён bootstrap, Universal
  Laws или Canonical Anchors. Требует Migration ADR (5.4).

Цель: машинная проверка MAJOR через эталонную перекомпиляцию
(изменился ли bootstrap-батч эталонного региона) — tooling по A−27.
(Блок 4.6-C)

---

## 9. Runtime Mapping

### 9.1. Обязательная цепочка

Для каждого факта глубины `Simulated`/`CoreSimulation` (и каждого Concept,
владеющего ими) документируется:

```
Canon Fact / Concept
  → Runtime systems   (какие подсистемы проживают факт)
  → Rules             (какие законы реализуют)
  → Events            (какие Domain Events порождает/слушает)
  → Projection        (какие read-модели отражают)
  → Discovery         (Observability-канал → Evidence → BeliefModel)
  → Narrative         (что может быть пересказано — без Canon Truth, 4.2.4)
  → UI                (что наблюдатель способен увидеть)
```

Если цепочка невозможна — фиксируется явное обоснование (это и есть
ответ «почему» из брифа). Факт глубокой глубины без цепочки и без
`plannedRuntime` отклоняется линтером. (Блок 4.2, 5.1)

### 9.2. Обратное направление (цель)

Целевое состояние — двусторонняя трассируемость: любой runtime-артефакт
поднимается к породившему Canon Fact (`Rule → Concept → Fact → Canon`).
Текущий режим: обязательная ссылка только на bootstrap-пути
(compiler → digest → factIds); для Rules — дисциплина PR (Кодекс PR:
«какой закон, что слушает, что создаёт» + `canonicalRef` recommended).
Машинная обратная ссылка в `RuleRegistry` — только через отдельный ADR.
(Блок 0.9)

---

## 10. Engineering Impact

Каждый Canon Fact глубокой глубины при принятии порождает обязательный
учёт последствий для движка — чеклист ревью (не автогенерацию кода):

1. **Rules** — какие законы создаются/активируются/изменяются;
2. **Events** — какие новые типы Domain Events требуются (со
   `schemaVersion`, §9.7/9.8 ARCHITECTURE.md);
3. **Components** — какие типы компонентов Entity затрагиваются
   (только через обычный цикл правки схемы, ADR-0013);
4. **Projections** — какие read-модели начинают отражать факт
   (с сохранением Projection Purity, §9.6);
5. **Discovery** — какой Observability-канал раскрывает факт и с каким
   Knowledge Cost;
6. **Tests** — unit (Given Event + ReadonlyWorld → Rule → Events),
   replay/детерминизм, observer-scope (отсутствие запрещённых полей);
7. **ADR** — если затронуты принятые контракты (RuleRegistry, Event
   envelope, DTO, deployment).

Canon, не порождающий ничего из списка и не объясняющий почему —
кандидат на отклонение по A−2. World Bible обязана помогать развитию
движка, а не только описывать мир. (Бриф, раздел Engineering Impact;
привязка к gate — Блок 4.2)

---

## 11. Хранение и tooling

### 11.1. Физическая форма (Блок 7.1-A)

Canon = данные, не код. YAML в git, один файл на Concept (единица
ревью), Fact — атом хранения внутри файла. Schema-first: zod-схемы →
generated JSON Schema (`concept.schema.json`, `fact.schema.json`).
Canon переживает смену runtime, языка и tooling.

```
docs/canon/
  ├── universal/
  │    ├── metaphysics/   # reality_structure.yaml
  │    └── laws/          # relation_dynamics.yaml
  ├── regions/
  │    └── pilot-region/  # geography.yaml, monolith.yaml
  ├── anchors/            # реестр CanonicalAnchor
  ├── not-simulated/      # реестр NotSimulatedClaim
  ├── deferred/           # tooling.yaml (Not Built, 11.4)
  └── schema/             # concept.schema.json, fact.schema.json
scripts/canon/            # линтер, генератор WB, query
```

### 11.2. Размещение (Блок 7.2-C)

Сейчас: `docs/canon/` + `scripts/canon/` — AGENTS.md не пересматривается.
Переезд в `packages/canon/` — через отдельный ADR, когда хотя бы один
критерий выполнен: схема используется runtime/compiler; валидатор нужен
нескольким пакетам; проекция стала частью CI. Пакет появляется, когда
контракт — разделяемая инфраструктура (прецедент: `@skald/observation`).

### 11.3. Tooling MVP (Блок 7.3)

- `npm run canon:validate` — схема, ссылки, статусы, lifecycle,
  ацикличность, anchors, deprecated usage, depth constraints. Включается
  в `npm run validate` при появлении `docs/canon/`.
- `npm run canon:generate-wb` — генерирует `WORLD_BIBLE.md`: каркас,
  таблицы фактов, статусы, графы зависимостей, реестр якорей, digest-
  ссылки. Генерируемое никогда не редактируется вручную (A−12).
- Рукописное в WB: философия, rationale, объяснения — со ссылками на
  conceptId (линтер проверяет: ссылка из прозы существует). Проза
  объясняет решение, но не хранит факт. (Блок 7.4-B)
- `canon:digest` — отложен до первого настоящего Compiler; исключение —
  Pre-Canon Digest как migration tool (12.3).
- Codex Context — on-demand проекция (`canon query`), не коммитящийся
  файл: вторая копия знания запрещена (A−1, A−12). (Блок 7.5-B)

### 11.4. Not Built реестр (Блок 7.6-A, A−27)

`docs/canon/deferred/tooling.yaml`: region-compiler (триггер: второй
регион / повторные bootstrap-ошибки), concept-graph-ui (>200 Concepts),
digest-registry (несколько живущих миров), emergence-detector (когда
есть evidence pipeline), relation compatibility matrix.

---

## 12. Pilot Region gating

### 12.1. Минимальный Canon перед компиляцией региона (A−23)

Обязаны быть Canon: Regional Compiler Projection + Universal-факты,
требуемые этой проекцией + Canonical Anchors + каналы наблюдения.
Предыстория делится на **Required History** (создаёт состояние, имеет
последствия, обнаружима — Canon) и **Optional History** (остаётся
Proposed). Canon completeness — consumer-relative, не world-relative.
(Блок 6.1)

### 12.2. Ретро-импорт существующего (A−25)

Bootstrap ADR-0014 не переписывается. Путь: `Existing Bootstrap →
Imported Canon Candidate (provenance: ImportedFromCode) → Review Gate →
Canon Fact`. Старый код получает уважение как исторический источник, но
не иммунитет от Canon-фильтра. (Блок 6.2-A)

### 12.3. Две эпохи digest (A−24)

- **Pre-Canon Digest:** `{ epoch: pre-canon, canonDigest: null,
  compiler: manual, bootstrapDigest }` — историческая запись миров до
  Canon. Не ошибка, а часть истории системы.
- **Canon Genesis Digest:** первый полный кортеж (5.3) — начало
  Canon-эпохи. (Блок 6.5-C)

### 12.4. Deferred при входе (Блок 6.3)

Правило (не список): может остаться Proposed/Experimental/Deferred всё,
что не входит в bootstrap-проекцию, не имеет реализованного
Observation-канала и не требуется существующим Runtime Mapping.
Whitelist — генерируемый Deferred Report, не рукописный список.

### 12.5. Два рубежа готовности (Блок 6.6)

- **Canon-complete** (инженерный): компиляция детерминирована
  (replay-тест зелёный) + все anchors материализованы + каждый
  наблюдаемый факт имеет работающий канал или `plannedRuntime`.
- **Region-complete** (продуктовый): Canon-complete + T-сценарии,
  калибровка, Knowledge Cost, баланс discovery, плотность событий.

`Canon-complete ≠ Region-complete`; калибровка требует прожитого мира
(A−26) и не может блокировать признание Canon готовой.

---

## 13. План создания первой Canon Model

1. **ADR на принятие этого документа** (статус draft → accepted) с
   явным решением об отношении к `docs/worldbuilding/` (§14.1).
2. **Схемы:** `docs/canon/schema/` — zod → JSON Schema для Concept,
   Fact, CanonicalAnchor, NotSimulatedClaim.
3. **Линтер** `canon:validate` (минимум: поля, статусы A−10,
   ацикличность, ссылки) + включение в `npm run validate`.
4. **Ретро-импорт Pilot Region** (12.2): пакетный перенос bootstrap
   ADR-0014 в `regions/pilot-region/` с `ImportedFromCode`, прохождение
   Review Gate по одному Concept.
5. **Universal-ядро, требуемое проекцией региона** (12.1): metaphysics
   (relation-first), законы, реально потребляемые регионом (heat,
   relations, observation), — только они, не всё ядро.
6. **Реестр якорей:** Монолит и стартовая переправа — первые
   CanonicalAnchor с `obligation: required`.
7. **Реестр Not Simulated:** перенос deferred-решений из §11
   ARCHITECTURE.md и ADR-0007 с `reviewAfter`.
8. **Генератор WB** `canon:generate-wb`: первый сгенерированный
   `WORLD_BIBLE.md` как проверка читаемости проекции.
9. **Ручная компиляция** первого регионального батча с `canonicalRefs`
   (5.1) + Pre-Canon Digest для существующих миров (12.3).
10. **Первый Canon Genesis Digest** при первой компиляции из Canon
    Model — открытие Canon-эпохи.

Каждый шаг — отдельный PR, отвечающий Кодексу PR (какой закон/что
читает/что создаёт; для Canon — `canonicalRef` recommended, 4.2.5).

---

## 14. Открытые вопросы и риски

### 14.1. Открытые вопросы

- **Отношение к `docs/worldbuilding/`** (выпало из интервью при
  реструктуризации). Рекомендация: вариант «надстройка» — worldbuilding/*
  остаётся слоем принципов и чеклистов (ADR-0007), Canon Model —
  операционным каноном, между ними promotion-путь (принцип → кандидат в
  Proposed). Требует явного решения в ADR из шага 1 плана (§13).
- **Relation compatibility matrix** (3.3) — типы запрещённых рёбер по
  доменам: проектируется с tooling по A−27.
- **Digest-реестр миров** — появляется со вторым живущим миром (11.4).

### 14.2. Главные риски (сводка R1–R32 интервью)

| Риск | Защита |
|---|---|
| Вторая истина (Canon читается runtime) | A0, A−4, линтер импортов |
| Энциклопедическое разрастание | A−2, A1, мастер-фильтр, Not Simulated |
| Утечка Canon Truth в Narrative | 4.2.4 (Narrative Projection без Truth) |
| Скрытый вход мимо Event Log | A−5 (всё — Events) |
| Недетерминированное рождение мира | A−6 + replay-тест компиляции |
| Тихая правка скомпилированного | A−16, supersedes, digest-граница |
| Декоративная глубина (Simulated на бумаге) | A−19, Runtime Mapping gate |
| Симулятор всего | A−20, A−21, Not Simulated реестр |
| Tooling вместо Canon | A−27, Not Built реестр |
| Гниение ссылок (проза → факты, Rules → Canon) | линтер висячих ссылок, canonicalRef |
| Ретроканон как переписывание истории | 5.4 (только A/B, C запрещён) |
| Преждевременное созревание Universal-ядра | A−23 (consumer-relative completeness) |

---

*Документ является продолжением `docs/ARCHITECTURE.md` в design-time
области и не изменяет ни одного runtime-инварианта. При конфликте с
runtime-конституцией приоритет — за `docs/ARCHITECTURE.md`, AGENTS.md и
принятыми ADR; конфликт фиксируется следующим ADR.*
