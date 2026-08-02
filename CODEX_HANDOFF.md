# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-08-02
Branch: main
Working tree: UX-6.3.1 UI hardening — the five browser-QA defects are fixed
and unit-covered, not yet committed/deployed (see Current milestone).
Also in the working tree: Interaction Model v1 stages 0–2 + Slices 1–2
(ADR-0013, DECISIONS D-020) — canonical InteractionCommand pipeline,
observe/inspect/listen canonicalization, shared Target Resolver, WorldObject
aliases, perception and listening laws in `rules/interactions/`;
`npm run validate` PASS (76 files / 1122 tests, 1 pre-existing skip), still
uncommitted together with UX-6.3.1. UX-6.3 is deployed as 428072d:
local/on-device validation 1037 passed + 1 skipped,
backup/integrity/health/state PASS, ten-turn smoke T218→T228 and duplicate
key 409 PASS. UX-6.2.1 remains deployed as 5f95eeb. The NTFS visual-QA
backend is reachable after the Codex update. The latest production run
completed with 0 console errors and found application defects: undersized
Presence CTA, broken Focus Tab order, premature T0 shell flash, misleading
transient exit dialog, and internal `forest_fire`/`wall_caution` labels —
all fixed in UX-6.3.1 (Current milestone); mobile viewport override remains
tool-blocked.

## Current milestone

UX-6.3.1 "UI hardening" — the five application defects from the last NTFS
browser QA run, all fixed with unit coverage (not yet committed/deployed):
1. «Осмотреться»/«Войти» was an unstyled default button (~19px):
   `.presence-continue-btn` now has a 44px touch target (min-height/min-width
   44px, font-size 1rem) and full-width mobile layout, matching
   `.presence-ack-btn`.
2. Tab from the focus phase title skipped the primary action: the entry
   controller now handles Tab/Shift+Tab explicitly — Tab from the phase
   title always lands on «Я здесь»/«Осмотреться»/retry (never browser chrome
   or the shell behind), Shift+Tab returns to the title.
3. Brief shell flash with the static «Ход 0» frame after acknowledge:
   `connect()` shows the `#shell-loading` dialog from its first synchronous
   line until snapshot + journal + discoveries render (`setShellLoading` in
   game-shell-view.js), covering the hardcoded T0 markup on boot and
   reconnect.
4. False error-dialog during graceful exit: a 409 `duplicate_request` on the
   exit acknowledge (request already processed server-side, e.g. replay
   after a lost response) was misclassified as CONFLICT and showed
   «Не удалось зафиксировать точку возвращения.» The exit controller now
   treats `duplicate_request` as an already-recorded exit: clear pending +
   lease, `skald:exit-ready`, no error text.
5. `forest_fire`/`wall_caution` leaked as raw keys into player text:
   `narrative.ts` now emits `situationLabel(type)` («Лесной пожар», unknown
   types humanized instead of raw snake_case) and `observationLabel(key)`
   («Память преграды», «Тревожный след», …) in ObservationUpdated /
   SituationStarted / SituationEnded / formatWorldState; the
   `sanitizePlayerFacingText` INTERNAL_LABELS net gained `forest_fire` and
   `wall_caution` for defence in depth. `situationLabel` +
   `sanitizePlayerFacingText` exported from @skald/world.
- Tests: narrative.test.ts asserts the labels and the ABSENCE of raw keys
  (+3 situationLabel/sanitize tests); presence-entry-view.test.ts +6
  (44px CTA CSS + mobile width, tab title→action hop, Shift+Tab return,
  shell-loading boot coverage, exit duplicate_request → exit-ready without
  the error literal). Full suites: world 28 files / 450 tests, CLI 28 files
  / 380 tests (1 pre-existing skip). `npm run validate` PASS.
- Pending: NTFS re-QA (desktop + mobile where the viewport override allows)
  of all five fixes plus the offline banner flow (queue → reconnect →
  accepted/rejected/conflict), then commit and deploy via the Orange Pi
  skill from a clean branch.

First living region architecture — accepted documentation proposal in
`docs/LIVING_WORLD_REGION_ARCHITECTURE.md` and ADR-0012. It separates backend
spatial truth from observer-scoped map knowledge, defines Event-bootstrap
authority, 20×20 km pilot resolution, process-driven spatial simulation,
fog/discovery, first entry, living-map updates and continent-scale boundaries.
No runtime Events, Rules, Projection, persistence or UI are implemented yet.

