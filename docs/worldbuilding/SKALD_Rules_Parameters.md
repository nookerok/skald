# SKALD — Параметры и калибровка мира
## Версия 1.0 | Derived from: Threshold & Parameter Model v0.7.1

---

## Принципы калибровки

### Принцип 1: Параметры — не баланс, а физика
Мы не ищем «число, при котором игра весёлая». Мы ищем «число, при котором мир ведёт себя как физическая система с эмерджентными свойствами».

### Принцип 2: Калибровка через наблюдаемые инварианты
Вместо подбора τₑ напрямую, калибруем через макро-свойства.

### Принцип 3: Параметрические семейства
Вместо фиксированных чисел задаём семейства, масштабируемые через BaseTimeUnit.

### Принцип 4: Калибровочные сценарии
Диагностика мира по симптомам.

### Принцип 5: Итеративная калибровка через Pilot Region
Только ОДИН параметр за итерацию.

### Принцип 6: Запрет на «хаки»
Если для достижения инварианта требуется специальное правило (например, «если игрок рядом, Settlement эмерджирует быстрее») — параметр неисправен. Меняем фундаментальную физику, не добавляем исключение.

---

## Глобальные параметры

| Параметр | Символ | Назначение | Значение |
|----------|--------|------------|----------|
| THRESHOLD_EXISTENCE | τₑ | Минимальная Stability для существования Pattern | [0,1] |
| THRESHOLD_SPIRIT | τₛ | Минимальная Stability для Agency (духа) | [0,1], >> τₑ |
| THRESHOLD_SETTLEMENT | τ_set | Минимальный SettlementScore для Query | [0,1] |
| CRITICAL_SCALE_BASE | σ₀ | Базовый масштаб, после которого scale_penalty растёт | ~100 entities |
| CAUSAL_HORIZON_IMMEDIATE | h₁ | Радиус Immediate влияния Event | Relations count |
| CAUSAL_HORIZON_SECONDARY | h₂ | Радиус Secondary влияния | Relations count |
| CAUSAL_HORIZON_LONG | h₃ | Радиус Long влияния | Relations count |
| CAUSAL_HORIZON_SEMANTIC | h₄ | Радиус Semantic влияния | Relations count |
| TAU_PERSISTENCE | τ_persistence | Минимальный период наблюдения для валидности Pattern | 10 × T |
| SCALE_PENALTY_K | k | Коэффициент scale_penalty | k > 0 |
| SCALE_PENALTY_ALPHA | α | Показатель scale_penalty | α > 1 |

**BaseTimeUnit = T** (1 игровой день)

```
τ_persistence = 10 × T      # Pattern должен существовать 10 дней для валидности
τ_set = 100 × T             # Settlement требует ~3 месяца устойчивости
τ_spirit = 5000 × T         # Дух требует ~14 игровых лет
σ₀ = 100 entities           # Комфортный масштаб ~100 связанных Entity
```

---

## Pattern-специфичные параметры

| Pattern Class | Population Min | Resource Cohesion Min | Age Min | Self-Maintaining |
|---------------|---------------|----------------------|---------|------------------|
| Settlement | N_set = 20 | ρ_set = 0.3 | t_set = 100 steps | false |
| City | N_city = 500 | ρ_city = 0.6 | t_city = 1000 steps | true |
| Trade Route | freq_min = 5 | success_min = 0.7 | t_route = 50 steps | false |
| Spirit | longevity = 5000 | internal_cycle = true | t_spirit = 1000 steps | true |
| Religion | belief_rel = 10 | ritual_freq = 10 | t_religion = 200 steps | true |

---

## Формулы (контракты, не жёсткие реализации)

### Stability (контракт S1–S4)
```
Stability(P) = f(cohesion(P), entropy(P), scale(P), σ₀)
где:
  f растёт с cohesion ↗
  f растёт с Recovery ↗
  f растёт с TemporalContinuity ↗
  f падает с entropy ↗
  f падает с scale ↗ при scale > σ₀
  f локально восстанавливается при self_maintaining = true
```

### Scale Penalty
```
scale_penalty(scale) = 1.0, если scale ≤ σ₀
scale_penalty(scale) = 1.0 + k × (scale - σ₀)^α, если scale > σ₀
где k > 0, α > 1
```

### Conflict Potential
```
ConflictPotential(A,B) =
    overlap(A,B)
  × incompatibility(A,B)
  × (1 - min(Stability(A), Stability(B)))
  × Duration
```

### Settlement Score
```
SettlementScore(P) =
    0.25 × ResourceCohesion(P)
  + 0.20 × SharedMemory(P)
  + 0.20 × MutualProtection(P)
  + 0.15 × PopulationDensity(P)
  + 0.10 × ReproductionContinuity(P)
  + 0.10 × SpatialConnection(P)
```

### City Score
```
CityScore(P) =
    SettlementScore(P)
  × EconomicSpecialization(P)
  × KnowledgeTransmission(P)
  × InfrastructureMaintenance(P)
```

### Trade Route Score
```
TradeRouteScore(A,B) =
    ExchangeFrequency(A,B)
  × SuccessRate(A,B)
  × Accessibility(A,B)
```

### Spirit Score
```
SpiritScore(P) =
    Stability(P) > τₛ
  ∧ SelfMaintenance(P)
  ∧ IdentityPersistence(P)
  ∧ ExternalRelations(P)
  ∧ AgencyPotential(P)
```

