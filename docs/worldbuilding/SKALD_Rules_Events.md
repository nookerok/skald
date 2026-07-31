# SKALD — Правила событий и ядра симуляции
## Версия 1.0 | Derived from: Kernel Algorithm v1.0

---

## 1. Intent Collection

**Правило:** Все намерения собираются из единых источников.

**Sources:**
```
sources = [
  PlayerInput,           # игрок через интерфейс
  NPCAgents,             # автономные Entity
  PatternAgency,         # духи, города, экосистемы
  EnvironmentalProcesses # погода, геология, метаболизм
]
```

**MUST:**
- Игрок не имеет приоритета по умолчанию.
- Intents игрока, NPC, духов и environmental processes существуют в едином IntentGraph.

---

## 2. Intent Graph

**Правило:** Все Intents образуют направленный граф с рёбрами зависимостей.

**Построение:**
```python
graph = DirectedGraph<Intent>()
for intent in intents:
    graph.add_node(intent)
    for dep in intent.causal_dependencies:
        if dep in graph:
            graph.add_edge(dep, intent)
```

**Сортировка:**
```python
ordered = topological_sort(graph, key=lambda i: (i.urgency, i.locality, i.impact))
```

**Порядок:**
1. Готовность (все causes выполнены)
2. Urgency ↓ (срочность)
3. Locality ↓ (ближе к фокусу)
4. Impact ↓ (влияние)

**MUST:**
- Intent игрока может быть отодвинут, если NPC Intent имеет выше urgency и locality ближе к фокусу.

---

## 3. Proposal Generation

**Правило:** Каждый Intent формализуется в Proposal или отклоняется как unformalizable.

**Структура Proposal:**
```python
proposal = {
    actor: intent.entity,
    preconditions: intent.preconditions,
    mutations: [],        # (Relation, delta) или (new Relation) или (remove Relation)
    actor_mutations: [],  # изменения самого actor'а (Constraint Participation)
    causal_context: intent.causal_context,
    causal_horizon: estimate_horizon(intent)  # Immediate / Secondary / Long / Semantic
}
```

**MUST:**
- `actor_mutations` вычисляются автоматически через `compute_participation(proposal)`.
- Любое изменение мира изменяет актора (Constraint Participation).
- Если не formalizable → FAILED Event с reason="unformalizable".

---

## 4. Constraint Hierarchy

**Правило:** 4 уровня Constraints, строгий порядок проверки от 0 до 3.

```
enum ConstraintLevel:
    FUNDAMENTAL = 0   # Causality, ScaleLimit, Participation
    PHYSICS     = 1   # физические законы мира
    PATTERN     = 2   # ограничения устойчивости паттернов
    CULTURAL    = 3   # табу, договоры, социальные нормы
```

**Алгоритм:**
```python
def ValidateWithHierarchy(state, proposal) -> (bool, str):
    for level in [FUNDAMENTAL, PHYSICS, PATTERN, CULTURAL]:
        for c in WorldState.constraints.where(level=level):
            if not c.check(state, proposal):
                return (false, c.name)
    return (true, "accepted")
```

**MUST:**
- Первый failed Constraint прерывает цепочку.
- FUNDAMENTAL нарушить невозможно (Causality, ScaleLimit, Participation).
- PHYSICS проверяется до CULTURAL. Если храм обрушился (PHYSICS failed), CULTURAL не имеет значения.

**Пример — Отказ:**
- Intent «Крестьянин осушает болото» → Simulation: нарушает Level 2 (Pattern: болото поддерживает Forest_Stability) → FAILED → крестьянин получает Relation `--warned by--> Village_Elder`.

---

## 5. Transactional Event Commit

**Правило:** Атомарность или полный откат. Нет «частичного успеха».

**Алгоритм:**
```python
def ProcessIntent(intent, graph):
    proposal = GenerateProposal(intent)
    if proposal is NULL:
        failed = CreateFailedEvent(intent, reason="unformalizable")
        WorldState.event_log.append(failed)
        return

    # 5.1 BEGIN TRANSACTION
    tx = BeginTransaction()

    # 5.2 SIMULATE MUTATION
    simulated = ApplyToSandbox(WorldState, proposal, tx)

    # 5.3 VALIDATE POST-STATE
    valid, reason = ValidateWithHierarchy(simulated, proposal)

    if valid:
        # 5.4 COMMIT
        CommitTransaction(tx)
        event = Event(type=SUCCESSFUL, proposal=proposal, ...)
        WorldState.event_log.append(event)
        SynchronizeRelations(tx)
        # 5.5 PROPAGATE DIRTY
        PropagateDirty(event, proposal.causal_horizon)
    else:
        # 5.6 ROLLBACK
        RollbackTransaction(tx)
        failed = Event(type=FAILED, proposal=proposal, rejection_reason=reason, ...)
        WorldState.event_log.append(failed)
        # Отказ порождает последствия
        consequence = GenerateConsequenceFromFailure(failed)
        if consequence:
            graph.add_node(consequence)
```

**MUST:**
- Sandbox изолирован от WorldState до Commit.
- FAILED Event записывается в event_log и порождает consequence.
- Commit → мир изменяется. Rollback → мир не изменяется, но отразится в истории.

---

## 6. Causal Horizon & Dirty Propagation

**Правило:** Глубина распространения последствий зависит от causal_horizon Intent.

