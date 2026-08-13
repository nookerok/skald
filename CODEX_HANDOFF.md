# Current work (2026-08-13 — ADR-0031 release evidence)

- Final runtime commit is `4c2b13777ad70b2bff507e37e36b7c5f2fe7c8cc`;
  `main` is clean and equal to `origin/main`.
- Deterministic Adventure acceptance is PASS: 100% required beats, 4
  meaningful choices, 4 journey legs, 4 world changes, 4 discovery advances,
  3 map-growth steps, 90 offline meaningful events, zero truth leaks/orphans/
  duplicates, replay/idempotency/restart persistence PASS.
- Full validation is PASS: 122 test files, 1457 passed, 1 skipped; Canon,
  Simulation, 10 eval scenarios and diff checks PASS.
- Orange Pi production is on the same commit after an explicit service
  restart; `skald.service`, healthcheck timer and backup timer are active;
  `/api/health` reports SQLite/multiWorld healthy. Ten post-restart API smoke
  commands returned 200 and the duplicate key returned 409.
- Fixed NTFS browser task completed a fresh living-region acceptance on
  `world-msr2hlyd-1-rcbao7c4j09`: selected template and entry were verified
  in DOM, Presence=1, 27 commands including `advance 24`, T0→T53, rumour,
  four travel legs, masonry discovery, map fog/reveal growth, autonomous
  consequences, Knowledge/Chronicle, reload and mobile no-overflow PASS.
- The compound negative intent now returns clarification and never creates
  the forbidden destination `я не прямо к башне`; this is covered by gateway
  regression tests and production browser evidence.
- Evidence bundle: `docs/acceptance/full-adventure-evidence-2026-08-13.md`.
  Human experiential release gate remains OPEN: the bounded browser run is not
  an independently timed 30–60 minute human playthrough; screenshot, pending
  interval and separate network-status checks are also explicitly recorded as
  unavailable. Do not claim the ten-question interest rubric is complete until
  a tester records it.
- Added a machine-checkable intake for the missing human record:
  `npm run acceptance:adventure:review -- <review.json>`, with an intentionally
  failing template at `docs/acceptance/full-adventure-review.template.json`.
  It requires real 30–60 minute timestamps, one Presence acknowledgement,
  24–48 offline ticks, desktop/mobile screenshots, pacing ≤3 and all ten rubric
  answers true; it does not manufacture or infer human answers.

# Codex Handoff

## Current work (2026-08-13)
- Observer-map and world-cutover hardening from the review: detail artwork is no longer reachable through guessed public asset URLs; unlocked descriptors and scoped detail route are server-owned; map requests reuse the projected spatial read view. Bidirectional journey observations preserve direction and interruption coordinates; relation knowledge keeps the strongest partial/full progress. Route hints reach deterministic route selection and LLM confidence is range-checked with low-confidence clarification. Resource extraction now requires the authored location and natural "take" aliases map to the existing extraction command. World cutover now preflights the bundle and atomically creates/promotes/succeeds the new world in one SQLite transaction.
- Full-adventure acceptance (ADR-0031) now covers the 15-beat adventure contract: living-region entry, AI-DM conversation, authored rumor, intentional goal, multi-tick route, route alternative, changed river/crossing, consequential discovery evidence loop, return/map growth, 24 autonomous ticks, re-entry and restart/replay chronicle. `npm run acceptance:adventure` passes with 4 meaningful choices, 4 completed journey legs, 4 world changes, 4 discovery advances, 3 map-knowledge growth steps, 90 offline meaningful events, chat alternation, replay purity, idempotency and restart persistence.
- Validation: `npm run validate` PASS (122 files, 1454 passed, 1 skipped), including Canon, Simulation, 10 eval scenarios, full-adventure acceptance and diff checks. Changes remain uncommitted, unpushed and undeployed.
- Live 30–60 minute browser/AI-DM proof is intentionally separate and remains BLOCKED: the fixed NTFS browser task can read the deployed production menu baseline but reports the existing presence-load error; the current worktree server on port 3010 returns `ERR_CONNECTION_REFUSED` from that browser task. No live-play success is claimed until a browser-accessible staging/deployment is authorized.

