# Simulation Bible Architecture

**Статус:** Normative + Review Required (двухэтапная модель: после стабилизации —
перевод в ADR-governed конституцию, D-1.4). Подлежит принятию PR-ревью с записью
в AGENTS.md «Sources of truth» и DECISIONS.md.
**Происхождение:** архитектурное интервью, Блоки 0–5 (2026-08-05). Каждое
решение трассируется к блоку и вопросу интервью (Приложение A).
**Связанные документы:** `docs/ARCHITECTURE.md` (runtime-конституция),
`docs/WORLD_BIBLE_ARCHITECTURE.md` (Canon Model), `docs/OBSERVATION_BELIEF_MODEL.md`,
`docs/LIVING_WORLD_REGION_ARCHITECTURE.md`, ADR-0012/0013/0014/0017, AGENTS.md.

Этот документ — не Simulation Bible данных и не описание игрового процесса.
Это архитектура системы описания симуляции: что такое Simulation System, как
она описывается, кто читает описание, как оно попадает в мир и как
контролируется. Содержание мира здесь не создаётся.

---

## 1. Philosophy

### 1.1. Три разделённых авторитета

```
Canon Model          = design authority    (что существует в мире)
Simulation Bible     = system authority    (как это существует в движке)
ARCHITECTURE.md      = execution authority (как исполняется движок)
```

Граница «Canon ↔ SB» проверяется одним вопросом: поле, отвечающее «что
существует», принадлежит Canon; поле, отвечающее «как существует», принадлежит
SB (Блок 1.2-A′). Единственная точка соприкосновения — `systemId`.

### 1.2. Simulation System

> **Simulation System — детерминированная модель предметной области,
> обладающая собственной семантикой состояния и правилами его эволюции,
> которая выражает своё поведение исключительно через Domain Events.** (D-0.1)

Критерий независим от реализации read-side: Projection обязана уметь
*восстановить* состояние системы из Event Log, но не определяет
принадлежность. Проверочный тест: «если систему удалить, какой аспект
состояния мира теряет владельца?» — нет ответа → не система.

Не являются системами: UI, Narrative, Discovery, Presentation, Observation
Engine, Belief, Trace (read-side — измеряют и описывают, не изменяют);
Presence/session, очереди, idempotency (инфраструктура).

Являются системами: Hydrology, Heat, Ecology, Population, Economy, Relations,
Weather, Structural Integrity и подобные модели предметной области.

### 1.3. Механизмы принадлежат движку

Situation, Consequence, Tick, Scheduler, Execution Phases — части
**вычислительной модели**, принадлежат ARCHITECTURE.md (D-0.2). SB никогда не
определяет механизмы, только ссылается: `uses: Situation Lifecycle`.
Дублирование спецификации механизма — архитектурное нарушение.

### 1.4. SB — design-time authority, представленный машиночитаемыми данными

```
человек редактирует SB
        ↓
Compiler преобразует SB → Bootstrap Events / Rule Registry
        ↓
runtime знает только результат компиляции
```

Runtime никогда не читает SB (D-1.1). Любое влияние SB на мир проходит через
Event Log — иначе это Hidden Configuration (V-02). SB не является «runtime
configuration»: семантика компиляции, не загрузки.

---

## 2. Design Principles

Аксиомы SB. Изменение любой — через review (после перевода в ADR-governed —
только через ADR).

- **Authority Principle.** Каждый архитектурный факт имеет ровно одного
  владельца: Canon — что существует; SB — как устроена система; Architecture —
  как исполняется движок; Events — что произошло; Projection — что известно;
  Narrative — как показано. (Блок 2.3)
- **Derived Knowledge Principle (DKP).** Если информация может быть однозначно
  вычислена из авторитетных источников истины, она не хранится как
  самостоятельная часть архитектуры. Обобщает Projection Purity, A−3/A−12
  Canon, вычисляемый Dependency Rank, вычисляемый порядок документа.
  Возвышение до кросс-документной аксиомы проекта — отдельный ADR. (Блок 2)