Interaction Model v1 — stages 0–2 + Slices 1–2 (ADR-0013, DECISIONS D-020;
in the working tree, not yet committed):
- Stage 0 docs: ADR-0013 written (context/alternatives/decision/7-slice
  table/DoD), `docs/WORLD_INTERACTION_MODEL.md` promoted v0 draft → accepted
  v1 contract, `docs/ux/INTERACTION_GRAMMAR.md` registers the v1 intentions,
  GLOSSARY gains InteractionCommand/InteractionVerb/TargetResolution/
  ambiguous_target, UX_ROADMAP slots UX-6.3.1 between UX-6.3 and UX-6.4.
- Stage 1 pipeline convergence: `IntentCommand` renamed `InteractionCommand`
  (never an Event); `InteractionVerb` fixed set
  observe/inspect/listen/touch/take/open/apply_force/give; parser yields
  canonical commands for RU stems with ё→е normalization, softener
  stripping («попытаться открыть сундук»), give item/recipient split,
  compound-intent rejection («Одна команда — одно намерение.»), confidence
  rounding; the English `examine|inspect` regex also parses canonical.
  `command-handler.ts` routes InteractionCommand → InteractionRequested with
  a registry gate; CLI guards (index.ts + world-handlers.ts) and
  `perceptionExamine` migrated to the canonical verb.
- Stage 2 shared Target Resolver (ADR-0013 §3): `resolveInteractionTarget`
  over ReadonlyWorld — grid entities must be nearby (Manhattan ≤ 1),
  WorldObjects must be in the player's current location; exact name/alias
  beats partial, partial only when it selects a single candidate, two equal
  → `ambiguous` with player-facing candidate names (never internal IDs);
  observe/listen without a target → `environment`. One resolver serves the
  runtime gate, the offline classifier and the HTTP/integration tests.
  `InteractionTarget` is a pure adapter (`targetFromEntity`/`targetFromObject`)
  over Entity/WorldObject; `WorldObjectPlaced` gained an optional
  `aliases` field («пепел» for «Кучка пепла») read by the object
  projector (additive, replay-safe).
- Slice 1 observe+inspect: RU observe stems (осмотреть/осматриваю/
  рассмотреть/оглядеть/посмотреть/взглянуть/проверить/…) →
  canonical `observe`; изучить/изучаю → canonical `inspect`; conjugation
  remnants stripped deterministically («осматриваю дверь» → дверь).
  Registry registers observe+inspect (law perception). Gates handle
  WorldObject targets and the environment fallback
  (TargetResolved { environment: true, locationId } →
  InteractionValidated { law: perception, locationId }). New
  `rules/interactions/perception.ts` (`perceptionObserve`): inspect/observe
  with an entity → EntityExamined, with an object → ObjectObserved,
  observe without a target → surroundings ActionResolved. Command Handler
  accepts observe without a named target; other verbs still require one.
  Offline classifier stays inspect-only (ADR-0013 §7) — «изучить петли»
  now parses to inspect and works offline.
- Tests: intent-parser 145 (observe/inspect canonical forms, legacy-kept
  listen/touch/apply_force/heat, compound rejection, remnants); world
  target-resolver.test.ts 16 (exact/alias/partial/ambiguous/missing/
  environment/location-scope), perception.test.ts 10 (object target,
  environment chain, full chain end-to-end), world-interaction.test.ts 11,
  critical-checks + interaction-force updated for `WorldObject.aliases`;
  full `npm run validate` PASS (74 files / 1101 tests).
- Slice 2 listen: RU listen stems (слушать/прислушаться/прислушать/
  подслушать/вслушаться/вслушать/прислушива/слуш) → canonical `listen`;
  `InteractionLaw` union grows to `"perception" | "listening"`; Command
  Handler accepts listen without a named target. New
  `rules/interactions/listening.ts` (`listeningListen`): environment listens
  scan `location.objectIds`, an object with temperature > `TEMPERATURE_HOT`
  (60) crackles `SoundObserved { sourceId, source, description, loudness:
  "quiet", distance, locationId }`, everything else is honest
  `ActionHadNoObservableEffect { reason: "silence" }`; concrete targets:
  hot object → SoundObserved, cold/heatless entity → `reason:
  "silent_target"`; hidden cause never revealed. `SoundObserved` added to
  event-types, narrative, game-shell builder and presentation
  (`SOUND_OBSERVED` + silent-target `ACTION_HAD_NO_OBSERVABLE_EFFECT`
  templates). Tower alias «окна» added for «Разбитое окно».
