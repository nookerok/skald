# OpenCode: бесплатные модели и ежедневная проверка

Дата исходного аудита и реализации: 2026-11-11 (Europe/Moscow).
Публичный каталог повторно сверён 2026-11-12; список ниже не изменился.

## Состояние реализации

После аудита локально внесён ограниченный survey-срез; это ещё не live
acceptance и не доказательство работы на Orange Pi:

- **MD-1 — локально реализовано:** каждый запуск заново читает публичный
  каталог, подтверждает тип/chat API/модальности/нулевые цены input+output,
  включает новые ID вне preference list и исключает OpenCode-only модели из
  прямого HTTP. В каталоге, повторно прочитанном сегодня, 85 записей и те же
  12 строго бесплатных текстовых chat-моделей.
- **MD-2 — только smoke-screen реализован:** каждый кандидат получает два
  ограниченных вызова через изолированный OpenCode CLI; отчёт хранит
  pass/fail/latency без сырых ответов. Это не тест русского качества и не
  семантическое доказательство отсутствия выдумок; `taskEvaluation=not_run`.
  Для probes нужны явный `SKALD_OPENCODE_RUN=1` и credential; снятие флага
  или ключа из service env должно записать `blocked` без inference calls.
- **MD-3 — локально реализовано:** неизменяемый JSON + SHA-256 + completion
  marker последним, ограниченная история, `lastAttempt`, freshness TTL,
  lock, stale-run detection и idempotent operator receipts. Ручные запросы
  имеют durable lifecycle (`accepted/running/terminal/incomplete`): повтор
  того же ключа восстанавливает сбой до старта или незавершённый запуск, но не
  запускает заново уже завершённый запрос. При провале старый отчёт виден
  отдельно от свежей попытки.
- **MD-4 — source/config реализовано:** systemd oneshot и daily 04:00
  Europe/Moscow timer добавлены, включены в свежую установку. Для уже
  работающего Orange Pi добавлен узкий `install-ai-discovery.sh`; до его
  запуска timer не установлен. Сам Pi в этом проходе не менялся.
- **MD-5 — локально реализовано:** loopback GET для polling, idempotent POST
  ручного refresh и POST решения `nominate_for_task_evaluation`/`reject`.
  Подтверждение никогда не меняет serving route; автоматического сообщения
  пользователю нет.
- **MD-6 — локальная проверка PASS, внешняя приёмка pending:** deterministic
  tests покрывают catalog, transport, budgets, storage, concurrency, HTTP и
  unit wiring; полный `npm run validate` завершился `[validate] PASS`, exit 0.
  Остались Pi install/scheduled-run/next-day verification. Реальные inference
  probes в этом проходе не запускались.

Список выбора в `packages/world/src/llm/config.ts` — preference/order list,
не актуальный runtime-catalogue и не разрешение маршруту. Survey строит список
динамически. Serving-route refresher остаётся отдельным механизмом.

## Подтверждённый каталог