- **Stable Interface Principle.** Внешние потребители могут зависеть только от
  Public Contract системы. Архитектурный аналог инкапсуляции: внутренняя
  реализация Heat меняется, не ломая Weather. (Блок 2.3)
- **Consumer Rule.** Каждое поле описания системы обязано иметь явного
  потребителя (Compiler / линтер / ревью / тест). Поле без потребителя —
  кандидат на удаление. Применяется и к элементам Public Contract: элемент
  контракта обязан назвать *внешнего* потребителя. (Блок 2.2)
- **Observable Equivalence Principle.** Две реализации одного класса верности,
  порождающие одинаковые Domain Events и одинаковые Owned Aspects при
  одинаковом Event Log, архитектурно являются одной системой. Легализует смену
  алгоритмов, оптимизации, кэши. Отвечает на вопрос: «можно ли заменить
  реализацию?» (Блок 3.5a)
- **Refinement Compatibility.** Для системы с несколькими классами верности
  `fold: Full → Aggregated` и `unfold: Aggregated → Full` — детерминированные
  документированные функции; unfold порождает деталь только из seed'ов
  Event Log. Отвечает на вопрос: «можно ли изменить уровень верности?» —
  это отображение между разными пространствами состояния, не эквивалентность.
  (Блок 3.5a)
- **Refinement Consistency.** `fold(unfold(x)) == x` для любого допустимого
  агрегированного состояния. Развёртка может синтезировать детали, но не
  имеет права изменить агрегированную семантику мира. Обратное требование
  (`unfold(fold(x)) == x`) математически невозможно и не предъявляется.
  (Блок 3.5a)
- **System Determinism Principle.** Для фиксированных Bootstrap, Event Log и
  System Binding поведение системы — чистая функция. Любое различие
  наблюдаемого поведения при одинаковых входных данных — архитектурное
  нарушение. Следствия — Determinism Charter (§8.1). (Блок 4.1)
- **Evidence Completeness Principle.** Любое нормативное утверждение SB
  обязано иметь хотя бы один способ проверки: Review, Lint, Test или Trace.
  Правило без механизма обнаружения нарушения — не контракт, а рекомендация.
  (Блок 4.5)
- **Enforcement follows maturity.** Каждое правило проходит эволюцию:
  `Normative → Review → Schema → Lint → Trace → Hard Gate`. Tooling не
  предшествует зрелости данных (симметрия с A−27 Canon). (Блок 4.4)

---

## 3. Simulation Topology

Слово **Layer запрещено** в SB (D-0.5): оно неизбежно читается как иерархия
владения. Порядок — производное свойство графа, не сущность модели.

### 3.1. Два графа, не дерево

> **Simulation Systems образуют ориентированный граф зависимостей, а не дерево
> владения.** (D-0.4)

- **`dependsOn`** (структурная зависимость): «система B не может существовать
  без состояния/событий системы A». **Граф `dependsOn` — DAG** (DAG-1,
  ацикличен; линтер: cycle detection + missing references).
- **`influences`** (динамическое влияние): «события системы A потребляются
  законами системы B». Может содержать циклы — нормальная модель обратной
  связи (`Weather → FireSpread → Smoke → Climate → Weather`).

Каждое ребро обязано иметь `dependencyEvidence` — конкретное состояние или
событие, читаемое законом. Ребро «для полноты картины» — Phantom Dependency
(V-08). Вопросов «кто главный / кто владеет системой» не существует;
существуют только зависимости.

### 3.2. Правила графа

- **DAG-2. Нет прямых ссылок.** Simulation Systems никогда не имеют прямых
  ссылок друг на друга. Единственный канал взаимодействия — Domain Events
  через Event Log и Rule Phases. Проверяемо на уровне кода (запрет стиля
  `weather.update()`).
- **DAG-3. Монотонность стабильности.** Система не может зависеть
  (`dependsOn`) от менее стабильной системы. Частичный порядок:
  `Core ← Candidate ← Experimental ← Proposal` (зависимость разрешена только
  в сторону стрелки). Правило инвариантно к появлению новых стадий lifecycle.
