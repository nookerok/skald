# ADR 0009: Observer presence reconstruction (UX-6)

Status: accepted

## Context

When the player returns to a world, the world has kept living: Situations ran,
Consequences fired, time passed. The naive approach — a "while you were away"
report built from the Event Log — leaks hidden facts and turns the player into
an omniscient reader of the world.

The world must not tell the player what happened. It must let the player notice
that their previous representation no longer fully matches what is observable
now. All knowledge about what the player may see is decided on the backend by
the observer-scoped Observation Engine; the browser only renders prepared DTOs.

The entry path becomes:

```text
Known Worlds → Connection → Belief Reconstruction → Presence Reconstruction
→ Focus → World
```

## Alternatives

1. Report "while you were away" from raw Events. Reveals hidden Situations,
   unobserved Consequences and internal state — violates Authority Hierarchy.
2. Compute drift client-side from two DTO snapshots. The browser would then
   decide which facts are available to the player — forbidden (§UX-6
   boundary: all decisions about available information are backend).
3. Keep no memory of the player's knowledge (no checkpoint). Then "last
   presence" and "what you knew then" are undefined, and the return cannot
   reconstruct anything.

## Decision

Introduce an operational `observer_checkpoints` persistence row per
`(world_id, observer_id)`. It is operational metadata, not a Domain Event, not
a source of world truth, and it never touches the Event Log or Projection.
Belief reconstruction is a pure backend read pipeline:

```text
Event Log + Projection
    → Observation Engine (observer-scoped)
    → Belief Reconstruction (belief model at checkpoint prefix)
    → Presence Reconstruction (drift, focus, threads, changes)
    → Player-facing DTO
```

New components are read models only: no new Rules, no new Domain Events, no
Projection fields. `packages/world/src/presence/` is pure and deterministic.

The original proposal referenced `docs/adr/0008-observer-presence-reconstruction.md`;
0008 is already taken by the belief-model freshness ADR, so this document is
numbered 0009.

### Observer checkpoint

```ts
interface ObserverCheckpoint {
  worldId: string;
  observerId: "player";
  lastPresenceWorldTime: number;
  lastPresenceEventNumber: number;
  beliefRevision: number;
  updatedAt: string; // wall-clock operational metadata, never used for drift
}
```

`beliefRevision` is a deterministic FNV-1a 32-bit digest of the serialized
BeliefModel at the checkpoint revision. Replaying the same event prefix
reproduces the same revision; different knowledge reproduces a different one.

The checkpoint is updated only by an explicit `acknowledge` request (shell
entry or graceful return to Known Worlds). It is never written from the
command/wait paths: commands and `advance N` must not move the checkpoint,
because the player's last presence is exactly where the shell recorded it, and
a checkpoint-write failure must never roll back a committed command. Commands
and `advance N` do not update the checkpoint.

Acknowledge idempotency is tracked in a separate `acknowledge_requests` row
per `(world_id, idempotency_key)` carrying a deterministic `request_hash` of
the request body and the original acknowledge result (changed flag and the
checkpoint as it was answered). A replayed key with the same hash is answered
with the stored original result before the staleness gate, so a network retry
after the world moved still reproduces the first response byte-for-byte; the
same key with a different body, or a key already used by a command, is a
conflict (HTTP 409 `duplicate_request`). The staleness gate (409
`stale_revision`) applies only to a key never seen before. The endpoint
requires an idempotency key.

### Checkpoint integrity

`beliefRevision` is validated on every reconstruction via
`resolveCheckpointState()`: the stored digest is compared with the digest of
the belief model replayed from the checkpoint event prefix. The stored time
and event number are part of the same check: both must be safe non-negative
integers, `lastPresenceEventNumber` must not exceed the log length (the
prefix is never clamped), and the replayed prefix must end exactly at
`lastPresenceWorldTime` — replacing only the time yields `incompatible` too.
A mismatch (corruption, algorithm change, tampering, truncated prefix) yields
`checkpointState: "incompatible"` and presence is built as if there were no
checkpoint — the backend never silently trusts a memory it cannot verify.
`checkpointState` is one of `missing | valid | incompatible`. The Known
Worlds summary exposes `lastPresenceWorldTime` only when the checkpoint
resolves `valid`; missing or incompatible memory reads as `null`.

### Belief drift formula

Drift is computed from one consistent revision: events and projection are read
synchronously and all derivations run synchronously, so a session can never mix
DTO fragments from two world revisions. If the acknowledged revision differs
from the current one, the backend answers 409 `stale_revision`.

```text
stale        = staleBeliefCount                       (clamped to 8)
contradicted = contradictedBeliefCount * 2            (clamped to 8)
threads      = unresolvedThreadCount                  (clamped to 4)
changes      = ceil(newlyObservedChangeCount / 2)     (clamped to 8)
score        = stale + contradicted + threads + changes

level:
  none    if worldTimeDelta == 0 or (no checkpoint)
  low     if score <= 2
  medium  if score <= 5
  high    if score > 5
```

Definitions:

- `staleBeliefCount`: checkpoint beliefs whose current freshness is <= 0.33
  (deterministic decay over `FRESHNESS_WINDOW = 12` ticks).
- `contradictedBeliefCount`: distinct beliefs involved in contradictions in
  the current observer-scoped model.
- `unresolvedThreadCount`: reserved per the original formula; the journal has
  no thread lifecycle (open/resolved) yet, so presence always passes 0.
  Dormant threads (checkpoint threads without continuation) are informational
  and are reported separately, never as an unresolved-thread drift factor.