- Tests (Slice 2): intent-parser 148 (listen canonical forms incl.
  «прислушаться у окна»/«слушать звуки»/bare «прислушаться»; legacy test
  now uses touch), world listening.test.ts 11 (environment silence, hot
  object audible with loudness/distance, cold/hot concrete targets, grid
  entity Manhattan distance, non-listening-law ignore, command handler, two
  full chains end-to-end); focused runner
  `C:\Temp\opencode\slice2.test.sh`; full `npm run validate` PASS
  production HTTP + SQLite restart integration (3 tests), legacy composition
  root compatibility, SoundObserved → Belief Model coverage, and terminal
  projection coverage; full `npm run validate` PASS (76 files / 1122 tests,
  1 pre-existing skip).

UX-6.3 "Offline Intent Queue & Conflict Resolution" — first vertical slice
(deployed as 428072d, production smoke T218→T228 PASS):
- ADR-0011 `docs/adr/0011-offline-intent-queue.md` (accepted) + DECISIONS
  D-018 + GLOSSARY (Offline Intent Envelope, Base Revision, Offline Intent
  Resolution). Browser stores only a Command envelope
  `{ input, idempotencyKey, baseRevision }`; the server re-runs the Intent
  Parser and classifies `accepted | rejected | conflict | already_processed`;
  only accepted executes the normal command cycle; conflicts are text; no
  auto-rebase, no silent merge, no local Domain Events.
- `packages/world/src/offline-intent/{types,classifier,index}.ts`: pure
  deterministic `resolveOfflineIntent(envelope, { events, world, parsed })`
  — replays the event prefix up to `baseRevision` through WorldProjector,
  compares target resolvability between base and current world with the
  shared `findExamineTarget` predicate (extracted from the examine gate so
  classifier and Rule can never diverge). Frozen DTOs, no internal
  identifiers in player-facing text.
- API: `POST /api/worlds/:worldId/offline-command` (400 invalid envelope /
  415 / 405 / 404 / 503; `already_processed` uses the durable
  `processed_keys` table, restart-safe). Accepted responses carry the full
  command-cycle payload (events, state, presentation, shellDelta,
  observerThreads + delta).
- Browser: `offline-queue.js` (localStorage envelopes per world, bounded at
  20, dedupe by idempotencyKey, DOM-free + node-testable), `submitOfflineEnvelope`
  in world-api-client.js, `#offline-banner` in the command dock; on transport
  failure the composer saves the envelope, on (re)connect `flushOfflineQueue`
  re-submits, accepted → refresh shell/journal/discoveries, rejected/conflict
  → server text, transport failure → remaining queue waits.
- Tests: world `offline-intent.test.ts` 11 (accept/reject/conflict/
  invalid_envelope matrix, base-vs-current replay, determinism, frozen DTO,
  no leaks); CLI `offline-intent-http.test.ts` 9 (400s, accepted + executes
  EntityExamined, already_processed incl. restart durability, rejected
  unsupported/no_such_target, conflict via crossroads world where the player
  moved away, 405); `offline-queue.test.ts` 9 (parse/trim/enqueue/dedupe/
  bound/remove/degradation). NOTE: with the current rule set an examine
  target can only vanish if the player moves (grid worlds) or future events
  remove entities — conflict classification is live and tested, the second
  living process («следы чужого присутствия») will make it reachable
  organically. «осмотреть <объект>» RU forms are Interaction Model v1
  (next), the slice is exact English `examine <object>`.