- **DAG-4. Единственный владелец.** Каждый аспект состояния мира имеет
  единственного владельца-систему; одна система может владеть несколькими
  аспектами (`Heat` владеет `Temperature`, `StoredEnergy`,
  `IgnitionPotential`; но `Temperature` не принадлежит одновременно `Heat` и
  `Weather`). Основное правило будущего линтера.

### 3.3. Dependency Rank

**Dependency Rank** — производная топологическая характеристика узла
`dependsOn`-DAG, вычисляемая выбранным алгоритмом ранжирования (D-2.1).
Конституция не привязана к алгоритму.

```
Current implementation: Longest Path Rank
```

`influences` в ранг не входит (цикличен по определению). Ранг используется
только как presentation-порядок разделов генерируемых документов; порядок
исполнения он не описывает и не обещает — порядок исполнения принадлежит
Execution Model (D-0.2). Хранение ранга как данных запрещено (DKP).

### 3.4. Жизненный цикл системы

```
Proposal → Review → Experimental System → Candidate → Core System
```

(D-0.3, с уточнением Блока 2.2 о профиле полноты.) Experimental имеет
`systemId`, но не является частью конституции; у Experimental обязателен
`reviewAfter` (защита от Experimental-болота). Предлагать систему может кто
угодно; принимает — автор (паттерн Canon: Proposal ≠ Authority).

**System Definitions не являются частью конституции автоматически** (D-5.3):
`docs/simulation/` может содержать Proposal/Experimental/Candidate/Core;
`SIMULATION_BIBLE_ARCHITECTURE.md` описывает только правила существования
этих сущностей.

---

## 4. Runtime Integration

(Раздел назван Integration, не Mapping: он описывает интеграцию слоёв
архитектуры, а не только отображение, D-5.4.)

### 4.1. Разделение владения Canon ↔ SB

```
Canon владеет:    Fact → SimulationDepth → systemId     (Runtime Mapping, §9 WB Architecture)
SB владеет:       systemId → Public Contract / Operational Profile / Private Design
```

Runtime Mapping остаётся частью Canon. SB никогда не дублирует цепочку
`Fact → Rules → Events → …`; Canon никогда не описывает state space,
scheduler, budgets системы. Полнота описания масштабируется со стабильностью
(D-2.2): Proposal — ядро; Experimental — + state space, transitions,
determinism constraints; Candidate — + budgets, replay, тестовые сценарии;
Core — + полные следы (Events/Rules/Projections), Discovery/Observation
каналы, Engineering Impact чеклист.

### 4.2. Три ортогональных понятия (D-2.0)

```
Canon          SimulationDepth   «насколько мир обязан это симулировать»
                                  (NarrativeOnly | Observable | Simulated | CoreSimulation)
SB             UpdateModel       «как эта система живёт» (§6)
Architecture   ExecutionModel    «в каком порядке исполняется Rule Engine»
```

**Правило согласованности:** Update Model системы ограничивает допустимый
Simulation Depth ссылающихся на неё Canon-фактов (`Static`-система не
обслуживает `CoreSimulation`-факт). Нарушение — V-10. Первый
кросс-документный линтер.

### 4.3. Definition → Binding → Runtime Instance (D-1.3)

- **System Definition** — что система умеет. Универсальна, кросс-региональна.
- **System Binding** — как система активирована в конкретном мире (через
  bootstrap; существующие механизмы `LawRegistered`, региональный bootstrap
  ADR-0014).
- **Runtime Instance** — прожитое. Принадлежит Event Log / Historical
  Projection, никогда не описывается в SB.

### 4.4. Структура System Definition (D-2.3)

```
System Definition
├── Public Contract            (виден Canon, Compiler, линтеру, другим системам)
│     ├── Identity             systemId, Lifecycle Status, Version
│     ├── Dependencies         Owned Aspects, dependsOn, influences (+dependencyEvidence)
│     ├── Observable Surface   Events (emit/consume), Observation Channels,
│     │                        Discovery Output — всё, чем внешний мир наблюдает систему
│     └── Guarantees           §4.6
├── Operational Profile        (потребители: Compiler, Scheduler — не другие системы)
│     └── Update Model, Budget, Persistence/Replay
└── Private Design             (виден автору и ревьюеру; внешние зависимости запрещены)
      └── внутренняя семантика состояний/переходов, разбиение на Rules,
          rationale, Derived Structures (кэши, индексы, lookup-таблицы)
```

