# SKALD Worldbuilding Principles

Этот каталог содержит принципы построения мира, переданные для SKALD как
worldbuilding-спецификация v1.0. Она описывает желаемые законы, язык
проектирования и проверочные сценарии для будущих вертикальных срезов.

## Статус

Документы установлены в репозиторий, но не объявляют автоматически новые
runtime Rules, Domain Events, таблицы SQLite или UI-контракты. Текущий
исполняемый baseline и границы внедрения закреплены в
[ADR-0007](../adr/0007-worldbuilding-principles.md).

| Файл | Назначение |
|---|---|
| `SKALD_Rules_Ontology.md` | сущности, отношения, пространство, время, познаваемость |
| `SKALD_Rules_Entities.md` | архетипы сущностей, память, агентность и участие игрока |
| `SKALD_Rules_Events.md` | Intent → Proposal → validation → commit, causal horizon и lifecycle паттернов |
| `SKALD_Rules_Magic.md` | relation-first описание «магии» без mana/schools/spells |
| `SKALD_Rules_Emergence.md` | query-классификация Settlement/City/Trade Route/Spirit/Religion/Conflict |
| `SKALD_Rules_Parameters.md` | параметры, инварианты, калибровочные сценарии и T1–T11 |
| `SKALD_Rules_Worldbuilding.md` | география, история, культура, повседневность и анти-референсы |
| `SKALD_Checklists.md` | чеклисты C1–C10, snapshot/intent templates и pilot region |

## Как пользоваться

1. Для уже реализованного поведения сначала читать `AGENTS.md`,
   `docs/ARCHITECTURE.md`, `docs/OBSERVATION_BELIEF_MODEL.md`, ADR и код.
2. Для нового worldbuilding-среза использовать эти документы как design gate:
   выбрать один закон, описать его наблюдаемые последствия и границу
   внедрения, затем добавить отдельный ADR и тесты.
3. Не переносить Python-псевдокод из спецификации в runtime напрямую. Каждая
   будущая реализация должна адаптировать его к TypeScript-контрактам Skald,
   сохранить append-only Event Log, Projection Purity и детерминированные
   Rules.
4. Чеклисты — критерии ревью и калибровки, а не скрытый генератор мира.