# Current work (2026-08-11)
- Observer-scoped Pilot Region map and progressive journeys completed (ADR-0030): server-owned ObserverSpatialKnowledge and map DTO v3 with revealZones/availableDetails are wired with withheld coordinates, detail coverage/unlock policy, and route geometry clipped to physically traversed prefixes. Journeys advance one deterministic tick at a time, can be interrupted by voice, never progress during offline ticks, and reveal destination only on completion. The browser client accepts v3 DTOs and keeps command controls visibly pending through fast responses. Validation: npm run validate PASS (122 files, 1442 passed, 1 skipped). Commit, push and production/browser re-verification are next.

- Production world entrypoint implemented (ADR-0029): SQLite schema v6 adds primary/succession tables; `world:cutover` creates and verifies an isolated `riverwatch-main` from `living_region`; `/api/continue` and unscoped gameplay resolve the primary world; superseded routes return 410 and browser redirects to the replacement presence entry. `npm run validate` PASS (121 files, 1428 passed, 1 skipped). Changes remain uncommitted, unpushed and undeployed.

- Conversation shell restored in the working tree (ADR-0024 amendment): the main surface now uses the two-voice `#chat-feed`; gateway clarifications render as transient Master replies; top navigation is Map / You / Knowledge; Dev and the separate discoveries overlay are removed from the player shell. Full validation PASS (118 files, 1422 passed, 1 skipped). Fixed NTFS browser QA PASS for the static shell at localhost:3010 on desktop/mobile widths; actual mounted Game Shell/Map runtime remained BLOCKED because the read-only budget forbade Presence acknowledgement and the local database had no entered world. Changes remain uncommitted, unpushed and undeployed.

## Current work (2026-08-09)

- AI-DM Interpretation Gateway implemented (ADR-0028): deterministic fast path plus bounded LLM IntentProposalV1 fallback. Proposals are schema/capability validated into existing transient commands; model authority fields, hidden IDs and compound intent execution are rejected. Clarifications return before the world queue with no Domain Events or TickPassed; HTTP and main shell render the clarification as a player-facing response.
- Added proposal and gateway tests; current validation after this milestone: npm run validate PASS (118 files, 1421 passed, 1 skipped). Changes remain uncommitted, unpushed and undeployed.


- Historical evidence layer implemented (ADR-0027): accepted physical traces for ancient culture, abandoned infrastructure, possible conflict damage, forest/climate shift and former river course; runtime discovery definitions require independent evidence and expose supported/contradicted/inconclusive read-side resolution.
- Resource node vertical slice implemented (ADR-0026): accepted Blackwood timber definition is compiled into bootstrap, projected with integer stock, supports extraction, depletion, deterministic world-time regeneration and blocking situations; command handler and RuleRegistry are wired.
- Region compiler/runtime genericization implemented: --region, --all and catalog checks; runtime loads generated bundles by region ID through region-catalog.json; pilot wrappers remain compatibility APIs.
- Validation after this milestone: npm run validate PASS (115 files, 1402 passed, 1 skipped); Canon and region authoring checks PASS. Changes remain uncommitted, unpushed and undeployed.

- A cohesive premium game interface is implemented in the working tree across the main menu, new-game journey, return screen, focused game HUD, Context, Chronicle, Discoveries, loading/error states and mobile layouts.
- Context now has a dedicated Map tab rendered from observer-scoped SVG/vector data. The reference artwork is authoring-only; runtime consumes only `ObserverMapDTO` from `/api/worlds/:id/map`.
- Deterministic fog of war reveals only the observer, traversed/observed/glimpsed locations and observed paths. Rumored locations create no marker, reveal or `knownArea` expansion, so hidden geometry never reaches the normal player renderer.
- Multi-world shell wiring now loads and unwraps the map endpoint independently from the game-shell snapshot, with an honest unavailable state. Desktop and mobile width constraints keep the full map inside the Context dialog.
- New-game rendering exposes an accessible three-step progress indicator (Hero / World / Beginning) without changing creation semantics.