Зависимость внешнего потребителя от элемента Private Design — Private Leakage
(V-04). Derived Structures названы Private явно: именно они чаще всего
«протекают» наружу.

### 4.5. Параметры (D-2.3a)

Definition объявляет параметр, допустимый диапазон и default; Binding только
присваивает значения объявленных слотов и **никогда не вводит новые
параметры** — иначе Definition перестаёт быть контрактом.

```
Definition:  Ignition Temperature   Range: 100–600   Default: 250
Binding:     Forest World → 180     Frozen World → 340
```

Количественные значения калибровки — не Canon (Canon Блок 0.13); их дом —
Binding. Слоты и диапазоны — часть контракта Definition.

### 4.6. System Guarantees (D-3.5)

Guarantees — обязательства, которые система даёт внешнему миру; переживают
смену реализации, реструктуризацию Rules и переход между классами верности.
Часть Public Contract (не Operational Profile: гарантия — про смысл).
Обязательны с Candidate (D-2.2).

```yaml
guarantees:
  - id: heat-temperature-nonnegative
    statement: "Temperature is never negative"
    kind: invariant            # invariant | conservation | impossibility
    scope: aspect              # aspect | system | interaction
    consumer: [replay-test, rule-review]
    evidence:                  # implementationEvidence: минимальный набор реализаций
      - Rule: HeatEnergyApplied
      - Rule: CoolingApplied
```

Симметрия: `dependsOn → dependencyEvidence`, `Guarantee →
implementationEvidence`. Линтер проверяет обе стороны: гарантия имеет тест и
гарантия реализована. Гарантия без теста или реализации — Hollow Guarantee
(V-05). Непроверяемая гарантия («system is fair») не проходит Consumer Rule.

---

## 5. State Model

> **State Model описывает семантическое пространство состояния системы —
> множество допустимых конфигураций. Owned Aspects являются его публичной
> проекцией.** (D-3.1)

Направление зависимости, никогда наоборот:

```
State Space → Owned Aspects → Projection
```

Явных state machines нет: состояние не хранится, а выводится из событий
(DKP); state machine поверх event sourcing создала бы второе хранилище
истины. State space фиксируется как реестр Owned Aspects с доменами значений
(`Temperature: ℝ ≥ 0`); переходы — документированные паттерны «событие →
изменение аспекта» со следами на категории Rules. Механика переходов
принадлежит Rules (Authority Principle), SB её не дублирует.

Домены аспектов — то, что реально потребляют Compiler и линтер DAG-4.

---

## 6. Update Model

### 6.1. Значения (закрытый список)

```
Static       существует только как скомпилированное начальное состояние
OnDemand     реагирует только в цепочках, начатых командами игрока
EventDriven  Rules слушают Domain Events других систем (influences-граф)
TickDriven   Rules слушают TickPassed
```

Значение **`Continuous` запрещено как термин** (D-2.0a): непрерывного времени
в конституции нет; термин, обещающий его, провоцирует будущий continuous
solver. «Непрерывный» процесс выражается как `TickDriven` с обязательной
фиксацией дискретизации (прецедент: речная гидрология ADR-0017 — циклический
процесс через `TickPassed`-цепочки).

### 6.2. Нормативная таблица отображения (D-3.2)

> **Каждое значение Update Model имеет единственную нормативную реализацию в
> Execution Model.** Это ABI между SB и движком, не рекомендация.

```
Static       → только bootstrap (скомпилирован однажды, тиков нет)
OnDemand     → цепочки от команд игрока
EventDriven  → Rules слушают Domain Events
TickDriven   → Rules слушают TickPassed
```

