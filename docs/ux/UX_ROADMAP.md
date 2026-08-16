# UX Roadmap

## UX-0 — Product Contract (completed)

Capability classification, authority boundaries, screen tiers, interaction
grammar, shared state model and acceptance gates. Documentation only.

## UX-1 — Current Playable Shell (completed)

Responsive Game Screen, presentation, journal, threads, recovery states,
diagnostics, design tokens, accessibility, keyboard navigation.

## UX-2 — Discovery Presentation (completed)

Trace, Hypothesis and Discovery as read-side concepts. Discovery builder,
presentation marks, /api/discoveries, Discovery tab in UI.

## UX-3 — Onboarding & Contextual Suggestions (completed)

Deterministic guidance phases: first_action → explore_world → test_trace →
strengthen_hypothesis → observe_consequence → review_discovery → free_play.
Static action allowlist. Browser guidance-view.js with dismissal.

## UX-4.0 — Main Menu & Multi-World Persistence (completed)

Schema v2 migration, WorldRuntimeManager, scoped HTTP API, Main Menu,
Continue via /api/continue, hash routing, world-api-client.

## UX-4.1 - New Story Entry & Real Story Creation (completed)

The player starts inside the single authored region, Бассейн Речного Стража:
Кто ты? → Откуда начинается твоя история? → Пролог → Начать путь.
The public catalog is `/api/new-game/options`; technical world templates,
world IDs and save labels remain internal compatibility metadata. Creation uses
an authored `entrypointId`, deterministic bootstrap events, idempotent retry and
an inline first Presence acknowledge before opening the Game Shell conversation.

## UX-5.0 - Visual Shell and Observation & Belief (completed)

Atmospheric shell, free-text composer, responsive context rail and normative
Observation & Belief Knowledge renderer. BeliefModelDTO is derived from Event
Log + ReadonlyWorld and deployed on Orange Pi.

## UX-4.2 — Save Management (next)

Deletion, renaming, archiving, export/import of worlds.

## UX-5 — Extended Interactions

Inventory, map, NPC dialogue and natural-language clarification, each as its
own vertical slice with Events, Rules, Projection and API mapping.

## UX-6 — Offline and resilience

Backend presence reconstruction shipped: known-worlds entry path
(`observer-session`), drift over observer-scoped belief reconstruction,
operational checkpoint written only by explicit acknowledge, offline ticks
not observable.

Browser entry path shipped (UX-6.0D-F): Known Worlds menu with lazy presence
cards, deterministic presence entry state machine (idle → requesting_session
→ presence → focus → acknowledging → ready, with retryable_error /
stale_revision / unavailable), durable same-key acknowledge retry in
sessionStorage, one truthful loading phrase, DTO-only presence montage and
focus screens, Game Shell locked until acknowledge succeeds. Entry routing
lives on `#/world/:id/return`.

### UX-6.2 — Observer Active Threads (completed)

Observer Thread Journal shipped: pure observer-scoped read model of
long-lived processes as the player knows them (ADR-0010). `observer-threads`
definitions map existing journal thread keys to lifecycle signals
(start/develop/resolve/contradict); threads age observed → remembered →
uncertain; the checkpoint is memory, not a world copy. `GET
/api/worlds/:id/observer-threads`, entry `threads` field, command
`observerThreads` + `observerThreadDelta`, WorldPresenceSummary thread
counts. Game Shell "Активные нити" panel (context tab; mobile nav button)
renders DTO-only cards with montage tags and honest labels, no command
chips. Never confirms hidden truth: a hidden Situation end never resolves a
thread.

Open item: write-capable offline actions still require an explicit
synchronization and conflict-resolution design.

### UX-6.3 — Offline Intent Queue (vertical slice shipped)

Offline intent queue shipped (ADR-0011, DECISIONS D-018): the browser stores
only a Command envelope `{ input, idempotencyKey, baseRevision }` in
localStorage (bounded 20, dedupe by key); on reconnect `POST
/api/worlds/:worldId/offline-command` re-runs the Intent Parser and
classifies `accepted | rejected | conflict | already_processed`
(`resolveOfflineIntent` is a pure classifier over base-vs-current world
replay with the shared `findExamineTarget` predicate). Only `accepted`
executes the normal command cycle; conflicts are server text, never silent
rebases; `already_processed` is durable across restarts. Browser flushes the
queue on (re)connect with a banner for each outcome.

Slice scope: exact English `examine <object>` only; everything else is
rejected with an honest text. RU verb forms («осмотреть <объект>»), target
resolution and ambiguity handling are Interaction Model v1. The second
living process «Следы чужого присутствия» will give the conflict
resolution a naturally reachable scenario (entities appearing and vanishing
while the player is away).

### UX-6.3.1 — Interaction Model v1, stages 0–2 + Slices 1–2 (in progress)

One canonical interaction pipeline (ADR-0013, DECISIONS D-020): the parser
yields `InteractionCommand` (canonical verbs; observe/inspect RU stems
normalized in Slice 1, изучить → inspect; listen RU stems normalized in
Slice 2); the shared ambiguous-aware Target Resolver (exact beats alias,
single-partial-only, two-equal → ambiguous, environment fallback for
observe/listen) is used by the runtime gate, the offline classifier and the
HTTP tests; `WorldObject` gained player-facing aliases («пепел» for «Кучка
пепла»). The perception law rule lives in `rules/interactions/perception.ts`
(EntityExamined / ObjectObserved / surroundings ActionResolved); the
listening law rule lives in `rules/interactions/listening.ts` (SoundObserved
with loudness/distance in observer scope, honest
ActionHadNoObservableEffect for silent surroundings and cold targets, hot
objects crackle). Remaining slices (touch, take, open, apply_force+checks,
give) migrate the legacy `interaction.*` rules gradually; offline stays
inspect-only until UX-6.4.

### UX-6.4 — Offline movement, force and item intents

Later vertical slices widen the offline slice (movement, force, item
transfer, critical checks) using the same envelope + resolution contract;
critical checks must keep the "dice only after acceptance" invariant.

## UX-7 — Chat/Chronicle Interface (ADR-0024)

The main Game Screen becomes a dialogue with the living world: a vertical
chronicle of player intentions and world answers with the free-text composer
as the only permanent control. No recommendation buttons in the first UI
layer; map, knowledge, character and threads live in tabs, not as a HUD.

### UX-7.1 — Chat Core

`chat-feed-view.js` renders the chronicle from the existing journal DTO plus
session-scoped intent bubbles; replaces the narrative stack and the
horizontal turn-history strip. No DTO/Event/Rule/HTTP changes.

### UX-7.2 — Tabs

Extract map, knowledge, character, activity and causal panels fully out of
the main screen into tabs/overlays.

### UX-7.3 — Narrative polish

Turn rhythm, "ты сделал / мир ответил" separation and visual pacing of the
chronicle.

## UX-8 — Visual, audio and accessibility polish

Animation, sound, assets, reduced-motion, responsive QA and performance gates.