- Image -> Canon pipeline implemented for the pilot region (ADR-0025): reference artifact manifest with exact SHA-256, normalized visual observation layer, proposed hypotheses/resources, human review, deterministic compiler projection and versioned pilot-region.v5.json bundle with region/content/discovery/simulation definitions and object provenance. Bootstrap begins with CanonGenesisRecorded and carries canonicalRefs/digests in payload provenance. Canon validation fails on stale compiled output; proposal-only waterfall/resource/hypothesis items are excluded from runtime.
- Runtime no longer reads region artwork: the public PNG/JPG/WebP assets and image-backed map foundation were removed. ObserverMapDTO v2 exposes only bounded knownTerrain vector patches; map SVG renders those patches under the existing fog mask.
- Full `npm run validate`: PASS (112 files, 1392 passed, 1 skipped), including typecheck, Canon, simulation, eval and diff gates.
- Local NTFS browser QA: PASS at 1440x960 and 390x844. SVG artwork, fog mask, 3 reveal circles, 2 corridor paths, observer scope, focus trap, Escape/opener restore, responsive overflow and zero console warnings/errors were verified; gameplay commands: 0 and worldTime remained T0.
- Changes are not committed, pushed or deployed.


Mutable milestone note. Git, tests and current source outrank this file.

## Current state (2026-08-08)

- Branch: main (== origin/main at `f9c845d`, deployed `4183a58`). Working tree
  carries UNCOMMITTED P2 fixes below (narration scheduling, touch targets,
  modal focus trap) — not yet committed or deployed.