```
Immediate (h₁):   Patterns, содержащие изменённые Relations. dirty_depth = 1.
Secondary (h₂):   Causally связанные Patterns. dirty_depth = 2.
Long (h₃):        Семантические связи, экономика, политика. dirty_depth = 3.
Semantic (h₄):    Обновление индексов культуры, истории, мифов. invalidation.
```

**MUST:**
- НЕ пересчитываем весь мир.
- Пересчитываем только dirty Patterns, отсортированные по dirty_depth.
- Settlement на другом конце континента не пересчитывается, если не достигнут через semantic связи.

---

## 7. Incremental Derived State Update

**Правило:** Только dirty Patterns пересчитываются.

```python
def IncrementalDerivedStateUpdate():
    dirty = DerivedState.patterns.where(dirty=true).sort_by(depth)
    for p in dirty:
        p.scale = ComputeScale(p)
        p.stability = EvaluateStability(p)  # S1-S4 (контракт, не формула)
        if p.stability < THRESHOLD_EXISTENCE:
            p.marked_for_dissolution = true
        p.dirty = false
        p.dirty_depth = 0
```

---

## 8. Pattern Lifecycle

**Правило:** Dissolution → Detection → Agency Emergence.

```python
def PatternLifecycle():
    # 8.1 Dissolution
    for p in DerivedState.patterns.where(marked_for_dissolution=true):
        DissolvePattern(p)
        # Распад на sub-patterns или растворение в ambient Relations

    # 8.2 Detection
    components = FindConnectedComponents(WorldState.relations)
    for comp in components:
        if comp not in DerivedState.patterns:
            candidate = Pattern(relations=comp)
            candidate.stability = InitialStability(comp)
            if candidate.stability > THRESHOLD_EXISTENCE:
                DerivedState.patterns.add(candidate)

    # 8.3 Agency Emergence
    for p in DerivedState.patterns:
        if IsSpiritQuery(p) and not p.has_agency:
            p.has_agency = true
            p.can_generate_intents = true
```

**MUST:**
- Agency Emergence — это НЕ reclassify(). Это проверка Query-условий.
- Pattern не хранит свою классификацию. Классификация — вопрос наблюдателя.

---

## 9. Observation Cache Invalidation

**Правило:** Lazy invalidation — помечаем invalid, пересчёт при запросе.

```python
def InvalidateObservations():
    changed_entities = GetEntitiesMutatedThisStep()
    for observer in changed_entities:
        for (obs_key, obs) in DerivedState.observations:
            if obs_key.observer == observer:
                if CausalProximityChanged(observer, obs_key.pattern) or \
                   ResonanceChanged(observer, obs_key.pattern):
                    obs.valid = false
```

---

## 10. Snapshot Generation

**Правило:** Narrative Engine запрашивает виды, не весь мир.

```python
def BuildSnapshots():
    for request in NarrativeRequests:
        snapshot = {
            local: ExtractLocal(request.focus, radius=R_LOCAL),
            regional: ExtractRegional(request.region),
            historical: ExtractCausalChain(request.focus, depth=D_HIST),
            semantic: ExtractSemantic(request.focus)
        }
        DispatchToNarrative(snapshot)
```

**MUST:**
- Narrative Engine работает асинхронно относительно Kernel.
- Narrative Engine НЕ может вызвать ApplyEvent() напрямую.
- Narrative Engine может: читать Snapshots, генерировать текст, предлагать interpretation, отправлять Intent Proposal в очередь.
- Narrative Engine НЕ может: изменять Relations, создавать Events, обходить Constraint Engine.

---

## 11. Main Loop

```python
def SimulationStep():
    intents = CollectIntents()
    graph = BuildIntentGraph(intents)
    ordered = OrderIntents(graph)

    for intent in ordered:
        ProcessIntent(intent, graph)

    IncrementalDerivedStateUpdate()
    PatternLifecycle()
    InvalidateObservations()
    BuildSnapshots()
    # Narrative Layer обрабатывает Snapshots отдельно
```

---

## Event Types (все записываются в EventLog)

| Тип | Описание | Пример |
|-----|----------|--------|
| SUCCESSFUL | Intent прошёл Constraints, мир изменился. | Кузнец создал сплав. |
| FAILED | Intent отвергнут Constraint. Мир НЕ изменился, но отказ записан. | Крестьянин попытался осушить болото — мир отверг. |
| INTERRUPTED | Intent начал выполняться, но другой Event прервал процесс. | Строительство храма остановлено из-за пожара. |
| TRANSFORMED | Intent изменился в процессе (адаптация, компромисс). | Торговля переросла в союз. |

---

## Classification as Query

**MUST:** Pattern не хранит свою классификацию.

**ANTI-PATTERN:**
```python
# Плохо:
pattern.class = "City"
```

**Правильно:**
```python
function IsCityQuery(Pattern p) -> bool:
    return (
        SettlementScore(P) > τ_set
        and EconomicSpecialization(P) > th
        and KnowledgeTransmission(P) > th
        and InfrastructureMaintenance(P) > th
    )

function IsSpiritQuery(Pattern p) -> bool:
    return (
        Stability(P) > τₛ
        and SelfMaintenance(P)
        and IdentityPersistence(P)
        and ExternalRelations(P)
        and AgencyPotential(P)
    )
```
