# SKALD — Чек-листы для команды разработки
## Версия 1.0 | Derived from: все спецификации SKALD

---

## C1. Чек-лист создания региона / локации

- [ ] Каждая локация имеет ≥1 причину существования в графе Relations (не «красиво»)
- [ ] География — археология: каждый рельеф объяснён древними процессами (циклы, катастрофы)
- [ ] Нет «пустого» пространства: между точками интереса — Relations, не километры
- [ ] Есть ≥1 Environment Entity с Process (река, лес, гора)
- [ ] Есть потенциал для эмерджентности: Resource + Entity + Time → возможен Settlement/Spirit/Religion
- [ ] Нелокальность обоснована: «складки» связаны с древними структурами, не магией «потому что»
- [ ] История региона записана в ландшафте, не в книгах
- [ ] Нет биомов без причины
- [ ] Регион имеет древнее происхождение, отражённое в рельефе
- [ ] Локации связаны Relations, не только географически

---

## C2. Чек-лист создания NPC / Human Entity

- [ ] Нет таблицы stats — только state (persistence, integrity, resources, location)
- [ ] Определены capabilities: perceive, act, maintain_relations
- [ ] Определены needs: required_relations (еда, укрытие, социум)
- [ ] Intent Sources заданы: seek_resource, build, negotiate, investigate, ritual
- [ ] Память — граф Relations с Events, не массив фактов
- [ ] NPC живёт независимо от игрока (собственный цикл Intents)
- [ ] Нет «квестгиверской» маркировки — NPC может отказать, игнорировать, умереть
- [ ] NPC не имеет уровня — сила производна от Relations
- [ ] Смерть NPC = распад Pattern с распределением Relations
- [ ] NPC может потерять Human-архетип (потеря symbolic_memory, social_learning)

---

## C3. Чек-лист создания Artifact / Постройки

- [ ] Определены поддерживающие Relations (кто/что поддерживает структуру)
- [ ] Нет HP — только Stability через Relations
- [ ] Путь распада задан: какой Ruin Pattern эмерджирует при потере Stability
- [ ] Artifact может стать Sacred Place при накоплении Events + Relations
- [ ] Artifact не существует без поддерживающих Relations
- [ ] Распад не мгновенный — требует τ_persistence шагов
- [ ] Ruin Pattern — новый Pattern, не «тот же с class=ruin»

---

## C4. Чек-лист создания культа / религии (эмерджентной)

- [ ] Stage A: ≥2 Entity получили Shared Observation одного Pattern
- [ ] Stage B: Repeated Ritual Events ≥ 10, коррелирующих со Stability ↑
- [ ] Stage C: Interpreter Node выделился через Resonance / Memory / Accuracy
- [ ] Stage D: Sacred Space накопил ≥1000 Events + Relations → самостоятельный Pattern
- [ ] Миф = Lossy Compression Event History + Semantic Drift (может быть фактически неверен)
- [ ] Religion Constraint (Level 3) может быть отвергнут Fundamental Constraint → сюжетный конфликт
- [ ] Религия не создана дизайнером — эмерджирует из Events
- [ ] Shared Belief Relations ≥ threshold
- [ ] Historical Memory ≥ threshold
- [ ] Social Transmission ≥ threshold
- [ ] Myth Persistence ≥ threshold

---

## C5. Чек-лист создания события / квест-ситуации

- [ ] Event имеет actor (Entity), preconditions, mutations (Relations), causal_context
- [ ] Прошёл Constraint Hierarchy L0→L3 в Sandbox перед Commit
- [ ] Если FAILED — записан в EventLog и порождает consequence (обучение, табу, адаптация)
- [ ] Causal Horizon определён: Immediate / Secondary / Long / Semantic
- [ ] Нет глобального таймера — причинность через Event Graph, не часы
- [ ] Narrative Layer читает Snapshot, не модифицирует Relations напрямую
- [ ] actor_mutations вычислены автоматически (Constraint Participation)
- [ ] Event имеет causal_dependencies в IntentGraph
- [ ] Нет «квестовой» маркировки — ситуация эмерджентна
- [ ] Игрок может не вмешиваться — мир развивается сам

---

## C6. Чек-лист баланса / калибровки региона

- [ ] Settlement возникает за сотни шагов, не десятки (I1: жизнь медленнее событий)
- [ ] Город не растёт бесконечно — scale_penalty остановит при scale > σ₀
- [ ] Духи редки — не каждый лес (τₛ высокий, ExternalRelations строги)
- [ ] ~20% регионов в конфликте, не 100% (ConflictPotential требует комбинации факторов)
- [ ] Культ формируется дольше торгового союза (MythPersistence требует поколений)
- [ ] Нет «хаков»: если нужно специальное правило для игрока — параметр неисправен
- [ ] Проверен тест T1 (Settlement Emergence)
- [ ] Проверен тест T8 (False Emergence)
- [ ] Проверен тест T9 (Dynamic Stability)
- [ ] Проверен тест T11 (Collapse-Rebirth)