### Religion Score
```
ReligionScore(P) =
    SharedBeliefRelations(P) ≥ threshold
  ∧ RepeatedRitualEvents(P) ≥ threshold
  ∧ HistoricalMemory(P) ≥ threshold
  ∧ SocialTransmission(P) ≥ threshold
  ∧ MythPersistence(P) ≥ threshold
```

---

## Наблюдаемые инварианты (I1–I5)

| Инвариант | Что должно быть true | Как калибровать |
|-----------|---------------------|-----------------|
| I1. Жизнь медленнее событий | Settlement возникает за сотни шагов, не десятки | τ_persistence >> частоты случайных флуктуаций |
| I2. Масштаб имеет предел | Город не может бесконечно расти | σ₀ и k, α такие, что scale_penalty превышает cohesion при реалистичном размере |
| I3. Духи редки | Не каждый лес — дух | τₛ высокий, IdentityPersistence требует устойчивости к возмущениям |
| I4. Конфликт неизбежен, но не повсеместен | ~20% регионов в конфликте, не 100% | ConflictPotential threshold такой, что требуется комбинация факторов |
| I5. Религия медленнее политики | Культ формируется дольше, чем торговый союз | MythPersistence требует τ_persistence × поколения |

---

## Калибровочные сценарии

### Сценарий A: «Мёртвый мир»
- **Симптом:** Ничего не эмерджирует. Все Patterns распадаются.
- **Причина:** τₑ слишком высокий, entropy слишком велико, Recovery слишком мал.
- **Решение:** Понизить τₑ на 20%. Увеличить Recovery базовых экосистем.

### Сценарий B: «Хаотичный мир»
- **Симптом:** Pattern'ы возникают и исчезают каждые 5 шагов. Нет устойчивости.
- **Причина:** τ_persistence слишком низкий, entropy слишком велико, scale_penalty слишком агрессивен.
- **Решение:** Повысить τ_persistence. Сгладить scale_penalty (уменьшить k).

### Сценарий C: «Застывший мир»
- **Симптом:** Pattern'ы возникают, но никогда не меняются. Нет конфликтов, нет коллапсов.
- **Причина:** entropy слишком мало, Recovery слишком велико, ConflictPotential threshold слишком высок.
- **Решение:** Увеличить базовую entropy. Понизить Recovery для социальных Patterns.

### Сценарий D: «Всё — духи»
- **Симптом:** Каждый лес, река, город имеет Spirit.
- **Причина:** τₛ слишком низкий, IdentityPersistence требует слишком мало.
- **Решение:** Повысить τₛ. Усилить требование ExternalRelations (дух требует глубоких связей с другими Entity).

---

## Валидационные тесты (T1–T11)

| Тест | Начальные условия | Ожидаемый результат |
|------|-------------------|---------------------|
| T1. Settlement Emergence | 30 Human Entities, shared resource, 200 steps | IsSettlement = true |
| T2. Trade Route | 2 Settlements, resource difference > 0.5, 100 steps | IsTradeRoute = true |
| T3. Spirit Emergence | Forest Pattern, self_maintaining = true, longevity = 5000, human relations | IsSpirit = true |
| T4. Religion Emergence | 10+ Entities, shared Observation, 10+ ritual events, 200 steps | IsReligion = true |
| T5. Conflict Escalation | 2 Settlements, overlap > 0.5, resource pressure | Friction → Hostility detected |
| T6. Scale Collapse | City Pattern, scale > 2×σ₀ | Stability < τₑ, PatternDecay |
| T7. Player Awareness | Player Entity alters critical Relations | Мир реагирует через Causal Horizon |
| T8. False Emergence | 100 кочевников у воды, 1000 steps | NO Settlement |
| T9. Dynamic Stability | Лес: пожар → засуха → восстановление | Forest Pattern survives |
| T10. Misinterpretation | Древняя машина → NPC: God / Player: Tech | Оба Observation валидны |
| T11. Collapse-Rebirth | Город крах → руины → новое Settlement рядом | Новая Identity, не восстановление |

---

## Методология итеративной калибровки

```
Шаг 1: Seed (начальные условия)
    20×20 km, 500 Entity, река, лес, руда

Шаг 2: Run (N = 10 000 steps)
    ~28 игровых лет при T = 1 день

Шаг 3: Measure (проверка инвариантов)
    - Settlement detected? (да/нет/сколько)
    - Trade routes? (да/нет)
    - Conflicts? (сколько % регионов)
    - Spirits? (да/нет/сколько)
    - Religions? (да/нет)
    - False Emergence? (T8)

Шаг 4: Adjust (изменение одного параметра)
    Только ОДИН параметр за итерацию.

Шаг 5: Repeat
    До выполнения всех инвариантов I1–I5.
```

---

## Новые параметры (v0.7.1)

| Параметр | Описание |
|----------|----------|
| Recovery (R) | Способность Pattern восстанавливать Relations после повреждения |
| Temporal Persistence | Минимальный период наблюдения изменения. Observed Stability ≠ Actual Stability |
| Identity Persistence | Spirit сохраняет «себя» несмотря на изменения |
| Transmission Fidelity | Религия сохраняется несмотря на поколенческий шум |
| Myth Persistence | Новое: религия сохраняется несмотря на поколенческий шум |
| Duration | Конфликт требует времени: кратковременная конкуренция ≠ конфликт |