- ADR-0024 / UX-7 "Chat & Chronicle interface" — COMPLETE, COMMITTED and
  DEPLOYED (`871917a` + narration fix `4183a58`), `npm run validate` PASS.
  Browser QA still pending (NTFS thread; see Next #0).
  - UX-7.1: main Game Screen is a vertical chronicle of player intentions and
    world answers (`chat-feed-view.js`, `#chat-feed`); suggestions stay in the
    DTO and are never rendered as chips (per ADR-0024 point 2). Session-scoped
    intent bubbles — a PlayerCommand is not a Domain Event.
  - UX-7.2: activity and causal panels moved off the main centre-column into
    context-rail tabs (Вокруг / Почему); the chronicle dominates the screen.
  - UX-7.3: two-voice narrative pacing — player bubble (ТЫ) vs world answer
    (МИР + Ход N header), discovery-mark chip, feed styles.
- Persistent literary turn narration (ADR-0024 MIR voice), DEPLOYED:
  - `packages/world/src/narrative-llm.ts` `narrateTurnLLM` — non-authoritative
    read-side decoration (AGENTS §4): rephrases only deterministic
    Presentation facts (turn primary + up to 3 notable, never background),
    emits no Events, writes no Projection. Returns `TurnNarration {text,
    model, usedFallback, fallbackReason, latencyMs}`.
  - Persistence schema v5: `turn_narrations` table (PK world_id+world_time,
    INSERT OR IGNORE), `migrateV4ToV5` wired into fresh/v1/v2/v3/v4 chains,
    `user_version` 5 verified on the live DB.
  - `/api/command` (online + offline-accepted paths) generate narration
    best-effort after the deterministic turn; journal merges only
    `usedFallback === false` narrations (`attachTurnNarrations`).
  - Client renders the narrated line in the chronicle (`.chat-world-narrated`,
    italic gold) above the template primary.
  - FIX `4183a58`: the original verbose DnD system prompt exhausted the
    provider's reasoning token budget (finish_reason=length, empty content,
    `empty response` → silent `chat_error` fallback). Compact prompt now
    yields prose within budget. Verified LIVE 2026-08-08 on Жора
    (world-msjeemf2-1-44xf6oisyo2): `look around` → HTTP 200 in ~12s,
    journal `narrativeLLM` with `usedFallback:false`, model
    `deepseek-v4-flash-free`, latency ~12s; DB row `used_fallback=0`.
    Fallback narrations are correctly never surfaced in the journal.
  - P2 fix (uncommitted): `wait` and `advance N` bypassed the new narration
    (both branches early-returned before narrateTurnLLM). Now narration is
    scheduled detached via a per-world `NarrationScheduler` (capped, serialized,
    never holds the command queue): online command / wait / offline paths each
    narrate the single turn; `advance N` narrates every tick (each tick is its
    own chronicle turn keyed by its own worldTime, so a single presentation
    cannot cover the batch). `turn_narrations` upsert now overwrites a stored
    fallback row so a later successful generation is never INSERT-IGNORED.
  - P2 fix (uncommitted): empty LLM reply was wrongly treated as `ready` —
    `markReady()` ran before the text check, deleting the runtime status with
    no persisted row, so the journal recomposed the turn as `not_requested`
    and the browser stopped polling as if prose was never asked for. The
    shared settle rule `shouldPersistNarration()` (used in BOTH the
    interactive and the `advance N` batch branch) now requires a non-empty
    `usedFallback=false` text; empty/fallback results recompose as
    `unavailable`, and `markReady()` runs only after the row persists.
  - P2 rework (uncommitted): the old fixed-timeout client refresh is replaced
    by server-driven polling — `public/narration-poll.js` + `app.js` read the
    journal's per-turn `narrationState` (`pending`/`ready`/`unavailable`/
    `not_requested`, decided in `resolveNarrationState`); the poll sleeps on
    `pending`, stops on the three terminal states, re-arms safely per command
    (generation-guarded, never two timers) and a 150s watchdog only guards a
    wedged poll. `/narration-poll.js` added to the HTTP static whitelist.
    ADR-0024 amended to surface the journal DTO lifecycle deviation.
  - Tests: world narrate-turn.test.ts 7, journal-narration.test.ts 3,
    CLI turn-narrations.test.ts 9 (persistence + `shouldPersistNarration` +
    empty-recompose regression), narration-scheduler.test.ts (bounded runner),
    narration-poll.test.ts 6, plus client-modules + server module-graph gates.
    Full `npm run validate` PASS.
- P2 touch-target fix (uncommitted): Known Worlds menu CTAs were below the
  44 px target minimum — «Открыть новый мир» measured 39.19 px
  (`menu.css .menu-secondary-btn`), «Вернуться» 26.25 px
  (`presence-entry.css .presence-card-enter-btn`). Both rules now set
  `min-height/min-width: 44px`, matching the Presence CTAs
  (`presence-ack-btn` / `presence-continue-btn`); same applied to
  `menu-primary-btn`. Browser QA for the Known Worlds screen still pending
  (NTFS thread).
- P2 modal focus fix (uncommitted): `aria-modal="true"` overlays
  (journal / discoveries / dev via `openShellOverlay`, plus shell-loading,
  shell-error, exit-overlay and the presence-entry dialog) now keep keyboard
  focus: background siblings get `inert` while a dialog is open
  (`refreshBackgroundInert`, `#app [role=dialog][aria-modal=true]:not([hidden])`)
  and the global keydown handler traps Tab/Shift+Tab within the dialog
  (`trapFocus`), in addition to Escape closing. Restores the opener element's
  focus on close (`closeShellOverlay`); the exit overlay synchronizes inert via
  `syncShellModalInert()` in presence-exit-controller.js. Browser QA for
  keyboard focus still pending (NTFS thread).
- Old module graph served; `/chat-feed-view.js` added to the HTTP whitelist.
- Playable v0.2 (`59cec34`, deployed): `journey.travel` unlocks travel to named
  destinations (verified live waypoint→city, 3 destinations), the observer
  checkpoint `updated_at` is monotonic (`1aa4950`).

