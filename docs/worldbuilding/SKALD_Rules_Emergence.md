# SKALD — Правила эмерджентности
## Версия 1.0 | Derived from: Emergence Spec v0.7 + Threshold Model v0.7.1

---

## Принцип

**Правило:** Settlement, City, Spirit, Religion, Trade Route — не спавнятся дизайнером. Они эмерджируют, когда Query-функция возвращает true.

**MUST:**
- Нет «создать город на старте».
- Нет «добавить 500 NPC → автоматически City».
- Pattern не хранит свою классификацию — классификация это Query.

---

## Query: Settlement

**Правило:** Settlement эмерджирует, когда SettlementScore(P) > τ_set.

**Формула:**
```
SettlementScore(P) =
    0.25 × ResourceCohesion(P)
  + 0.20 × SharedMemory(P)
  + 0.20 × MutualProtection(P)
  + 0.15 × PopulationDensity(P)
  + 0.10 × ReproductionContinuity(P)
  + 0.10 × SpatialConnection(P)
```

**Требования:**
- ≥20 Entity в связной компоненте Relations
- ResourceCohesion ≥ 0.3 (shared resource + extraction + distribution)
- SharedMemory ≥ threshold (общие Events, мифы, традиции)
- Существует ≥ τ_set шагов (τ_set = 100 × T, ~3 месяца)

**Тест T1:** 30 Human Entities, shared resource, 200 steps → IsSettlement = true.
**Тест T8 (False Emergence):** 100 кочевников у воды, 1000 steps → NO Settlement (ResourceCohesion низкая, SharedMemory отсутствует).

---

## Query: City

**Правило:** City — не масштабированный Settlement, а Settlement с multiplicative факторами.

**Формула:**
```
CityScore(P) =
    SettlementScore(P)
  × EconomicSpecialization(P)
  × KnowledgeTransmission(P)
  × InfrastructureMaintenance(P)
```

**MUST:**
- Без специализации и передачи знаний — Overgrown Settlement с низкой Stability.
- City не растёт бесконечно — scale_penalty остановит при scale > σ₀.

**ANTI-PATTERN:** «Добавить 500 NPC → автоматически City».

---

## Query: Trade Route

**Правило:** Road ≠ Trade. Road может возникнуть из паломничества, миграции, войны.

**Формула:**
```
TradeRouteScore(A,B) =
    ExchangeFrequency(A,B)
  × SuccessRate(A,B)
  × Accessibility(A,B)  # физическая, нелокальная, социальная
```

**Тест T2:** 2 Settlements, resource difference > 0.5, 100 steps → IsTradeRoute = true.

**MUST:**
- Если SuccessRate низкая (бандиты, наводнения) — Road существует, Trade Route — нет.

---

## Query: Spirit

**Правило:** Spirit Query — строгий конъюнкт. Не каждый лес — дух.

**Формула:**
```
IsSpirit(P) =
    Stability(P) > τₛ
    and SelfMaintenance(P)
    and IdentityPersistence(P)
    and ExternalRelations(P)
    and AgencyPotential(P)
```

**Компоненты:**
| Компонент | Описание |
|-----------|----------|
| SelfMaintenance | Pattern восстанавливает Relations после повреждения |
| IdentityPersistence | «Тот же лес» после пожара — сохранение ядра Relations |
| ExternalRelations | Глубокие связи с другими Entity (не только human) |
| AgencyPotential | Способность генерировать Intents, влияющие на другие Patterns |

**Тест T3:** Forest Pattern, self_maintaining = true, longevity = 5000, human relations → IsSpirit = true.

**MUST:**
- Лес без ExternalRelations (изолированный) не становится Spirit — остаётся Environment Process.
- τₛ высокий. IdentityPersistence требует устойчивости к возмущениям.

**Сценарий D («Всё — духи»):** Если каждый лес — дух → повысить τₛ, усилить ExternalRelations.

---

## Query: Religion / Cult

**Правило:** Religion эмерджирует из Events через стадии A→B→C→D.

**Стадии:**

### Stage A — Shared Observation
- Несколько Entity получают похожие Observation одного Pattern.
- Создаётся `shared_belief Relation`.