Все четыре механизма уже существуют в движке; SB их именует и связывает, не
изобретая (D-0.2). Линтер проверяет след в обе стороны: `TickDriven`-система
обязана иметь Rule, слушающий `TickPassed`; Rule, слушающий `TickPassed`,
обязан принадлежать системе с `TickDriven`. Новое значение Update Model =
изменение конституции SB.

---

## 7. Persistence Model

В event-sourced архитектуре персистентность тривиальна: каноническое
состояние всегда живёт в Event Log. Раздел Persistence системы **не
описывает хранение** (таблицы, поля, миграции принадлежат `packages/events` и
SQLite-схеме — Authority Principle).

Раздел содержит ровно:

1. **Replay Assumptions** (§8.2);
2. **Derived Structures** системы с обязательством перестраиваемости из лога
   без остатка (кэш ≠ состояние, DKP);
3. связку Binding → bootstrap → `bootstrapDigest` (идентичность реплея
   гарантирована Genesis Digest, §14.1).

Раздел без этих трёх элементов — пустой и не пишется (Consumer Rule).

---

## 8. Replay Model

### 8.1. Determinism Charter (D-4.1)

Следствия System Determinism Principle на уровне системы:

- **Seed Discipline** — источник псевдослучайности только детерминированный
  seed, выводимый из Bootstrap и Event Log (как Compiler, A−6 Canon).
- **No Wall Clock** — время поступает только через события (`TickPassed`).
- **Explicit Ordering Assumptions** — любые требования к порядку событий
  перечислены в Replay Assumptions, не являются молчаливым знанием.
- **Deterministic Refinement** — `fold` и `unfold` — чистые функции.
- **Derived Isolation** (отдельное именованное правило) — Derived Structures
  никогда не влияют на порождаемые события. Кэш — только ускорение; кэш,
  влияющий на события, — скрытое состояние мимо Event Log (V-02/V-06).

### 8.2. Replay Assumptions (D-3.3)

Каждая система явно перечисляет предположения, от которых зависит её реплей:

```
- Events are totally ordered
- Duplicate TickPassed is impossible
- Bootstrap precedes every runtime event
```

Именно нарушение assumption ломает replay — поэтому каждый assumption имеет
потребителя: replay-тест (Consumer Rule). Формат «список опасных мест»
запрещён: assumption — проверяемое утверждение, не предупреждение.

---

## 9. Discovery Integration

Observation Channels системы (элемент Observable Surface) — единственный путь,
которым факт, проживаемый системой, становится обнаружимым (правило вывода
§12: Observation Channels → Discovery candidates).

Канал наблюдения, влияющий на мир, обязан иметь Event-представление
(`ObservationChannelRegistered`, Canon A−5) — скрытый канал мимо Event Log
запрещён. Knowledge Cost и Observability-тип принадлежат Canon Fact; SB
описывает только, каким каналом система открывает свои Owned Aspects, и
никогда — что игрок «должен узнать» (граница с Discovery read model, ADR-0001).

---

## 10. Observation Integration

Observable Surface системы отвечает: что из состояния системы доступно
наблюдателю и через какие каналы. Семантика observer scope, freshness,
contradiction, DTO — принадлежит `docs/OBSERVATION_BELIEF_MODEL.md`
(нормативный контракт, D-013); SB ссылается, не дублирует.

Обязательства системы перед Observation:

- каждый Owned Aspect либо имеет канал наблюдения, либо явно маркирован
  скрытым (скрытое состояние легально как истина мира, но недостижимо для
  игрока напрямую — только через следствия);
- скрытая причина никогда не раскрывается через побочные каналы (прецедент:
  `ActionHadNoObservableEffect` честен о тишине, ADR-0013 Slice 2);
- система не знает о существовании наблюдателей: Observation Engine — единый
  слой наблюдения за Simulation Core (AGENTS.md).

---

## 11. Rule Integration

- Update Model определяет категорию Rules системы (§6.2) и обязательный
  listener-след, проверяемый линтером.
- Разбиение системы на конкретные Rules — Private Design; публичным следом
  является `implementationEvidence` гарантий (§4.6).