Источники: [публичный JSON-каталог](https://opencode.ai/inference/v1/models),
[Console Models](https://opencode.ai/docs/console/models),
[Inference API](https://opencode.ai/docs/console/api/inference),
[Harnesses](https://opencode.ai/docs/console/harnesses).
Старые страницы `/docs/zen` и `/zen` перенаправляются на Console.
В [официальном changelog](https://opencode.ai/changelog) текущий выпуск —
v2.2.7 от 10 ноября; на Pi установлен 1.18.30. Это отдельная миграция клиента:
перед обновлением проверить argv, NDJSON, permission manifest и cleanup sessions
на тестовом бинарнике, а не менять установленную версию вслепую.

OpenCode описывает бесплатные модели как модели без цены входа. Для Skald
принята более строгая политика — нулевая цена и входа, и выхода: так сканер не
считает потенциально тарифицируемую генерацию бесплатной. В живом каталоге
85 моделей; 12 chat-моделей явно имеют
`cost.text.input.price === 0` **и** `cost.text.output.price === 0`.
Суффикс `free` сам по себе доказательством цены не считается.
Все эти записи публикуют API `chat-completions`:

| ID модели | В каталоге, цена входа/выхода | Пригодность для Skald |
|---|---|---|
| `big-pickle` | 0 / 0 | Не проверена этим аудитом |
| `mimo-v2.6-flash-free` | 0 / 0 | Не проверена этим аудитом |
| `deepseek-v4.1-flash-free` | 0 / 0 | Не проверена этим аудитом |
| `glm-5.3-flash-free` | 0 / 0 | Не проверена этим аудитом |
| `longcat-2.5-free` | 0 / 0 | Не проверена этим аудитом |
| `iceman-free` | 0 / 0 | Не проверена этим аудитом |
| `inkling-2-small-free` | 0 / 0 | Не проверена этим аудитом |
| `beam-free` | 0 / 0 | Не проверена этим аудитом |
| `flint-40b-free` | 0 / 0 | Не проверена этим аудитом |
| `nemotron-3.5-super-vl-free` | 0 / 0 | Не проверена этим аудитом |
| `nemotron-3.5-lightning-free` | 0 / 0 | Не проверена этим аудитом |
| `minimax-m3.1-flash-free` | 0 / 0 | Не проверена этим аудитом |

Порядок повторяет ответ каталога, а не рейтинг качества. Для OpenCode селектор
использует `opencode/<ID>`. Старые `muse-spark-1.3-contributor-free` и
`ling-3.0-flash-fin-free` в полученном каталоге отсутствуют.
Страница Models дополнительно упоминает специализированный `jev-1.13-free`
с SystemOne API, но в полученном публичном JSON его нет. Это расхождение
источников: его текущая доступность не подтверждена и в chat-кандидаты он не включён.
Официальная страница Models упоминает также nemotron-3-ultra-free, но ID
отсутствует в повторно полученном raw JSON-каталоге, поэтому он не входит в
строгий runtime-list. Для целевого региона RU та же страница помечает
inkling-2-small-free и beam-free как недоступные; они исключаются до inference.
Из 12 глобальных zero-input/zero-output кандидатов остаётся 10 без известного
регионального запрета, но конкретная доступность аккаунту всё равно требует
probe.

Официальный контракт: бесплатные chat-модели доступны внутри OpenCode;
сторонний HTTP-клиент получает 403 даже с API-ключом. Новый inference base URL
для Chat Completions — `https://opencode.ai/inference/openai/v1`, каталог живёт
отдельно на `https://opencode.ai/inference/v1/models`. Менять session headers
для обхода ограничения нельзя. Допустимый существующий транспорт Skald —
`OpenCodeRunProvider` с настоящим CLI и запрещёнными инструментами. Его скорость
и пригодность для interpret требуют отдельной приёмки; сейчас он narrate-only.
У части бесплатных моделей условия допускают сохранение/обучение на запросах:
проверка data policy обязательна перед включением пользовательских реплик.

## Почему существующий механизм не даёт нужного результата

1. `discoverOpenCodeRoutes` в `packages/world/src/llm/catalog.ts` берёт только
   `preferredModels.map(...)`. Каталог используется как проверка наличия ID,
   остальные записи игнорируются. До этого аудита список содержал два исчезнувших
   ID. У Ollama и OpenRouter тоже фиксированные списки; последующие провайдеры
   вообще не проверяются, если предыдущий уже дал рабочие маршруты.
2. `catalogIds` отбрасывает цены и метаданные. Цена не перепроверяется перед
   inference. Смена цены прежнего ID способна сделать следующий probe платным.
   Обновление списка кандидатов **не закрывает этот дефект**; MD-1 обязателен
   до развёртывания расширенного автоматического probing.
3. `fetchOpenCodeCatalog` требует API-ключ даже для списка; публичный каталог
   доступен без ключа. На Pi последний serving selection хранит причину
   `401 / api_key_expired`. Истёкший ключ ошибочно блокирует знание о каталоге.
4. HTTP-проверки free chat не учитывают документированное ограничение транспорта.
   Обновление ключа не делает free chat доступным стороннему HTTP-клиенту.
5. `DiscoveryRefresher` действительно запускается. На Pi (production `5edb94c`,
   процесс с 2026-11-07) журнал содержит ежедневные попытки 10 и 11 ноября:
   `outcome=skipped_empty status=misconfigured`. Причина не в отсутствии таймера.
6. При пустом результате refresher сохраняет serving selection и не публикует
   свежий полный failed-report в router/readiness. GET `/api/ops/ai-readiness`
   на 11 ноября отдаёт `ready` с `checkedAt=2026-11-07T09:59:40.822Z` и старой
   успешной Ollama selection. Этот cached ответ не доказывает доступность сегодня.
   Свежий штатный POST `/api/ops/ai-probe` в этом аудите подтвердил
   `status=unavailable`, `playable=false`, обе routes failed: обе проверенные
   Gemma-модели Ollama Cloud ответили 402 на interpret и narrate. Вложенный
   serving `modelSelection` при этом остаётся `ready` от 9 ноября; его нужно
   явно отличать от свежей проверки. Канонический Event Log не затронут.
7. Нет durable истории попыток, времени следующего запуска или TTL serving
   selection. Таймер привязан к uptime; restart сдвигает следующую попытку на 24h.
   API-ключи захватываются при создании процесса и refresher; редактирование env
   файла не обновляет их внутри работающего сервиса.
8. На Pi установлен OpenCode 1.18.30 и `SKALD_OPENCODE_RUN=1`, однако отдельный
   `SKALD_OPENCODE_RUN_NARRATE_FALLBACK` не установлен: enable transport ещё не
   означает включить его в route. Его default model и agent manifest всё ещё
   ссылаются на отсутствующий Muse Spark. Этот аудит не меняет production default
   на случайную непроверенную модель.

Ссылки на код: `packages/cli/src/runtime/discovery-refresh.ts`,
`packages/cli/src/runtime/world-runtime-manager.ts`, `packages/cli/src/http-server.ts`,
`packages/cli/src/runtime/ai-readiness.ts`, `packages/cli/src/runtime/router-factory.ts`,
`packages/cli/src/runtime/opencode-run-provider.ts`.

## План доведения до рабочего состояния

### MD-1 — публичный каталог, актуальная цена и разрешённый транспорт

- Разделить `catalogUrl` и inference base URL; получать каталог без credentials,
  хранить timestamp, source URL и digest нормализованных значимых полей (служебный
  `created` в ответе не должен менять идентичность списка).
- Разбирать цену, тип, modality, API family и client restriction. Бесплатность
  подтверждать только явными конечными нулевыми ценами входа/выхода и используемых
  платных дополнительных модальностей. Пропущенная/неизвестная цена — excluded.
- Получать **все** текущие бесплатные chat-ID. Preference list ранжирует их,
  но не отбрасывает новые ID. Исчезнувшие и ставшие платными немедленно теряют
  eligibility; это не маскируется stale-while-revalidate.
- Для OpenCode-only free назначать только native CLI; direct HTTP —
  `restricted_to_opencode`, без повторных запрещённых запросов и без подделки сессии.
- Приёмка: новый free-ID находится; priced/missing-price ID не получает ни одного
  inference-вызова; истёкший ключ не мешает public catalogue; тесты редиректов,
  malformed/timeout, смены цены и обоих wire endpoints.

### MD-2 — подтверждение каждого model + transport + route

- Переиспользовать существующие dual probes и containment `OpenCodeRunProvider`.
  Отдельно фиксировать: discovered → zero-price eligible → callable → task-valid.
  Наличие в каталоге, нулевой счёт и ответ 200 не равны task-valid.
- На Pi без миров проверять JSON для interpret и grounded русский текст для
  narrate. Подтверждать фактический model/provider/transport, schema, mandatory
  facts, отсутствие новых фактов/внутренних ID, стоимость и latency.
- Суточный короткий screening — один probe каждой поддерживаемой route на модель;
  максимум два одновременных запроса, общий call/time budget. `Retry-After` и
  bounded backoff для 429; 401/403/402 не повторять в горячем цикле. Общая квота
  аккаунта — общий circuit breaker, а не ошибка одной модели.
- Новым кандидатам перед promotion нужны независимое повторное подтверждение и
  task-corpus (Director и event-to-prose); ежедневный marker-probe не заменяет его.
  Обновить CLI default/agent manifest только после успешного Pi-probe новой модели.
  Interpret через CLI открывать лишь после отдельной latency и containment приёмки.
- Приёмка: PASS конкретной модели на каждой route; timeout/ложный marker/tool
  activity/fabricated facts дают FAIL; результаты разных провайдеров не смешиваются.

### MD-3 — durable отчёты и честная свежесть

- Развести `lastAttempt` и `servingSelection`: полный результат каждой попытки
  сохранять атомарно под `skald-data/ai-discovery/`, вне canonical Event Log.
  Отдельно показывать last success, age, last failure, next run, credential generation
  без значений ключей, каталог/pricing digest, все exclusions и transport.
- Хранить bounded историю и append-only run receipt с SHA; повторные запуски
  не перезаписывают завершённый run. Никаких ключей/полных upstream bodies в отчётах.
- `ready` требует свежего успешного evidence. Неудачный refresh отражается сразу;
  старые маршруты можно временно сохранять в пределах заданного TTL, с явным stale
  статусом. После expiry — degraded/unavailable и существующий deterministic fallback.
- Приёмка: успешный день → провал следующего дня показывает оба факта; четырёхдневный
  cached `ready` не выдаётся за сегодняшний; смена selection инвалидирует health cache.

### MD-4 — один надёжный daily job

- Выделить существующий discovery core в операционный CLI. Запускать его свежим
  systemd oneshot с `EnvironmentFile`, `OnCalendar` в Europe/Moscow и `Persistent=true`.
  Свежий процесс читает текущий env; рестарт игрового сервиса для каждого polling
  не нужен. Ограничить wall time, память и число model calls.
- Оставить одного владельца расписания: при внешнем timer отключать in-process
  interval. Общий single-flight/lock защищает manual + timer; completion receipt
  появляется последним. Пропущенный запуск догоняется после boot.
- Runtime подхватывает только завершённую проверенную selection. Публичные каталоги
  резервных провайдеров можно проверять ежедневно независимо от primary; расходные
  inference-пробы учитывать в общем бюджете и policy каждого провайдера.
- Приёмка: fake-clock + subprocess tests расписания/lock/restart/partial report;
  настоящий scheduled run на Pi после deploy, не только прямой вызов функции.

Операционный prerequisite: install-ai-discovery.sh устанавливает файлы в
/etc/systemd/system и вызывает systemctl daemon-reload/enable. Эти операции
требуют отдельной административной авторизации. Deploy-контракт проекта
предоставляет nooker только ограниченное право рестарта skald.service; одного
этого права для установки нового timer недостаточно. В текущем проходе helper
на Pi не запускался, timer не считается установленным.

### MD-5 — ручная проверка и изменение выбора

- Добавить loopback-only ручной refresh без world ID/реплик; параллельные вызовы
  делят run. GET отдаёт сохранённый report, свежесть и состояние последнего
  ручного запроса, а не запускает LLM неявно. Повторный idempotency key
  восстанавливает `accepted`/`incomplete` после crash-window; `running` не
  запускает дубликат при живом lock; завершённые запросы остаются terminal.
- Для смены primary учитывать task-valid evidence и hysteresis: день флуктуации
  не переключает модель туда-обратно. Удалённый/платный/отозванный candidate сразу
  исключается. Новый provider/privacy policy требует явной operator policy.
- Отчёт о daily изменениях: найдено/удалено/цена изменилась/проверено/отклонено/
  маршруты изменены. Доставку уведомления подключать отдельно; молчание не PASS.

### MD-6 — сквозная эксплуатационная приёмка

- Детерминированные тесты не используют внешнюю сеть; проверяют новые ID,
  неизвестные цены, restricted transport, квоты, expiry, секреты, атомарность и
  конкурентные запуски. Затем `npm run validate`.
- На Pi: свежий public catalogue → bounded probes → task-corpus → immutable
  report → load into router → fresh readiness → повтор на следующий день.
  Записать actual commit, источники/хэши, бюджеты и все результаты/исключения.
- Перезапуск сервиса проверяет восстановление selection и догон пропущенного
  расписания. Инъекции provider-error выполнять в изолированном harness, без порчи
  рабочего env и без канонического мира. Deploy остаётся отдельной операцией.
- Готовность: новый бесплатный ID обнаружен без изменения кода; отключённая,
  платная или недоступная модель не выбирается; lastAttempt виден даже при FAIL;
  ровно один scheduled run в сутки и рабочий manual refresh подтверждены на Pi.

Порядок исходного плана: MD-1 → MD-2 → MD-3 → MD-4 → MD-5 → MD-6.
Локальная реализация и repository gate пройдены, но полноценный polling пока
**не принят**: нужны deploy, подтверждение включённого systemd timer, первый
успешный Pi-run и повторное наблюдение следующего дня. Изменение preference
list само по себе не является доказательством ремонта.

## Task-corpus evaluation follow-up — 2026-11-12

Добавлен отсутствовавший исполняемый шаг после операторского подтверждения:

- POST /api/ops/ai-discovery/decision с nominate_for_task_evaluation
  возвращает 202 и nextStep=poll_task_evaluation; тот же idempotency key
  не запускает второй evaluation.
- Координатор запускает bounded evaluator, используя актуальный каталог,
  повторно проверяет zero-price и OpenCode CLI restriction непосредственно
  перед вызовами, закрепляет конкретный model ID и сериализует всю работу с
  ежедневным/ручным discovery общим process-safe lock.
- Если lock занят scan-процессом, подтверждённая оценка остаётся durable
  accepted и coordinator автоматически начинает её после освобождения lock;
  при аварийном завершении повтор той же nomination возобновляет incomplete
  работу.
- Corpus: текущий GM_CORPUS для Director + 10 русских allowed-facts prose
  packs. Максимум 48 provider calls, concurrency 1, 15 секунд на вызов и
  12 минут на оценку. В отчёте есть candidate/model attribution и digest
  корпуса/промптов; сырой невалидный текст не сохраняется. Preview попадает
  в отчёт только после production allowed-facts verifier.
- machineVerdict=pass не доказывает читаемость/естественность прозы:
  humanReview=required остаётся обязательным, и этот процесс не меняет
  serving route.
- Polling fail-closed: request SHA/completion receipt и report SHA/marker
  проверяются вместе с discovery run/candidate; повреждённый финальный отчёт
  показывается как incomplete, не как complete.
- Регион хранится в SKALD_OPENCODE_REGION (пример для Orange Pi — RU) и входит
  в report/evidence. Известные документированные региональные ограничения
  исключаются до marker/task calls; при переносе сервера в другой регион список
  ограничений необходимо сверить с официальными условиями OpenCode.

Focused local verification: typecheck PASS; после region guard 5 файлов /
47 тестов PASS,
включая HTTP confirmation→background evaluation→poll, idempotent replay,
shared-lock contention/recovery и повреждение receipt/report. Внешние
provider calls не выполнялись. Это промежуточная запись до итогового полного
gate; см. актуальную проверку в конце документа. Pi timer и daily/next-day
runs на той точке не были установлены и не подтверждены.

## Повторная проверка — 2026-11-12

- Публичный каталог повторно дал 85 записей и тот же набор из 12 моделей с
  явной нулевой ценой текстового input/output. OPENCODE_PREFERRED_MODELS уже
  совпадает с этим набором и порядком; это preference list, не качество и не
  runtime-discovery.
- После последнего изменения условной цены выполнен полный npm run validate:
  exit 0, завершается [validate] PASS. Потоковый вывод был усечён клиентом,
  поэтому число тестов не утверждается. Включены typecheck, полный Vitest,
  canon, simulation/eval и git diff --check.
- Это локальная валидация текущего dirty checkout; нет новых provider inference
  вызовов, создания мира, commit/push, Pi установки или deploy. Внешняя daily
  эксплуатация остаётся PENDING до административной установки timer и
  подтверждения двух последовательных scheduled runs.

## Ручной refresh crash-window follow-up — 2026-11-12

- Исправлен случай, когда процесс успевал записать idempotency receipt, но
  падал до `aiDiscovery.refresh()`: повтор того же ключа теперь повторно
  планирует `accepted` запрос.
- Состояние запроса хранится отдельно от immutable receipt и без исходного
  idempotency key. `running` считается возобновляемым только после потери lock;
  если completion уже durable, status восстанавливается из проверенного run.
  Повреждённая/не совпадающая контрольная сумма остаётся fail-closed.
- Покрыто focused-тестами: новый экземпляр store, частичный receipt, живой и
  потерянный lock, ошибка записи report, HTTP повтор после crash-window.
- На финальном source state: focused discovery suite — 3 файла / 24 теста
  PASS; полный `npm run validate` — 258 файлов, 3265 passed, 1 skipped,
  canon/simulation/eval/adventure acceptance PASS, `[validate] PASS`.
- Это локальная проверка dirty checkout; provider inference, Pi, systemd timer
  и production state не запускались и не менялись. Внешняя daily acceptance
  остаётся pending.

## Выполненные проверки

- Public catalogue HTTP 200 подтверждён в WSL и с Orange Pi; явные цены 12
  chat-моделей проверены в живом ответе. Native inference этих 12 в этом аудите
  не запускался; пригодность по русскому/фактам остаётся UNVERIFIED.
- Focused catalogue/router/refresh suite: 8 файлов, 122 теста PASS.
- Полный `npm run validate` повторён после исправления двух устаревших
  router-factory assertions: `[validate] PASS`, exit 0. Терминальный вывод
  свёрнут; текущие счётчики suite здесь не утверждаются. Typecheck, tests,
  canon, simulation, eval, adventure и diff-check прошли.
- `systemd-analyze calendar "*-*-* 04:00:00 Europe/Moscow"` распознал
  расписание; ближайший запуск — 2026-11-12 04:00 MSK. Это только проверка
  calendar expression. Полная `systemd-analyze verify` в WSL не прошла:
  целевой Node по пути Pi отсутствует в WSL, а host-systemd выдал отдельные
  permission/unsupported-key сообщения. Unit integration tests прошли;
  реальная проверка остаётся на Orange Pi.
- На Pi выполнены проверки версии/сервиса/журнала, cached readiness и свежий
  no-world AI probe. Production код, env, service configuration не менялись;
  commit/push/deploy не выполнялись.

## Итоговая проверка реализации — 2026-11-12

- После добавления регионального фильтра для официально отмеченных ограничений
  и фикса effective-region в failed reports полный npm run validate
  завершился с exit 0: **260 файлов, 3277 passed,
  1 skipped**, canon/simulation/eval/adventure acceptance и git diff --check
  прошли.
- Локально реализован путь от ежедневного catalogue screening до операторской
  nomination, фоновой task-corpus оценки и polling durable status/report.
  Оценка ограничена актуальным GM corpus и 10 русскими prose-пакетами; это
  воспроизводимый инженерный сигнал, но автоматический verdict не заменяет
  human review русской прозы.
- Ноль внешних inference-вызовов выполнено в этой проверке: результаты моделей
  остаются **UNVERIFIED**. Фактической оценки кандидатов и нового serving
  selection нет; ни один новый ID не promoted.
- Orange Pi, production env/service и systemd не менялись:
  install-ai-discovery.sh не запускался, timer не считается установленным,
  ни одного scheduled run и повторного run на следующий день не подтверждено.
  Commit/push/deploy также не выполнялись.
- Свежая read-only проверка Orange Pi: host orangepi4-lts, user nooker,
  чистый remote checkout main на 5edb94c; skald.service и существующие
  healthcheck/backup timers active; новый skald-ai-discovery.timer inactive;
  /api/health вернул 200, /api/ops/ai-discovery вернул 404. Значит, Pi пока
  действительно не содержит этот код и не может выполнять polling.
- Read-only `sudo -n -l`: у nooker есть общий `(ALL : ALL) ALL` с паролем,
  а без пароля — только перечисленные systemctl-команды для awg-zen и restart
  skald.service. Unit installation требует интерактивной sudo-аутентификации;
  запускать её без отдельного разрешения нельзя.
- Следующий безопасный шаг: после отдельной авторизации установить timer на Pi,
  выполнить один ограниченный real-provider run с отчётом, показать результаты
  оператору для решения по модели, затем проверить следующий ежедневный run.
  До этого daily polling — реализованный локально, но не принятый внешний
  процесс.

## Авторизованный выпуск — 2026-11-12

- Пользователь явно разрешил все необходимые действия для достижения цели,
  включая commit/push/deploy и bounded live проверки. Предыдущие записи об
  ожидании разрешения — историческое состояние до этой авторизации.
- Релиз подготовлен на отдельной ветке codex/opencode-model-discovery от
  production 5edb94c. Незакоммиченные P3/досье/corpus-v8 изменения исходного
  workspace в релиз не входят; task evaluator использует production corpus v5
  и production prompt/validator этого же checkout.
- Полный npm run validate в независимом checkout прошёл. Дополнительно
  исправлен model pin: isolated agent manifest получает тот же model ID,
  который передаётся CLI через -m, без изменения установленного агента.
  Регрессия проверяет сохранение denied permissions и отсутствие retired ID.
- Live preflight текущего Pi: штатный ai-probe вернул unavailable, обе Gemma
  routes ответили 402. Bounded native auth probe для подтверждённого zero-price
  big-pickle на OpenCode 1.18.30: service-key вызов завершился request failure
  за 19875 ms; keyless вызов — transport timeout за 42344 ms. Успешного
  inference этими проверками не доказано; сырые provider errors не публикуются.
- Проверка own-user linger через loginctl закончилась Access denied.
  Persistent user-systemd не считается альтернативой установленному timer.
  Для system units по-прежнему требуется sudo-аутентификация администратора.

### Hardware follow-up

- Выяснено, что Pi хранил более старые OpenCode/Ollama ключи, чем известный
  Windows OpenCode auth store. Текущие локальные ключи получили 200 на своих
  catalogue endpoints и перенесены на Pi через encrypted SSH stdin.
  Env обновлён атомарно с backup
  skald.env.bak-model-discovery-2026-11-12T04-10-01-452Z; значения ключей
  не публиковались. Ollama после ротации всё равно ответил 402: это отдельное
  ограничение account quota, а не отсутствие каталога.
- Первый durable Pi-survey с прежним ключом: provider_auth_failure, два 401.
  После ротации V1 native calls упёрлись в transport budget. Оба immutable
  run/SHA/completion receipt читаются и проверяются store.
- У OpenCode существуют отдельные V1/V2 каналы: v2.2.7 проверен прямым GitHub
  tag API и официальным V2 installer. ARM64 artifact SHA-256:
  c1682057f0815cb2abdd6e00305f1146ebaf1c167f0335cdb74ddc80008120e7.
  Бинарник расположен рядом с V1 в
  /home/nooker/skald-data/tools/opencode-v2.2.7/opencode.
  V2 убрал --dir и использует --standalone для private server; adapter имеет
  явный SKALD_OPENCODE_CLI_MAJOR=2, отдельный all-tools-deny config и private
  session cleanup. Старый V1 бинарник не заменялся.
- V2 на MiMo и DeepSeek вернул структурированный 429, cleanup завершился с 0.
  Неизвестный model-level 429 теперь получает bounded retry и не отбрасывает
  остальные модели; явно account-level quota/rate limit останавливает scan.
- Удалённые OpenRouter fallback ID заменены текущим
  nvidia/nemotron-3-ultra-550b-a55b:free, для которого официальная metadata
  дала input/output=0. На Pi dual probes и live intent/narration contract PASS;
  production allowed-facts guard принял 9/10 prose задач, одна завершилась
  provider error. Human review остаётся required. ERNIE не выбран: guard
  принял только 6/10, в одном принятом тексте найден лишний вывод.
- Полный isolated release gate: 259 файлов, 3233 passed, 1 skipped;
  [validate] PASS. Это другой срез, чем исторический dirty-P3 gate 260/3277:
  неопубликованные P3/досье изменения в выпуск не вошли.
