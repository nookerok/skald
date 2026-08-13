# Full adventure evidence — 2026-08-13

This record separates deterministic/runtime proof from the human experience
gate required by ADR-0031. It is evidence, not a replacement for a human
30–60 minute playtest.

## Release candidate

- Repository commit: `4c2b13777ad70b2bff507e37e36b7c5f2fe7c8cc`
- Branch: `main`, clean and equal to `origin/main`
- Production: `http://192.168.0.5:3000`
- Production service: `skald.service`, active after an explicit restart
- Production health: `{"status":"ok","persistence":"sqlite","multiWorld":true}`
- Browser QA task: fixed NTFS task `019fa52b-1610-7b23-9567-37891d24c782`

## Deterministic CI gate

Command: `npm run acceptance:adventure`

Result: PASS. The run uses a temporary SQLite database, the HTTP command
routes and the fixed narration provider; it does not append Domain Events
directly.

| Metric | Result |
| --- | ---: |
| Required beats | 100% |
| Meaningful player choices | 4 |
| Completed journey legs | 4 |
| World changes encountered | 4 |
| Discovery advances | 4 |
| Map knowledge growth | 3 |
| Offline meaningful events | 90 |
| Chat alternation | PASS |
| Chronicle coverage | 100% |
| Narration duplicate rate | 0 |
| Truth leaks | 0 |
| Orphan responses | 0 |
| Replay purity | PASS |
| Idempotency | PASS |
| Restart persistence | PASS |
| Offline observation leak | 0 |

The full repository gate also passed: 122 test files, 1457 passed, 1 skipped;
Canon, Simulation, all 10 eval scenarios and diff checks passed.

## Production API smoke

After the final service restart, ten idempotent `wait` commands returned
HTTP 200 and replaying the tenth key returned HTTP 409
`duplicate_request`. The primary world advanced from T51 to T61 as an
explicit deployment smoke mutation; this was not used as adventure evidence.

## Browser adventure acceptance

World: `world-msr2hlyd-1-rcbao7c4j09`

- One disposable world was created; the primary world was not used.
- DOM before creation: `Бассейн Речного Стража` had
  `aria-pressed=true`; the other templates were false.
- Entry: `Переправа у Чёрного леса`.
- Presence acknowledgement: 1.
- Gameplay submissions: 27, including one `advance 24`.
- World time: T0 → T53.
- The complex input
  `Я не иду прямо к башне: обхожу её с запада, стараясь держаться ниже гребня и наблюдать за огнями`
  returned a player-facing clarification. The forbidden destination
  `я не прямо к башне` was not created or displayed.
- The player heard the old-riverbed rumour, travelled to Речной Страж,
  reached Развалины на уступе, inspected the masonry discovery, returned and
  reached Переправа у Чёрного леса.
- Offline T29 → T50 produced autonomous world turns and changed water/current
  knowledge without moving the player.
- Final map: Riverwatch artwork, fog, 5 reveal circles, 5 reveal paths,
  5 routes, 4 markers and 3 locked detail cards without `src`.
- Knowledge: 11 observations, 6 hypotheses, 0 contradictions.
- Chronicle: dialog present; Player/Master and autonomous Master turns
  persisted across reload.
- Mobile DOM at 390×844 had no horizontal overflow; map bounds stayed inside
  the viewport. Console errors and warnings were 0.

## Explicit evidence gaps

These items are not silently treated as PASS:

1. The browser screenshot call failed with
   `target closed while handling command`; no screenshot path is claimed.
2. A real `aria-busy=true` pending interval was not captured without
   manufacturing a network failure.
3. Separate HTTP network-status inspection was unavailable in the browser
   task; no visible import or network error occurred.
4. The browser run was a bounded acceptance interaction, not an independently
   timed 30–60 minute human session. The ten-question interest rubric in
   `docs/acceptance/full-adventure-playtest.md` is therefore UNRATED.

## Release decision

Deterministic simulation, HTTP/SQLite runtime and production browser
functionality: **PASS**.

Human experiential release gate: **OPEN** until a tester records a genuine
30–60 minute playthrough, answers the interest rubric, and attaches usable
desktop/mobile screenshots. The missing evidence is not a simulation or
runtime correctness failure.

