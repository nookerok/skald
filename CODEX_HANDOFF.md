# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-08-02
Branch: main
Working tree: dirty (UX-6.2.1 hardening uncommitted — see Current
milestone; UX-6.2 is deployed as 84e1011). Deployment record: Orange Pi
update-orange-pi.sh (fast-forward from e156122, backup + integrity OK,
on-device 1003 tests PASS, health/state OK, 10-turn smoke PASS: 200×10 with
ok:true, presentation.primary non-null, worldTime +1 per turn, 409 on
duplicate idempotency key). NTFS visual QA for UX-6.1 and UX-6.2 remains
BLOCKED (Codex backend 403 via Cloudflare); assignments are queued in
thread 019fa52b-1610-7b23-9567-37891d24c782 and must be run once the
backend is reachable.

## Current milestone

UX-6.2.1 hardening (in progress, validated locally): incompatible
checkpoints handled explicitly by `buildObserverThreadDelta` — a checkpoint
that presence resolves as `incompatible` is no memory at all (empty delta,
current threads treated as a fresh reconstruction); CLI call site passes the
resolved `checkpointState` through. 4 regression tests: no false `changed`,
no false `resolved`, no offline-event leak (fully offline fire playthrough
yields an empty journal and delta, no event names in the DTO), and the
delta/journal match the missing-checkpoint result. `npm run validate` PASS
(69 files / 1007 tests, 1 pre-existing skip). Dependency audit classified
(see Next #3).
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

1. Dispatch the UX-6.2 visual QA prompt to the NTFS Codex thread (separate
   QA world: 5 commands / 6 offline ticks / 3 acks; desktop 1440×900 +
   mobile 390×844; 5 screenshots: threads tab empty, threads tab with fire
   thread, offline advance then re-entry — thread still active/uncertain and
   not resolved, mobile threads nav, journal overlay). Authorized click
   budget stated in the prompt; UX-6.1 assignment still queued in the same
   thread. Record PASS/FAIL/BLOCKED in this file independently of validate.
2. Design write-capable offline actions with explicit synchronization and
   conflict-resolution semantics (roadmap open item).
3. Dependency audit (separate task, not mixed with game iteration).
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
     vitest 3.2.6 + vite 6.4.3 override, then run the full suite (1007+
     tests) and `npm run validate` before any change is accepted.
4. UX-6.2.1 hardening is DONE (see Completed): `buildObserverThreadDelta`
   now takes `checkpointState` and treats `incompatible` exactly like a
   missing checkpoint (no remembered baseline, no false changed/resolved,
   no offline leak, delta equals the no-checkpoint result); 4 regression
   tests added.

Note: ssh from WSL to 192.168.0.5 is currently broken (lands on a stale
endpoint with user `nook`); use the Windows OpenSSH client with
`$env:USERPROFILE\.ssh\id_ed25519_skald` for Pi operations.

## Known blockers

NTFS/Codex visual QA backend: 403 (`chatgpt.com/backend-api` via
Cloudflare); HTTP to the Pi and the WSL workaround path are unaffected.

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope. Small follow-up after the
deterministic gate pipeline is accepted.