- `newlyObservedChangeCount`: observer-scoped evidence in the current model
  with `observedAt > lastPresenceWorldTime`.

Reasons are deterministic, ordered, and generated only for non-zero factors:
`freshness_decay`, `contradiction`, `missing_evidence` (checkpoint belief
absent from the current model), `new_observation`.

### Offline observability

Ticks with `TickPassed.playerOffline: true` mark times when the observer was
absent. Events at those times are not observable and never enter the Belief
Model, discoveries, `nearbyChanges`, drift factors or focus. A player who was
offline cannot gain knowledge from events that happened during the absence;
time still passes and checkpoint freshness still decays. The same scope
applies to journal threads used by presence: `buildTurnJournal(..., {
skipOfflineTurns: true })` still applies every event to the historical
projection, but offline turns produce no presentation and no thread entries,
so a hidden continuation of a known thread keeps it dormant instead of
leaking hidden world activity.

### Observer scope gates

Presence content is derived only from the observer-scoped BeliefModel, the
player-facing journal and the explicitly passed `PlayerContext` (the player's
own current location title/description, resolved by the HTTP boundary). Hidden
world state (active Situations, unobserved Consequences, raw Events, internal
IDs) never enters the player DTOs. Internal identifiers (`patternId`,
`evidenceId`, `threadKey`, `targetId`) are exposed only on the Diagnostics
surface (`PresenceDiagnosticsDTO`); the player-facing session carries
display-safe text and time fields only, and the normal renderer must not read
the diagnostics surface.

`emotionalTone` is not added: there is no character-state model to derive it
from. `lastKnownIntent` is not added: a Command is not an Event and the last
intent is not guaranteed to be derivable from a canonical Event today.
`suggestedReobservations` are subjects of doubt ("Следы требуют повторного
наблюдения"), never navigation commands.

### Time-of-day

There is no World Clock law, so `focus.timeDescription` is always `null`; the
backend never invents a time of day. `focus.ambientDescription` is derived
only from observable heat evidence, otherwise `null`; the world has no weather
subsystem, so nothing is invented.

### Browser entry path (UX-6.0D-F)

The Known Worlds screen is the shell of the return path. Each world card is
rendered from the backend `WorldPresenceSummary` (`GET /presence`), loaded
lazily with at most three parallel fetches; one failed card degrades to
"unavailable" without hiding the other worlds. The card shows only
server-authored lines (`presenceStatus`, `knowledgeStatus`); raw ids,
timestamps and event numbers never appear as card content. Menu wording is
player-facing: «Известные миры», «Вернуться», «Последнее присутствие»,
«Открыть новый мир».

Entering a world routes to `#/world/:id/return` and runs the deterministic
entry state machine (`presence-entry-state.js`, a pure reducer):

```text
idle → requesting_session → presence → focus → acknowledging → ready
        ↘ retryable_error / stale_revision / unavailable
```

The controller performs the I/O implied by each phase: session fetch,
presence/focus rendering, acknowledge with an idempotency key, and retries.
There is exactly one truthful loading phrase («Восстанавливаем твоё
присутствие…») and no fake progress; the previous fake busy-stage cycling in
the Game Shell was removed. The Game Shell stays locked (no command input)
until `ACK_SUCCESS`; only then does the app switch to `#/world/:id` and
unlock.

Acknowledge durability: the pending idempotency key is stored in
`sessionStorage` under `skald:presence-ack:1:<worldId>` before the request
leaves. A transport failure keeps the same key for the retry; after a reload
the pending key is replayed first (the server answers the stored result by
key+hash). `stale_revision` and `duplicate_request` drop the pending key and
re-fetch the session — the state machine never auto-acks and never reuses a
key under a different body. The player acknowledges again with a fresh key
(graceful return).

The presence screen renders only DTO content: montage sentences
(`session.statements`), drift reasons and reobservation doubts — never event
names or client-side sentences. Modes (`first | invalid | valid-none |
valid-low | valid-medium | valid-high`) map backend `checkpointState` and
`drift.level` to presentation only; the browser classifies no truth. The
focus screen renders `PresenceFocus` blocks that are present and skips null
blocks (e.g. `timeDescription`). «Я здесь» is the single interactive element;
it acknowledges and never modifies state otherwise. The screen is a modal
dialog (`role=dialog`, labelled, focus-trapped, 44px targets) and respects
`prefers-reduced-motion`.

## Consequences and gates

- Contract types live in `packages/world/src/presence/types.ts`; builders in
  `presence/drift.ts` and `presence/builder.ts`.
- SQLite schema v4 adds `observer_checkpoints` and `acknowledge_requests`;
  migration is additive, keeps Event Log untouched, verified by integrity
  check.
- API: `GET /api/worlds/:id/observer-session`,
  `GET /api/worlds/:id/presence` (player-facing presence plus the
  `WorldPresenceSummary` known-worlds card),
  `POST /api/worlds/:id/presence/acknowledge` (idempotency key required;
  replay by key+request hash, 409 on body/key conflicts).
- Browser: `known-worlds-view.js`/`presence-card-view.js` (cards),
  `presence-entry-state.js` (pure reducer), `presence-entry-controller.js`
  (I/O), `presence-view.js`/`focus-view.js` (DTO-only renderers).
- Tests cover the drift thresholds and per-factor caps, reconstruction
  determinism, checkpoint integrity (`valid`/`incompatible`), offline
  observability, checkpoint persistence across restarts, absence of hidden
  facts, absence of forbidden truth fields (`actual*`/`true*`/`real*`) and
  the split between player-facing and diagnostics surfaces.
