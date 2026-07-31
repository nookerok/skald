# ADR-0007: Worldbuilding Principles as a governed design layer

**Status:** accepted

**Date:** 2026-07-31

## Context

В репозиторий добавлен комплект `docs/worldbuilding/SKALD_*.md`, описывающий
Ontology, Entities, Events/Kernel, Magic, Emergence, Parameters,
Worldbuilding и чеклисты. Он расширяет исходную философию Skald: мир
relation-first, история необратима и накапливается, знание наблюдатель-скоупед,
а сложные паттерны должны эмерджировать из событий.

При этом текущий runtime уже имеет другой, исполняемый контракт: Event Log →
Projection → deterministic Rules → Observation/Belief → Narrative/UI. В нём
ещё нет общего IntentGraph, Proposal/Constraint API, multiscale Pattern
Lifecycle или агентных environmental Intents. Нельзя считать наличие
псевдокода в документации доказательством реализации.

## Decision

1. Комплект из `docs/worldbuilding/` принимается как управляемый слой
   worldbuilding-дизайна и критериев будущих вертикальных срезов.
2. Он не добавляет автоматически Domain Events, Rules, persistence schema,
   renderer fields или новые top-level packages.
3. Исполняемая конституция остаётся в `AGENTS.md`,
   `docs/ARCHITECTURE.md`, нормативном `docs/OBSERVATION_BELIEF_MODEL.md`,
   принятых ADR и тестах. При прямом конфликте runtime-код и принятые ADR
   имеют приоритет, а конфликт должен быть явно записан в следующем ADR.
4. Новая реализация принимается только через вертикальный срез:
   - один формализованный закон или query;
   - явная связь с существующими Events/ReadonlyWorld;
   - детерминированный Rule или read-side builder, если это действительно
     требуется;
   - unit/integration/replay tests и обновление чеклиста;
   - отдельное решение о миграции DTO/UI.
5. «Магия» из спецификации трактуется как relation/constraint language, а не
   как runtime-система Spell, Mana, MagicSchool, Level или каталог способностей.
6. Классификации Settlement, City, Spirit, Religion, Trade Route и Conflict
   остаются Query/read-side концепциями до отдельного ADR. Они не должны
   храниться как дизайнерские ярлыки и не должны спавниться вручную.

## Accepted now

Следующие принципы совместимы с текущим runtime и считаются обязательными
для авторинга и UI-ревью уже сейчас:

- Event Log append-only; история и неудачные попытки не «исправляются» задним
  числом.
- Relations важнее RPG-статов; власть, экономика и культура описываются
  устойчивыми связями и их последствиями.
- Observation/Belief — единственная нормальная граница знания игрока; UI не
  показывает Truth, скрытые `actual*`/`true*` поля или сырой Event Log.
- Narrative/LLM описывает выбранные наблюдаемые факты, но не создаёт факты,
  не классифицирует уверенность и не выбирает действие.
- Нет quest/mission automation, levels, XP, classes, mana, spell catalog или
  «избранного героя».
- Исторические изменения преобразуют паттерны, а не восстанавливают прошлую
  форму; причины мира должны быть видимы через наблюдения и последствия.
- Калибровка должна идти по наблюдаемым инвариантам и одному параметру за
  итерацию; специальные player-nearby hacks запрещены.

## Compatible but needs runtime mapping

Эти идеи совпадают с направлением проекта, но требуют отдельного технического
решения до заявления «реализовано»:

| Идея | Текущая опора | Следующий gate |
|---|---|---|
| actor participation | Consequences, Observations, relation events | определить actor-mutation DTO и projector semantics |
| constraint hierarchy | validation gate и critical checks | общий порядок FUNDAMENTAL → PHYSICS → PATTERN → CULTURAL |
| causal horizon / dirty propagation | causationId, correlationId, trace/read models | observer-scoped causal query без искусственной связи tick с command |
| Pattern queries | `packages/patterns`, observation/belief layers | pure builders + thresholds, без хранения класса в Event Log |
| failed/interrupted/ transformed intents | `ActionRejected`, blocked/critical-check outcomes | унифицировать event vocabulary только через ADR и migration tests |
| nonlocal topology / landscape archaeology | current world locations, relations, discovery | отдельный location/relations slice, не UI-only mock |
| environmental/Pattern agency | Situations and offline strategy | deterministic source registry; не `NPC.decide()` |

## Deferred, not installed in runtime

До следующих вертикальных срезов отложены: полный IntentGraph всех источников,
Proposal API, four-level Constraint Engine, incremental dirty Pattern update,
Pattern dissolution/detection/agency lifecycle, Settlement/City/Spirit/Religion
emergence thresholds, 20×20 km pilot region и T1–T11 long-run calibration.

Причина отсрочки — текущая игра ещё использует компактную локальную Projection
и существующие Domain Events; преждевременное внедрение этих контрактов
создало бы вторую истину и нарушило Projection Purity.

## Consequences

- Новые документы доступны Codex/Hermes через `docs/PROJECT_MAP.md` и этот ADR.
- Worldbuilding review получает единый vocabulary и чеклисты без скрытого
  изменения сервера.
- Будущие PR должны указывать, какой принцип они реализуют, какие события
  читают, какие события (если вообще) создают и почему слой является Domain
  Rule либо read-side.
- До реализации runtime mapping нельзя ссылаться на Settlement/Spirit,
  IntentGraph или causal horizon как на существующие игровые возможности.