- UX-6.2.1 hardening (deployed 5f95eeb): incompatible checkpoints handled
  explicitly by `buildObserverThreadDelta` — a checkpoint that presence
  resolves as `incompatible` is no memory at all (empty delta, current
  threads treated as a fresh reconstruction); CLI call site passes the
  resolved `checkpointState` through. 4 regression tests: no false `changed`,
  no false `resolved`, no offline-event leak (fully offline fire playthrough
  yields an empty journal and delta, no event names in the DTO), and the
  delta/journal match the missing-checkpoint result. Dependency audit
  classified (see Next #3).
- ADR-0010 `docs/adr/0010-observer-active-threads.md` (accepted, 10 points)
  + GLOSSARY terms (World Process, Observer Thread, Thread Evidence, Known
  Lifecycle, Knowledge State, Re-observation, Observer Thread Journal).
- `packages/world/src/observer-threads/{types,definitions,builder,delta,index}.ts`:
  pure deterministic thread journal. Definitions map existing presentation
  thread keys to lifecycle signals: FOREST_FIRE (`situation:forest_fire`,
  start ForestFireStarted/SituationStarted, develop TreeBurned, resolve
  SituationEnded), GENERIC_SITUATION (`situation:*`), CONSEQUENCE
  (`consequence:*`, resolveEventTypes: [] — TODO: no visible completion
  signal exists, so consequences never claim an ending). `ref =
  fnv1a("observer-thread:v1:"+key)` → `ot-<base36>`, raw keys never in the
  player DTO. Aging observed → remembered (≤3) → uncertain (4+);
  `knownLifecycle` (active/resolved/unknown) and `knowledgeState` are
  orthogonal; memory only from a `valid` observer checkpoint.
  `buildObserverThreadJournal({events, beliefModel, checkpoint,
  checkpointState, revision})` — checkpointState is a required caller input;
  `buildObserverThreadDelta({events, journal, checkpoint, checkpointState})`
  → opened / changed / resolved / becameUncertain; incompatible checkpoint
  is treated as no memory (UX-6.2.1).
- HTTP: `GET /api/worlds/:id/observer-threads` (200/405/404/503),
  `/observer-session` gains `threads` (same revision as session),
  command/wait/`advance N` responses gain `observerThreads` +
  `observerThreadDelta`; `/game-shell` snapshot gains `observerThreads`;
  `WorldPresenceSummary` gains `uncertainThreadCount`/`changedThreadCount`
  (card hint «Некоторые из твоих сведений могли устареть.»).
- Browser: «Активные нити» panel — 4th context tab + `threads-view.js`
  (DTO-only cards, montage tags «Новая нить»/«Изменилось»/«Завершилось»/
  «Требует проверки», honest labels «Есть противоречие»/«Эта нить требует
  нового наблюдения.», evidence with turn numbers, no buttons/chips), mobile
  nav button, registered in http-server.js jsFiles.
- Tests: world `observer-threads.test.ts` 26 + `observer-thread-delta.test.ts`
  9 (classification determinism, aging, offline hiddenness, never resolves
  from a hidden end, caps MAX_THREADS 8 / MAX_EVIDENCE 3 /
  MAX_RECENTLY_RESOLVED 3, no internal-id leaks, replay, deep-freeze);
  CLI `observer-threads-http.test.ts` 10 (uses in-process legacy-template
  worlds — HTTP worlds are location-based where "move north" is blocked and
  no fire can start; full playthrough: 3 moves → audacity t8 → move t9 →
  fire t14; waits advance exactly 1 tick, spread burns at even offsets);
  `threads-view.test.ts` 7 (DOM-mock renderer tests); client-modules +
  game-shell/http integrity additions. Full suites: world 28 files / 437
  tests, CLI 28 files / 376 tests (1 pre-existing skip).

## Completed

UX-6.2.1 hardening: `buildObserverThreadDelta` treats `checkpointState ===
"incompatible"` identically to a missing checkpoint — no remembered
baseline, no comparison against corrupted memory; regression tests cover
false `changed`/`resolved`, offline-event non-disclosure and equality with
the no-checkpoint result. Dependency audit classified (see Next #3).

UX-6.1 "Presence Lifecycle Completion" (commits through 76f609c, deployed
to Orange Pi: update + backup/integrity + 948 tests on-device + health/state
+ lifecycle smoke + idempotency edges PASS): atomic Entry DTO, entry state
machine with explicit «Осмотреться»/«Войти»/«Я здесь», lease routing
(`#/world/:id/return`), graceful exit with durable pending body, honest
phase-mapped loading texts, 6.1A-F tests.

UX-6.0D-F browser entry path (commits b9c02cd … d7ce256, deployed): Known
Worlds cards from `WorldPresenceSummary`, deterministic presence entry
reducer + view + controller, shell unlock via `skald:presence-ready`, a11y
touch-target fix (44px).

UX-6.0A-C: ADR-0009, `packages/world/src/presence/` (types, drift, builder),
SQLite schema v4 (`observer_checkpoints`, `acknowledge_requests`,
additive migration), three HTTP endpoints, offline observability filter in
the observation builder. The existing world/src/observation builder remains
the compatibility adapter consuming the canonical @skald/observation types.

Iteration 16.0 — Visual Shell: dark atmospheric game shell, contextual world stage, world/you/knowledge rail, honest activity and causal views, free-text composer only, responsive layout and generated map asset. Frontend-only; no new Domain Events, Rules, Projection or API contract changes.

UX-0 through UX-5.0B/C: product contract, open intent UI, multi-world
persistence, game shell, player guidance, and the production shell.

Iteration 15: Open Intent and Critical Checks, deployed to Orange Pi.

World Interaction Model v0 first vertical slice:
- additive entities read model from ObjectPlaced events;
- exact syntax examine <object> -> IntentCommand;
- durable gate chain InteractionRequested -> InteractionTimeValidated ->
  TargetResolved -> InteractionValidated -> EntityExamined;
- one static verb (examine) and one law (perception);
- curiosity observation side effect, Narrative/Presentation output, replay
  purity and same-tick action-budget coverage.

## Next

1. Dispatch the UX-6.3.1 re-QA prompt to the NTFS Codex thread: verify the
   five fixes (44px «Осмотреться» CTA, Tab from Focus title → «Я здесь»,
   no T0 shell flash during acknowledge, no false error dialog on graceful
   exit, no raw `forest_fire`/`wall_caution` in journal/shell texts) and run
   the offline banner flow visually (transport failure → envelope saved →
   reconnect flush → accepted/rejected/conflict banner; the offline
   `conflict` needs a scenario where an examine target disappears — e.g.
   queue `examine` while moving the player away in another tab, or a
   fire-starting playthrough). Desktop 1440×900 + mobile 390×844; mobile is
   recorded as BLOCKED if the viewport override still does not apply.
   Authorized click budget stated in the prompt; earlier UX-6.1/6.2
   assignments remain queued in the same thread. Record PASS/FAIL/BLOCKED in
   this file independently of validate.
2. Commit the UX-6.3.1 slice (msg.txt), then deploy via the Orange Pi skill
   from a clean branch after `npm run validate` (already PASS locally:
   72 files / 1046 tests).
3. Interaction Model v1 — remaining vertical slices in order (ADR-0013 §5):
   Slice 3 touch → Slice 4 take+inventory → Slice 5 open →
   Slice 6 apply_force+critical checks (migrates interactionForce) → Slice 7
   give; each migrates its RU stems to canonical InteractionCommand, grows
   `interaction-registry.ts`, and lands in `rules/interactions/*.ts` with
   focused tests + `npm run validate`. Offline stays inspect-only until
   UX-6.4; the «осмотреть <объект>» offline promise is now partially real
   (изучить → inspect works; осмотреть → observe is online-only).
4. Second living world process «Следы чужого присутствия»: noise → tracks →
   aging → observation → hypothesis → re-observation confirms/refutes;
   exercises Observation/Belief/freshness/contradiction/Active Threads/free
   Intent/Presence; its entity life cycle will make the offline `conflict`
   resolution reachable organically (entities appearing/vanishing while the
   player is away).
5. Dependency audit (separate task, not mixed with game iteration).
   Classification completed 2026-08-02:
   - Production tree is clean: root package.json has zero `dependencies`;
     `npm audit --omit=dev` reports 0 findings. Runtime deps are only
     `zod`/`zod-to-json-schema` (packages/observation) plus internal
     `@skald/*` workspace links.
   - All 5 findings are dev-only test tooling: `vitest@2.1.9` (critical,
     advisory 1120126, fixed in 3.2.6+), `vite@5.4.21` (high, fixed
     6.4.3+), `esbuild` (moderate; installed 0.28.1 via tsx — the flagged
     range is <=0.24.2, so this entry is stale), `vite-node@2.1.9` and
     `@vitest/mocker@2.1.9` (moderate, via vitest).
   - LAN reachability: NOT reachable. `skald.service` on the Pi runs the
     Node server only; vite/vitest are never started by the service; `npm
     test` runs only during an authorized update and binds nothing. Vitest
     UI must never be exposed to LAN.
   - Fix decision deferred by design (no blind major bump): npm's only
     complete `fixAvailable` is `vitest@4.1.10` (semver-major); the
     critical alone is fixed by `vitest@3.2.6` in the current major, but
     that still resolves an affected vite unless overridden. The task must
     evaluate vitest 4 migration (Node 22 OK; CLI/config deltas) vs pinned
     vitest 3.2.6 + vite 6.4.3 override, then run the full suite (1000+
     tests) and `npm run validate` before any change is accepted.
6. UX-6.2.1 hardening is DONE (see Completed): `buildObserverThreadDelta`
   now takes `checkpointState` and treats `incompatible` exactly like a
   missing checkpoint (no remembered baseline, no false changed/resolved,
   no offline leak, delta equals the no-checkpoint result); 4 regression
   tests added.

Note: ssh from WSL to 192.168.0.5 is currently broken (lands on a stale
endpoint with user `nook`); use the Windows OpenSSH client with
`$env:USERPROFILE\.ssh\id_ed25519_skald` for Pi operations.

## Known blockers

Mobile viewport override in the NTFS browser task did not apply (requested
390×844, actual 1440×900). Desktop browser QA works; record mobile status as
BLOCKED until the browser runtime supports the override.

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope. Small follow-up after the
deterministic gate pipeline is accepted.