- Запрещённые концепции (Spell, Mana, XP, NPC.decide(), …) — по ссылке на
  AGENTS.md; SB не дублирует список. SB добавляет системную формулировку
  запрета: система не может реализовывать механику, запрещённую конституцией
  (прогрессия, классы, кулдауны), независимо от названия системы.
- Runtime-генерация правил запрещена конституцией; SB не вводит механизмов
  регистрации систем в runtime — система попадает в мир компиляцией, не
  загрузкой (§1.4).

---

## 12. Engineering Impact

### 12.1. Правила вывода (D-4.3)

Каждая System Definition нормативно порождает инженерные обязательства.
Сейчас — чеклист ревью (прецедент Canon §10: чеклист, не автогенерация);
машинная проверка — tooling по Enforcement follows maturity.

```
Observable Surface (events)     → Event candidates
Owned Aspects                   → Projection candidates (один владелец, DAG-4)
Update Model                    → Rule category + обязательный listener-след
Observation Channels            → Discovery candidates + BeliefModel интеграция
Guarantees + Replay Assumptions → тестовые сценарии
supports: [Full, Aggregated]    → fold/unfold контракт + Refinement Consistency тест
новое значение Update Model     → ADR candidate
новая Core-система              → ADR candidate
изменение ABI (§6.2)            → ADR candidate
```

### 12.2. Violation Candidates (D-4.3, дополнение)

Изменения системы автоматически порождают **обязательные проверки**:

```
Public Contract изменён      → проверить V-04, V-10
supports: Aggregated         → Refinement tests + Replay tests + V-06 checks
новое ребро dependsOn        → cycle detection + V-08 + DAG-3
новая Guarantee              → V-05 (тест + implementationEvidence)
Derived Structure добавлена  → Derived Isolation review (V-02/V-06)
```

Engineering Impact — генератор не только артефактов, но и обязательных
проверок.

### 12.3. Кодекс PR

PR с System Definition отвечает существующему Кодексу PR («какой закон, что
читает, что создаёт») и дополнительно: какой `systemId`, какие решения §12.1
порождены, какие проверки §12.2 выполнены, `canonicalRef` — по правилам Canon
(4.2.5 WB Architecture).

---

## 13. Simulation Budget

### 13.1. Классы верности, не расписания (D-3.4)

```
Full          детерминированная симуляция процессов
Aggregated    процессы свёрнуты в статистические законы (та же система, грубее)
BootstrapOnly только скомпилированное начальное состояние, эволюции нет
Never         не класс SB — ссылка на Canon NotSimulatedClaim (Authority Principle)
```

Мир **никогда не останавливается по расстоянию до игрока** (ADR-0012,
GLOSSARY Simulation Cell: «scheduling must not pause the world based on
player distance»). Бюджет управляет разрешением проживания, не
существованием: агрегированная система продолжает эволюционировать, грубо.
Класс `Static` исключён из шкалы (коллизия с Update Model закрыта термином
`BootstrapOnly`).

### 13.2. Владение выбором (D-3.4a)

```
Definition:  supports: [Full, Aggregated]   «что система умеет»
Binding:     uses: Aggregated               «что миру по средствам»
```

Класс бюджета — атрибут Binding (мир решает), не Definition и не глобального
реестра. Один Definition может быть `Full` в активном регионе и `Aggregated`
на периферии.

### 13.3. Fidelity-переходы

Переход верности в живущем мире — runtime-переход через документированные
fold/unfold, порождённый Domain Events, с обязательным Refinement Consistency
тестом (§2). Это не миграция Canon (§14.2).

---

## 14. Canon Lifecycle

### 14.1. Genesis Digest (D-5.1)

> **SB никогда не участвует в идентичности мира напрямую. Она участвует только
> через артефакты, которые производит.**

```
SB Definition → Compiler → Bootstrap Events → bootstrapDigest
```

System Binding обязан полностью материализоваться в bootstrap-событиях —
тогда он автоматически покрыт существующим `bootstrapDigest` (Canon 5.3).
Параллельных digest для SB не существует. `sbRegistryVersion` добавляется в
digest-кортеж только с появлением настоящего Compiler — отложено по
Enforcement follows maturity (как `canon:digest`). Правило автоматически
распространяется на любые будущие артефакты SB.