### Stage B — Ritual Maintenance
- Культ как механисм поддержания Relations.
- Ритуал → Forest Stability ↑ → Settlement Stability ↑.
- Repeated Ritual Events ≥ threshold.
- Ранний этап: не вера, а эмпирика — «мы не знаем почему, но это поддерживает наш мир».

### Stage C — Interpretation Hierarchy
- Entity с высоким Resonance / Event Memory / Observation Accuracy становится Interpreter Pattern Node.
- Не избранные — лучше предсказывают последствия.
- Authority Relation между Interpreter и Community.

### Stage D — Sacred Space
- Место ритуала само становится Pattern.
- Forest + Stone Circle + 1000 Events + Human Relations = Sacred Place Pattern.
- Существует независимо от веры, но теряет Stability если поддерживающие Entity исчезают.

**Query:**
```
IsReligion(P) =
    SharedBeliefRelations(P) ≥ threshold
    and RepeatedRitualEvents(P) ≥ threshold
    and HistoricalMemory(P) ≥ threshold
    and SocialTransmission(P) ≥ threshold
    and MythPersistence(P) ≥ threshold
```

**Мифология:**
- Миф = Lossy Compression Event History + Semantic Drift + Functional Adaptation.
- Может быть фактически неверен, но системно правильным.
- Сохраняет опасность, запрет, эмоциональную функцию.

**Религия как политика:**
- Stability Monopoly: только культ поддерживает связь с духом → Settlement зависит от Priest.
- Interpretation Monopoly: authority Relation.
- Ritual Standardization: ритуал = Constraint (чтобы получить воду — соблюдай правила).
- Theology Emergence: Religious Event History Pattern накапливает тысячи событий → отдельный Pattern.

**Тест T4:** 10+ Entities, shared Observation, 10+ ritual events, 200 steps → IsReligion = true.

**ANTI-PATTERN:** «Создать религию с богом, храмом и священником на старте». Нет — должна пройти все стадии через Events.

---

## Query: Conflict

**Правило:** Конфликт — не добро vs зло, а несовместимые модели устойчивости.

**Формула:**
```
ConflictPotential(A,B) =
    overlap(A,B)
  × incompatibility(A,B)
  × (1 - min(Stability(A), Stability(B)))
  × Duration
```

**MUST:**
- Кратковременная конкуренция ≠ конфликт. Требуется Duration > threshold.
- ~20% регионов в конфликте, не 100%.
- Конфликт неизбежен, но требует комбинации факторов.

**Тест T5:** 2 Settlements, overlap > 0.5, resource pressure → Friction → Hostility.

---

## Pattern Lifecycle: Dissolution & Rebirth

**Правило:** Pattern может распасться и эмерджировать заново — но как новый Pattern.

**Тест T11 (Collapse-Rebirth):**
- Город крах → руины → новое Settlement рядом.
- Не восстановление, а новая эмерджентность.
- Новый Pattern с другой Identity.

**Тест T9 (Dynamic Stability):**
- Лес: пожар → засуха → восстановление.
- Forest Pattern survives благодаря Recovery.

---

## Игрок и эмерджентность

**Правило:** Игрок никогда не получает абсолютную истину. Он получает другую Observation.

- NPC: «Дух разгневан» / Игрок: «Это устойчивый Pattern с обратной связью». Оба могут быть правы.
- Игрок становится источником новой интерпретации через Participation, не через меню.
- Разрушение мифа разрушает shared_belief Relations → если культ обеспечивал Stability → Pattern instability → социальный кризис.
- Новый культ эмерджентен: Intent → Repeated successful Events → Shared Observation → Ritual → Cult Pattern.

---

## Открытые вопросы (для команды)

1. Каковы численные threshold для shared_belief_relations, repeated_ritual_events, historical_memory?
2. Сколько поколений требуется для Lossy Compression Event History в миф?
3. Может ли один Entity одновременно входить в несколько Religion Patterns (политеизм, синкретизм)?
4. Что происходит, когда два Religion Patterns с несовместимыми shared_belief Relations встречаются — конфликт или синтез?
