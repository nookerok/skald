# ADR 0010: Observer active threads (UX-6.2)

Status: accepted

## Context

The world keeps living while the player is away: Situations run, Consequences
fire, time passes. ADR-0009 established the entry reconstruction: a player
returning to a world may notice that their remembered representation no longer
fully matches what is observable now. But the player-facing story of long-lived
processes ends there. The journal knows threads — grouped series of
presentation entries — yet it has no notion of a thread's lifecycle, of what
the player remembers about it, or of whether the absence of new evidence says
anything at all about the process behind the thread.

The naive approach — "the fire is still burning" derived from active
Situations — leaks hidden truth: the player cannot see active Situations, and
a process the player never re-observed must never be reported as continuing.
Equally naive is the opposite: treating "no new observation" as "the process
ended". The absence of a new observation is not evidence about the world; it
is evidence about the observer.

The central rule: **the world may change without the player. The interface
reports only what the character remembers, observes now, or can reasonably
question — never hidden truth.** No new observation does not mean the process
completed.

## Alternatives

1. Expose the journal's thread entries and let the browser compute thread
   status. The browser would then decide which facts are available to the
   player — forbidden by the Observation & Belief boundary (§UX-6: all
   decisions about available information are backend).
2. Report active world processes from `ReadonlyWorld.activeSituations` or
   similar projection state. That is hidden truth: the player has no observer
   scope on Situations, and Consequences/Situations are internal simulation
   state, not player-facing knowledge.
3. Build thread lifecycle from the Event Log without observer scope. Offline
   Events would then create "continuations" the character never saw — the
   omniscient-reader failure ADR-0009 already rejected.
4. Derive a thread status from LLM judgement. Narrative and LLM are never
   authoritative; they describe existing facts and never decide for the world.
   Lifecycle classification is deterministic backend logic, not prose.

## Decision

Introduce the **Observer Thread Journal**: a pure, observer-scoped read model
of long-lived processes as the player knows them. It is not a Rule, emits no
Domain Events, does not manage Rules, does not write Projection and never
confirms hidden world state. Threads are grouped from the existing
player-facing journal (which already drops offline turns), then classified
deterministically into a player-facing DTO.

```text
Domain Events → Rules → Projection → Observation Engine → Belief Model
    → player-facing journal (skipOfflineTurns)
    → Observer Thread Journal (definitions + aging + memory)
    → Presence / Game Shell → UI
```

### 1. The thread journal is a read model, not a mechanics

`packages/world/src/observer-threads/` is pure, synchronous and deterministic
(no network, SQLite, LLM, `Date.now()`, `Math.random()`, hidden globals).
Everything is deeply frozen. Threads carry only display-safe text and times;
internal identifiers (thread keys, event IDs) are exposed only on the
Diagnostics surface. The journal never feeds Rules and never produces Events.

### 2. No new Events, no new Rules, no runtime registry

Thread definitions map existing presentation keys to lifecycle signals
(`start | develop | resolve | contradict`) plus a display summary. Real keys
come only from existing Presentation Templates; no new Event kinds are
invented. `SituationEnded` and `ConsequenceExpired` are the resolve signals
that already exist. When the available semantics do not justify a claim
(e.g. no completion signal for a process), the thread stays `unknown` or is
not claimed — a TODO is written instead of inventing an ending.

### 3. The journal never confirms hidden truth

A thread's `knownLifecycle` is what the observer knows, not what the world is
doing: `active` (the last observed entry says the process was ongoing),
`resolved` (the observer saw a completion signal), `unknown` (neither can be
claimed). No field reads `ReadonlyWorld.activeSituations`, raw Events or
offline turns. `advance N` ages knowledge but never reveals hidden changes.

### 4. Absence of observation is not completion

When a thread has no new entry since the last presence, it is not resolved and
not confirmed: its `knowledgeState` decays deterministically with age —
`observed` (seen at the current presence), `remembered` (age ≤ 3 ticks),
`uncertain` (age 4–12 ticks), and stays `uncertain` beyond that (two levels
are enough; age changes certainty, never lifecycle). The player-facing text
for an aged active thread is: "При последнем наблюдении пожар продолжался."
— never "пожар до сих пор горит" and never "пожар закончился".

### 5. Offline time is not evidence

Threads use the same observer scope as presence: turns whose `TickPassed`
carries `playerOffline: true` produce no presentation and no thread entry.
A hidden continuation keeps the thread dormant/aged; it never creates new
evidence. Aging still proceeds across offline time, because the character
experiences the passing of time, only not its hidden content.

### 6. "Unknown" is a state, not a claim

`knownLifecycle: "unknown"` (and, on the certainty axis, `contradicted`)
exists so the backend can tell the truth about what it does not know. The UI
labels it "Есть противоречие" or the neutral "Эта нить требует нового
наблюдения." Unknown does not mean active, resolved or unchanged; the DTO
never conflates the axes.

### 7. Certainty is separate from lifecycle

`knownLifecycle` (what the world is doing, as far as the observer can tell)
and `knowledgeState` (how current the observer's knowledge is) are two
orthogonal fields. A thread can be `active` yet `uncertain`; the summary text
combines both honestly. This split is what prevents both failure modes of the
naive approaches.

### 8. LLM rephrases; it never classifies

The backend classifies lifecycle, certainty, importance and change
(`appeared | developed | resolved | contradicted`). The browser renders the
DTO only. If LLM is used, it may rephrase selected facts but never select
facts, importance or lifecycle.

### 9. Thread keys are diagnostics-only

The opaque `ref = fnv1a("observer-thread:v1:" + threadKey)` is the stable
player-facing identifier; raw `threadKey` values appear only in
`ObserverThreadJournalDiagnosticsDTO` on the explicitly-opened Diagnostics
surface, never in normal UI.

### 10. The checkpoint is memory, not a copy of the world

The journal uses the same `observer_checkpoints` memory as presence: at a
`valid` checkpoint, threads known then are carried forward and aged; a
missing or incompatible checkpoint means no memory of threads. The checkpoint
is not a world snapshot and never becomes a source of truth.

### Change since last presence

On entry (and after commands), the backend computes a per-thread change:
`appeared` (thread not known at checkpoint), `developed` (new observed entry),
`resolved` (completion observed since checkpoint), `contradicted` (belief
conflict involves the thread). These four kinds feed the entry montage
("Изменилось", "Требует проверки", "Завершилось", "Новая нить") with
deterministic caps (max 8 threads, 3 evidence entries per thread, 3
recently-resolved). The browser never compares DTOs to derive change.

## Consequences and gates

- Types live in `packages/world/src/observer-threads/types.ts`, registry in
  `definitions.ts`, pure builders in `builder.ts` and `delta.ts`.
- API: `GET /api/worlds/:worldId/observer-threads` returns
  `ObserverThreadJournalDTO` (200; POST 405; unknown world 404; poisoned
  world 503; errors `"internal error"`). The entry response gains a
  `threads` field with one consistent revision; command responses gain
  `observerThreads` and `observerThreadDelta` computed on the backend.
- `WorldPresenceSummary` gains `uncertainThreadCount` and
  `changedThreadCount` (card hints like «Некоторые из твоих сведений могли
  устареть.» — never claims about hidden facts).
- Browser: Game Shell "Активные нити" panel (desktop: right contextual
  column; mobile: collapsible section after Primary). Cards carry no command
  chips; the only allowed interaction is re-observation, stated neutrally.
- Tests cover classification determinism, aging, offline hiddenness, absence
  of hidden truth fields, delta kinds, caps, replay, deep-freeze, revision
  invariants and HTTP behavior.