### 14.2. Evolution, не Migration (D-5.2)

SB не вводит собственной модели миграции. Существует три принципиально
разных процесса эволюции системы:

- **новая Definition** — версия системы для новых миров (наследует Canon
  5.4-A; живущие миры остаются на своём digest навсегда);
- **компенсирующие события** — мир *узнаёт* новое через аппенд Domain Events
  (наследует Canon 5.4-B; bootstrap не заменяется);
- **runtime refinement** — смена класса верности через fold/unfold (§13.3).

Полная пересборка (новый bootstrap + replay старого лога) конституционно
запрещена (Canon 5.4-C) — SB наследует запрет без изменений. История мира —
исторический артефакт; системы не переписывают прошлое прожитых миров.

### 14.3. Ретроканон и ретро-импорт

Импорт существующих runtime-систем в SB (`Existing Rules → System Definition
candidate → Review`) повторяет паттерн Canon A−25: код может быть источником,
но никогда авторитетом; `Code == SB` — никогда. Pilot Region и bootstrap
ADR-0014 не переписываются.

---

## 15. Development Roadmap

```
SIMULATION_BIBLE_ARCHITECTURE.md  (этот документ; Normative + Review)
        ↓
ревью на соответствие принятым решениям (без новых концепций)
        ↓
первая System Definition: River Hydrology   (существующая TickDriven система,
        ↓                                     ADR-0017 — проверка схемы на
Architecture Review шаблона                  реальном материале)
        ↓
вторая System Definition → масштабирование
```

1. **Документ одним PR** → ревью → запись в AGENTS.md «Sources of truth» и
   DECISIONS.md (индекс решений). `docs/simulation/` создаётся только вместе с
   первой System Definition (структура зеркалит `docs/canon/`: `definitions/`,
   `bindings/`, `schema/`, `violations.md`).
2. **Architecture Review шаблона** после первой реальной Definition: первая
   реализация показывает скрытые недостатки конституции; масштабирование —
   только после ревью.
3. **Validate-этапы** (D-4.4): (1) сейчас — документ + дисциплина ревью,
   `npm run validate` не меняется; (2) Schema stage — zod-схемы + линтер
   (DAG, ссылки Canon↔SB, Consumer Rule, DAG-3, V-10), `sb:validate` входит в
   `npm run validate`; (3) Trace stage — линтер SB↔код (listener-следы,
   implementationEvidence, V-03 по импортам). Каждый этап — отдельный PR,
   включаемый по готовности данных.
4. **Перевод в ADR-governed** (D-1.4) — после стабилизации, явной фиксацией.
5. **SYSTEM_DEFINITION_GUIDE.md** — методологический документ (рекомендации,
   примеры, типичные ошибки, примеры V-нарушений), пишется после Architecture
   Review шаблона. Не источник истины: конституция / руководство автора /
   реальные данные — три разных сущности.

---

## Violation Registry

Закрытый типизированный реестр архитектурных нарушений (D-4.2). Каждое
нарушение имеет ID, имя и уровень обнаружения; группировка — по нарушаемой
аксиоме. Новое V — только через review/ADR; единичный случай решается ревью
без расширения реестра. Реестр выносится в `docs/simulation/violations.md`
при создании каталога.

### Authority (Authority Principle, DKP)

```
V-01 Second Truth Source        SB/Canon дублируют чужую область владения
V-02 Hidden Configuration       влияние на мир мимо Event Log
```

### Interface (Stable Interface Principle)

```
V-03 Direct System Reference    система ссылается на систему не через Events
V-04 Private Leakage            внешний потребитель зависит от Private Design
V-05 Hollow Guarantee           гарантия без теста или implementationEvidence
```

### Determinism (System Determinism Principle)

```
V-06 NonDeterministic Synthesis unfold/seed вне Event Log; кэш влияет на события
V-07 Stored Derived Knowledge   хранение вычислимого (нарушение DKP)
```

