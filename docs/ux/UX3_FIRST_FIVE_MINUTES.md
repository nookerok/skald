# UX‑3 First Five Minutes — Test Scenario

Это не обязательный сюжет и не квест, а сценарий ручного UX-тестирования
onboarding.

## Основной исследовательский маршрут

| Время | Наблюдаемое состояние |
|---|---|
| 0:00 | Загрузка мира, guidance предлагает описать первое намерение своими словами. |
| 0:15 | Игрок видит свободное текстовое поле и единственную игровую кнопку «Отправить». |
| 0:30 | Игрок пишет «Иду к башне на севере» → сервер интерпретирует и разрешает намерение, Главная карточка показывает результат. |
| 0:45 | Игрок открывает Журнал, видит свой ход. |
| 1:00 | Игрок словами описывает следующее действие. Guidance `explore_world` помогает читать мир, но не предлагает готовую команду. |
| 1:30 | После нескольких движений появляется первый След (`risk_taken`). Guidance `test_trace`: «Ты заметил след». |
| 2:00 | Риск достигает порога гипотезы. Guidance `strengthen_hypothesis`: «Закономерность начинает проявляться». |
| 2:30 | Появляется активное последствие audacity. Guidance `observe_consequence`: «Последствие уже возникло». |
| 3:00 | Игрок пишет, что ждёт, наблюдает или продолжает путь. |
| 4:00 | ConsequenceFired(audacity) → Эхо. Открытие `discovered`. |
| 4:15 | Guidance `review_discovery`: «Наблюдения сложились в открытие». Прозаические примеры остаются в composer-контексте; навигация «Открытия» и «Журнал» доступна отдельно. |
| 5:00 | Игрок просматривает доказательства в Открытиях. |

## Альтернативный маршрут (без движения)

Игрок словами описывает ожидание и социальные действия, не двигаясь по миру.

| Время | Ожидаемое поведение |
|---|---|
| 0:00 | `first_action` → игрок пишет «Жду и прислушиваюсь» и отправляет текст. |
| 0:30 | Guidance обновляется: `explore_world`. |
| 1:30 | Игрок продолжает описывать социальные действия словами. Risk discovery не появляется. |
| 3:00 | После 6 ходов guidance → `free_play`. Компактный блок «Куда дальше?». |
| 3:30 | Discovery card отсутствует (игрок не накопил risk_taken) — это корректно, не ошибка. |

## Проверки

- Onboarding не показывает заблокированные карточки `???`.
- Guidance не перекрывает текстовый composer, не подставляет готовое действие и не отправляет команды сам.
- На игровом экране нет D-pad, кнопок направлений, action chips или постоянного
  меню внутриигровых команд.
- Игрок может скрыть подсказку, и она не возвращается до смены фазы.
- После reload страницы backend возвращает ту же фазу.
- После перехода к `free_play` tutorial-блоки больше не показываются.
- Все события в Diagnostics не содержат onboarding-специфичных записей.

## Контракт guidance v2

Подсказки строятся детерминированно из observer-safe read models: локальной
ситуации, наблюдаемых объектов, известных контактов и маршрутов, доступных
предметов и authored background/entrypoint hook. «Можно попробовать» — это
только текстовые примеры намерений, максимум три, без `move north`, `wait`,
`give ... guild`, направлений и внутренних ID. Слухи/смутные glimpsed-маршруты,
неизвестные контакты и недоступные предметы не предлагаются. Guidance не
создаёт Events, не меняет Projection/Strategy и не вызывает LLM.

# Knowledge shown during the first minutes

The first entry surface and the first Game Shell frame show at most three
plain-language knowledge entries. They are grouped by origin: what the player
saw, was told, infers, and doubts. Each entry includes a short origin phrase;
internal belief metrics, identifiers and raw hypothesis seeds are never shown.
The same read-side projection is refreshed after actions and restored after a
reload. Empty groups use natural player language rather than diagnostic terms.
