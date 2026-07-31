# SKALD — Правила сущностей и архетипов
## Версия 1.0 | Derived from: Entity Archetypes Spec v0.1 + Kernel Algorithm v1.0

---

## Общая структура Entity

**Правило:** Entity — устойчивый узел Relations, обладающий способностью поддерживать или изменять связи.

**НЕТ:** strength, intelligence, level, inventory.

**Структура:**
```
Entity:
  id: UUID
  state:
    persistence: float       # способность сохранять существование
    integrity: float         # целостность структуры
    resources: Map<Resource, float>
    location: Node in spatial graph
  capabilities:
    perceive: bool
    act: bool
    maintain_relations: bool
  needs:
    required_relations: Set<RelationType>
  intent_generator: IntentSource
```

---

## Archetype A: Biological

**Entity:** Human, animal, tree, fungal network.

**Свойства:** metabolism, growth, reproduction, adaptation, death.

**Intent Sources:**
- `seek_resource`
- `avoid_damage`
- `reproduce`
- `migrate`
- `protect_area`

**MUST:**
- Biological Entity без required_relations умирает (integrity → 0).
- Смерть = распад Pattern с распределением Relations в ambient.

---

## Archetype B: Human

**Правило:** Human — не «разумная раса», а Biological Entity с высокой способностью создавать абстрактные Relations.

**Capabilities:**
- `symbolic_memory`
- `long_term_planning`
- `social_learning`
- `tool_creation`

**Способен создавать:** Settlement, Trade, Religion, Institution.

**MUST:**
- Human — не отдельный вид, а состояние Biological Entity с определёнными Relations.
- Если Relations `symbolic_memory`, `social_learning` потеряны (изоляция, травма), Entity перестаёт быть Human-архетипом.
- Нет «расы Human» в данных.

**Intent Sources:**
- `seek_resource`
- `build_structure`
- `negotiate`
- `investigate`
- `create_abstract_relation`
- `transmit_knowledge`
- `ritual_maintenance`

**ANTI-PATTERN:** «Создать Human NPC с уровнем 5 и силой 12». Допустимо: «Entity с Relations: --работает в--> Кузница, --обучен--> Мастер, --поставляет--> Деревня».

---

## Archetype C: Resource

**Правило:** Resource — не предмет. Это Pattern с Relations.

**Пример — Золото:**
```
Gold_Vein_Pattern:
  relations:
    --geological_origin--> Mountain_Kren
    --extraction_cost--> High
    --owned_by--> Clan_Vein
    --exchange_value--> Trade_Network_X
```

**MUST:**
- Resource может истощаться, восстанавливаться, менять значение через изменение Relations.
- Перемещение Resource = изменение ownership Relations, не `inventory.add()`.
- Resource не имеет фиксированной цены — `exchange_value` производно от Trade Network Relations.

**ANTI-PATTERN:** «Золото лежит в инвентаре игрока». Допустимо: «Игрок --owns--> Gold_Pattern --located in--> Player_Storage_Relation».

---

## Archetype D: Environment

**Entity:** Река, лес, гора, климат.

**Правило:** Нет человеческих Intent. Это Processes — сохранение собственного Pattern.

**Processes:**
- `maintain_flow`
- `change_course`
- `erode_bank`
- `support_ecosystem`
- `restore_after_fire`
- `balance_species`

**MUST:**
- Environment Entity не «хочет» — оно сохраняет Pattern.
- В коде это Environmental Process в списке sources `CollectIntents()`.
- Эти Intents имеют `causal_context = environmental` и не проходят через Constraint Level CULTURAL.

**ANTI-PATTERN:** «Лес решил отомстить». Допустимо: «Forest Pattern потерял Stability из-за вырубки → Process generate_intent() направлен на восстановление Relations → конфликтует с Settlement Intent → ConflictPotential растёт».

---

## Archetype E: Artifact

**Entity:** Дом, дорога, инструмент, храм, руина.

**Правило:** Существует только пока поддерживаются Relations.

**MUST:**
- Artifact без поддерживающих Relations теряет Stability.
- Нет HP — только Stability через Relations.
- При распаде эмерджирует как Ruin Pattern (новый Pattern, не «тот же с class=ruin»).
- Путь распада должен быть определён при создании.

**Пример — Храм:**
```
Temple_Pattern:
  relations:
    --maintained_by--> Priest_Cult
    --connected_to--> Ley_Line
    --remembered_in--> Myth_Pattern
  decay_path: Temple_Pattern → Ruin_Pattern → (камни, опасность, explored_by, looted)
```

**Artifact может стать Sacred Place:**
- При накоплении Events + Relations (1000+ Events + Human Relations).
- Sacred Place Pattern существует независимо от веры, но теряет Stability если все поддерживающие Entity исчезают.

---

## Память

**Правило:** Не `Human.memory[]`. А `Human --remembers--> Event Pattern`.

**MUST:**
- Память сама является графом Relations.
- Может быть неточной (`accuracy` параметр).
- Два NPC помнят одно событие по-разному: конфликт Observation, не «факт vs ложь».
- Миф = Lossy Compression Event History + Semantic Drift.

---

## Agency и Intent Generation

**Правило:** Agency эмерджирует, не задаётся.

**Spirit Agency:**
- `IsSpiritQuery(P)` = true → `p.has_agency = true`, `p.can_generate_intents = true`.
- Spirit Intents: изменение Relations через резонанс.

**Settlement Agency:**
- Settlement Pattern генерирует Intents: защита, обмен, рост.

**Player:**
- Часть мира, подчиняется фундаментальным законам.
- Обладает редким свойством, позволяющим взаимодействовать с законами иначе.
- Свойство не даёт превосходства и само требует исследования.
- Мир не знает об игроке заранее; игрок становится заметен только через действия.

---

## Открытые вопросы (для команды)

1. Resource — Entity, Relation или Property? (Рекомендация: Entity-узел для ownership, Relation для потока)
2. Может ли Biological Entity (волк) иметь symbolic_memory на низком уровне (приметы, традиции стаи)?
3. Сколько базовых Archetypes достаточно для Pilot 0 и Pilot 1?
4. Как Environment Entity (река) «генерирует» Intent без agency? (Ответ: Process, не Intent Generator)