### Architecture (топология и согласованность)

```
V-08 Phantom Dependency         ребро dependsOn/influences без dependencyEvidence
V-09 Layer Hierarchy            описание систем как дерева/уровней владения
V-10 Depth/Update Mismatch      Canon depth несовместим с Update Model системы
```

---

## Приложение A. Трассировка решений к интервью

| Решение | Содержание | Блок |
|---|---|---|
| D-1.1 | SB — design-time authority, машиночитаемые данные, компиляция в runtime | 1.1-C |
| D-1.2 | Canon владеет Fact→systemId; SB владеет описанием systemId | 1.2-A′ |
| D-1.3 | Definition → Binding → Runtime Instance | 1.3-C |
| D-1.4 | Normative+Review → ADR-governed | 1.4 |
| D-0.1 | Определение Simulation System; независимость от Projection; единственный владелец аспекта | 0.1-D′ |
| D-0.2 | Механизмы — ARCHITECTURE.md; SB только `uses:` | 0.2-C |
| D-0.3 | Lifecycle Proposal→Review→Experimental→Core | 0.3-C′ |
| D-0.4 | Граф зависимостей, не дерево; DAG-1 (dependsOn — DAG); DAG-2 (нет прямых ссылок); DAG-3 (монотонность стабильности); DAG-4 (единственный владелец) | 0.4 + правки |
| D-0.5 | Слово Layer запрещено | Блок 0→2 |
| D-2.0 | SimulationDepth (Canon) / UpdateModel (SB) / ExecutionModel (Architecture) | 2.0-A |
| D-2.0a | Continuous запрещён как термин | 2.0a |
| D-2.1 | Dependency Rank — абстрактная топологическая характеристика | 2.1-A |
| D-2.2 | Профиль полноты масштабируется со стабильностью; Consumer Rule | 2.2-C |
| D-2.3 | Public Contract (Identity/Dependencies/Observable Surface) / Operational Profile / Private Design | 2.3 |
| D-2.3a | Definition объявляет параметры; Binding присваивает, не добавляет | 2.3a-(ii) |
| D-2.3+ | Stable Interface Principle; Authority Principle | Блок 2.3 |
| D-3.1 | State Space → Owned Aspects → Projection | 3.1-A |
| D-3.2 | Update Model — ABI; единственная нормативная реализация | 3.2-A |
| D-3.3 | Replay Assumptions вместо «опасных мест» | 3.3-A |
| D-3.4 | Классы верности Full/Aggregated/BootstrapOnly; Never — Canon | 3.4-A |
| D-3.4a | Definition supports / Binding uses | 3.4a-(ii) |
| D-3.5 | System Guarantees в Public Contract; implementationEvidence | 3.5 |
| D-3.5a | Observable Equivalence / Refinement Compatibility / Refinement Consistency | 3.5a |
| D-4.1 | System Determinism Principle + Charter + Derived Isolation | 4.1-A |
| D-4.2 | Violation Registry, группировка по аксиомам | 4.2-A |
| D-4.3 | Derivation rules + Violation Candidates | 4.3-A |
| D-4.4 | Enforcement follows maturity; три этапа validate | 4.4-A |
| D-4.5 | Evidence Completeness Principle | 4.5 |
| D-5.1 | SB в идентичности мира — только через артефакты | 5.1-A |
| D-5.2 | Evolution (не Migration): три процесса | 5.2-A |
| D-5.3 | System Definitions ≠ конституция автоматически | 5.3-A |
| D-5.4 | Runtime Integration (не Mapping) | 5.4 |
| D-5.5 | Roadmap с Architecture Review шаблона; GUIDE отдельно | 5.5 |

---

*Документ является продолжением `docs/ARCHITECTURE.md` и
`docs/WORLD_BIBLE_ARCHITECTURE.md` в области описания симулируемых систем и не
изменяет ни одного runtime-инварианта. При конфликте с runtime-конституцией
приоритет — за `docs/ARCHITECTURE.md`, AGENTS.md и принятыми ADR; конфликт
фиксируется следующим ADR.*