_HISTORICAL (2026-08-07 snapshot, superseded by Current state above): branch was
clean == origin/main, deployed 7b83302; UX-6.3.1 is COMMITTED (72d997c, before
0958407) and has been live since the 0958407-era deploy — the five fixes (44px
presence CTA, Focus Tab order, T0 shell-loading cover, graceful-exit
duplicate_request handling, raw-key label humanization) were verified live.
This superseded the earlier stale note that claimed UX-6.3.1 was "uncommitted"._

Recent architecture base (all deployed): Simulation Evaluation Framework
(ADR-0022), Simulation Bible living-process catalog + 10 vertical scenarios
(ADR-0023: risk→fire Deferred), player experience visual report, pilot region
vision canon (visual-canon.json), and "establish pilot region initial
simulation state v0.1" (southern_borough + enriched initial observations).

_The last five deploys before the UX-7 milestone (6a41ca7, 9b85d12, 2481d85,
4bea92a, 7b83302) were docs/eval/backend-region; browser UI later changed for
ADR-0024/UX-7 (chronicle + rail tabs + narration, deployed 4183a58). Browser
re-QA of the UX-6.3.1 fixes is covered by Next #0/#1._

## Current milestone

First living region slice (ADR-0014) — COMMITTED (`0958407`, then travel in
`59cec34`), NOT the active next-step. It delivered the deterministic 20×20 km
region compiler, 6,400 terrain tiles, 400 simulation cells, spatial replay
projection and the observer-scoped `/map` endpoint; it does not expose hidden
geometry. Note the slice scope statement "adds no travel Rules" referred to
ADR-0014 itself; travel to named destinations then landed as its own commit
(`59cec34`, playable v0.2, verified live). The active milestone is ADR-0024 /
UX-7 chronicle + narration (see Current state above); next steps are in Next.

UX-6.3.1 "UI hardening" — COMPLETED. The five application defects from the
last NTFS browser QA run are fixed, committed as 72d997c (before 0958407) and
live on the deployed server since the 0958407-era deploy. Verified live
2026-08-07 (server 7b83302):
1. «Осмотреться»/«Войти» has a 44px touch target and full-width mobile layout
   (presence-entry.css: `.presence-continue-btn` min-height/min-width 44px).
2. Focus Tab order: `presence-entry-controller.js` handles Tab/Shift+Tab —
   Tab from the phase title lands on «Я здесь»/«Осмотреться»/retry, Shift+Tab
   returns to the title.
3. No T0 shell flash: `connect()` shows `#shell-loading` from its first
   synchronous line until snapshot + journal + discoveries render.
4. Graceful exit: `presence-exit-controller.js` treats 409 `duplicate_request`
   as an already-recorded exit (clear pending + lease, `skald:exit-ready`, no
   «Не удалось зафиксировать точку возвращения.»).
5. No raw keys: templates/narrative emit humanized labels; verified live
   («Местная община», «Лесной пожар», «Помощь»).
- Tests: narrative.test.ts label coverage; presence-entry-view.test.ts (+6:
  44px CTA CSS + mobile width, tab title→action hop, Shift+Tab return,
  shell-loading boot coverage, exit duplicate_request → exit-ready).
- Pending: NTFS browser re-QA of the five fixes on the live system (dispatch
  prompt prepared; actual run happens in the fixed NTFS thread). The last five
  deploys contained no browser-client changes by design (docs/eval/backend
  region), so the UI look is intentionally unchanged since 0958407.
- Verification 2026-08-07 (server 7b83302, worldTime 283; API + static asset
  inspection, browser unavailable from WSL task): Fixes 1-4 PASS (deployed,
  structurally correct: 44px CTA CSS + mobile override; Tab trap in
  presence-entry-controller; setShellLoading + #shell-loading element; exit
  duplicate_request handler). Fix 5 PASS (API-verified: belief displayName
  humanized — observation:risk_taken → «Тревожный след», wall_caution →
  «Память преграды», relation:guild → «Связь с другим»; journal humanized;
  patternId never rendered as display text). Visual/DOM rendering of fixes
  1-4 and the Knowledge tab still requires a real browser: BLOCKED (NTFS
  thread 019fa52b-… not reachable from the WSL task via opencode CLI); the
  dispatch prompt is prepared and queued.