---

## C7. Чек-лист магического акта

- [ ] Магия = изменение Relations через участие, не контроль
- [ ] Нет школ магии / каталога заклинаний / маны
- [ ] Цена определена: actor_mutations изменяют актора
- [ ] Понимание → Подготовка → Действие → Последствие
- [ ] Действие проходит через тот же Kernel (Intent → Proposal → Validation → Commit)
- [ ] Нет специального «магического канала»
- [ ] Слабая магия повседневности отделена от глубокой магии
- [ ] Глубокая магия вызывает страх и изменяет актора необратимо
- [ ] Магия не «оружие» — это инженерия Relations

---

## C8. Чек-лист нарратива / текста

- [ ] Текст генерируется из Snapshot, не из скрипта
- [ ] NPC говорит из своей Observation, не из «истины»
- [ ] Два NPC могут помнить одно событие по-разному — оба правы локально
- [ ] Миф может быть фактически неверен, но системно правильным
- [ ] Игрок видит Observation, не Truth
- [ ] Нет «квестового автомата» — нет маркеров, стрелок, журналов квестов
- [ ] События интерпретируются игроком, не навязываются
- [ ] История накапливается в EventLog, не сбрасывается

---

## C9. Чек-лист UI / интерфейса

- [ ] UI показывает Observation, не Truth
- [ ] Нет метки «ИСТИНА» — только «Ты видиши...»
- [ ] Нет уровня персонажа, шкалы маны, списка заклинаний
- [ ] Нет индикаторов «квест активен» — события видны через мир
- [ ] Карта — не евклидова (если есть)
- [ ] Интерфейс отражает Relations, не stats
- [ ] Изменение игрока сигнализируется через Observation, не UI-уведомление

---

## C10. Чек-лист архитектуры кода

- [ ] Event Sourcing с causal consistency (частично упорядоченный граф, не линейная лента)
- [ ] Граф отношений как первичная структура данных
- [ ] Многоуровневая симуляция (глобальные и локальные процессы на разных частотах)
- [ ] Нелокальная топология (пространство не обязано быть евклидовым)
- [ ] Динамические паттерны (духи) симулируются как самостоятельные агенты
- [ ] Независимость NPC (собственные циклы, не ждут игрока)
- [ ] Отсутствие квестовой системы
- [ ] Процедурная генерация, управляемая историей
- [ ] Изменение игрока как состояние (Relations), не числовые параметры
- [ ] Нет уровней и каталогов

---

## Шаблон: Snapshot для Narrative Engine

```json
{
  "local": "ExtractLocal(focus, radius=R_LOCAL)",
  "regional": "ExtractRegional(region)",
  "historical": "ExtractCausalChain(focus, depth=D_HIST)",
  "semantic": "ExtractSemantic(focus)"
}
```

**Требование:** Narrative Engine запрашивает виды, не весь мир. Не может вызвать ApplyEvent(). Генерирует текст на основе Snapshot + Interpretation.

---

## Шаблон: Intent Proposal

```json
{
  "actor": "entity_id",
  "preconditions": ["relation_checks"],
  "mutations": [("relation", "delta")],
  "actor_mutations": "compute_participation(proposal)",
  "causal_context": "player_input | npc_agency | pattern_agency | environmental",
  "causal_horizon": "immediate | secondary | long | semantic"
}
```

**Требование:** actor_mutations вычисляются автоматически (Constraint Participation). Любое изменение мира изменяет актора.

---

## Шаблон: Query Function (классификация)

```python
# Pattern НЕ хранит свою классификацию. Классификация — вопрос наблюдателя.

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

function IsReligionQuery(Pattern p) -> bool:
    return (
        SharedBeliefRelations(P) >= threshold
        and RepeatedRitualEvents(P) >= threshold
        and HistoricalMemory(P) >= threshold
        and SocialTransmission(P) >= threshold
        and MythPersistence(P) >= threshold
    )
```

---

## Шаблон: Pilot Region (20×20 km)

| Этап | Действие |
|------|----------|
| Seed | 500 Entity, река, лес, руда, 2-3 группы Human |
| Run | 10 000 steps (~28 лет при T=1 день) |
| Measure | Settlement? Trade? Conflicts %? Spirits? Religions? False Emergence (T8)? |
| Adjust | Только ОДИН параметр за итерацию |
| Repeat | До выполнения инвариантов I1–I5 |

---

*Все чек-листы derived из: Kernel Algorithm v1.0, Emergence Spec v0.7, Entity Archetypes v0.1, Threshold Model v0.7.1, World Bible.*