First living region architecture — accepted in `docs/LIVING_WORLD_REGION_ARCHITECTURE.md` and ADR-0012. It separates backend
spatial truth from observer-scoped map knowledge, defines Event-bootstrap
authority, 20×20 km pilot resolution, process-driven spatial simulation,
fog/discovery, first entry, living-map updates and continent-scale boundaries.
RUNTIME IMPLEMENTED: the ADR-0012 spatial-compiler authority is live in the
ADR-0014 slice (region compiler/`SpatialProjector`/`buildObserverMap`),
committed `0958407` + `59cec34`; spatial *processes* (weather/river/settlement
read views) are separate later slices and are still documented-only.

Interaction Model v1 — stages 0–2 + Slices 1–2 (ADR-0013, DECISIONS D-020)
— COMMITTED (`72d997c`); this handoff note is retained for history only.
Remaining Slices 3–7 are the active next work (see Next #3):
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

0. ADR-0024 (UX-7) browser QA: DEPLOYED at `4183a58` (chronicle + rail tabs +
   persistent LLM narration, verified live via API). Remaining: NTFS browser
   visual QA of the chronicle + rail tabs + narrated line (record PASS/FAIL/
   BLOCKED here). Note: each real gameplay click mutates the canonical Event
   Log, so the delegated NTFS prompt must carry an authorized click budget.
1. NTFS browser re-QA of UX-6.3.1 on the LIVE system (URL 192.168.0.5:3000,
   commit 7b83302): verify the five fixes (44px «Осмотреться» CTA, Tab from
   Focus title → «Я здесь», no T0 shell flash during acknowledge, no false
   error dialog on graceful exit, no raw `forest_fire`/`wall_caution`/`guild`
   in texts). The dispatch prompt is prepared; the actual run happens in the
   fixed NTFS thread (click budget ≤4). Desktop 1440×900 + mobile 390×844
   (mobile recorded as BLOCKED if the viewport override still does not apply).
   Optionally verify the offline banner flow. Record PASS/FAIL/BLOCKED in this
   file independently of validate. UX-6.3.1 itself is committed (72d997c) and
   deployed — no further commit is needed.
2. PILOT_REGION_CANON_v0.1 → FIRST_DISCOVERY_EXPERIENCE.md: fix the first
   game contract (draft exists at docs/worldbuilding/PILOT_REGION_CANON_v0.1.md)
   as the Discovery Contract, then write the step-by-step first-5-minutes
   experience. Afterwards add the Causal Density metric (meaningful/total) to
   `npm run eval:living`.
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


## Current work (2026-08-09, region canonicalization)

- Added the reference-only Region Interpretation Layer at
  `docs/worldbuilding/pilot-region/region-interpretation.json`.
- Added the design-time Canon concept
  `docs/canon/regions/pilot-region/visual-interpretation.yaml`.
- Added deterministic validation through
  `scripts/canon/validate-visual-canon.mjs`, wired into `npm run canon:validate`.
- Added reference manifest registration, strict visual observation/proposal/review/toponymy validation, and authoring CLI flags.
- Added generic Canon loader/IR builder and compiled bundle v5 with region/content/discovery/simulation definitions, regionVersion, digests and per-object provenance. Runtime discovery now reads accepted definitions from the bundle.
- Existing southern-borough and initial-observation bootstrap entries are recorded as already compiled; no duplicate events or image/runtime coupling were introduced.
- Gate evidence 2026-08-09: `npm run validate` PASS (112 files, 1389 passed, 1 skipped; Canon, authoring, compile check, simulation, eval and diff checks PASS).
