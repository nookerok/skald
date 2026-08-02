# ADR 0011: Offline intent queue & conflict resolution (UX-6.3)

Status: accepted

## Context

The world keeps living while the player is away (ADR-0009, ADR-0010): time
passes, Situations run, Consequences fire. A player may formulate an intent
when there is no connection — a natural next step after presence. Today the
browser's offline story ends at an in-memory retry button: the last command
is retried after a transport failure, and the world may have moved in the
meantime.

The naive approaches are all forbidden by existing invariants:

1. Let the browser simulate the command locally and reconcile later. The
   browser would then create Domain Events and mutate a local copy of World
   State — the Event Log is the only source of truth and its events are
   created by the server (AGENTS #1, #7).
2. Optimistic projection with automatic rebase or silent merge. The world is
   deterministic and authoritative; a browser-side merge fabricates a history
   that never happened, and "silently merging" an intent into a changed world
   can make the player act on premises that no longer hold.
3. Accept the stale command unconditionally after reconnect. Without a
   revision check the server would execute intents against a world whose
   premises the player never saw — the offline fire ADR-0009 failure, applied
   to commands.
4. Pre-validate the intent in the browser so it can be "checked" offline.
   The browser has no interpreter authority; the server re-runs the Intent
   Parser because only the server knows the actual world.

The central rule: **the player may formulate an intent without a connection;
only the server decides whether it is admissible in the current world.** The
browser stores exactly one thing — the Command envelope — and never Events,
state or projections.

## Alternatives

1. Queue raw text only and execute unconditionally on reconnect. Dropped:
   cannot tell the player their premises went stale (the door they wanted to
   open no longer exists).
2. Store the parsed intent in the browser instead of raw text. Dropped: the
   browser must not run or cache parser output that pretends to authority;
   the server re-interprets the original text against the actual world.
3. Auto-rebase: apply the intent to the newest world state without asking.
   Dropped: that is silent merge. On conflict the server executes nothing and
   the player re-formulates.
4. Only permit offline intents that are provably world-independent (pure
   waiting). Dropped: the slice's whole point is to prove the semantics of a
   *meaningful* offline intent with conflict classification.

## Decision

Introduce an **Offline Intent Queue**: browser-side persistence of Command
envelopes plus a server-side re-interpretation and classification endpoint.

```text
player types intent → no connection
→ browser stores { input, idempotencyKey, baseRevision } (localStorage only)
→ connection restored
→ POST /api/worlds/:worldId/offline-command
→ server compares baseRevision with the current world revision
→ server re-runs the Intent Parser and the interaction gates
→ resolution: accepted | rejected | conflict | already_processed
→ only "accepted" executes the normal command cycle
```

### 1. The browser stores only a Command envelope

`{ input: string, idempotencyKey: string, baseRevision: number }` —
`baseRevision` is the world event number the player last saw (from a server
snapshot; never locally derived). The browser never stores Domain Events,
never simulates, never mutates any local World State, and never rebases or
merges. The queue is display-only: pending count, then the server's text.

### 2. Only the server decides admissibility

The server re-runs `parseIntent` on the original text and then the normal
deterministic gates against the **current** world. The envelope is not a
command and never becomes one before the server accepts it.

### 3. Resolution vocabulary

```text
type OfflineIntentResolution =
  | "accepted"          — premises still hold; normal cycle executes now
  | "rejected"          — inadmissible for ordinary game reasons
  | "conflict"          — the world changed so the intent lost its meaning;
                          nothing executes
  | "already_processed" — this idempotency key was already committed
```

- `accepted`: the intent is still valid in the current world (the world may
  have changed elsewhere — that is fine; the server executes against what is
  true now). Execution is the normal command cycle, including any dice
  derivation, inside the same durable batch.
- `rejected`: ordinary reasons — unparsable text, an offline-unsupported
  intent, no such target. Nothing executes; the browser shows the server's
  text.
- `conflict`: the target existed at the envelope's base revision and can no
  longer be resolved in the current world ("Ты хотел осмотреть «телегу», но
  теперь это невозможно."). The server executes nothing automatically and
  never silently rebases. The player reads the text and formulates a new
  intent.
- `already_processed`: the idempotency key is already committed (durable
  `processed_keys` table, so this holds across restarts). The browser
  reconciles authoritative read models instead of re-sending.

### 4. Classification is a pure backend function

`resolveOfflineIntent({ events, world, envelope })` in
`packages/world/src/offline-intent/` replays the event prefix up to
`baseRevision` through `WorldProjector` to reconstruct the base world, runs
the same target-resolution predicate the examine gate uses (shared helper,
never a copy), and returns a frozen DTO. No network, no SQLite, no
`Date.now()`, no `Math.random()`, no LLM. Non-executing outcomes are
re-computed deterministically on retry; only `accepted` commits events and
consumes the idempotency key.

### 5. Hard constraints

- No local Domain Events, no optimistic Projection, no automatic rebase, no
  silent merge.
- Critical checks are never thrown early: the classification runs only the
  structural gates; dice are derived only inside the accepted cycle's
  committed batch (the existing `deriveEvents` roll).
- Conflict and rejection are text; the player re-formulates the intent.
- The queue is bounded (20 envelopes) and world-scoped.

### 6. Vertical slice scope

The slice supports exactly one safe offline intent: the narrow
`IntentCommand` examine path (`parseIntent("examine <object>")`). Anything
else is `rejected` with an honest text ("Сейчас без связи можно отправить
только «осмотреть <объект>»."). Explicitly out of scope for the slice:
movement, force, item transfer, critical checks, multi-command sequences and
large queues. Russian verb-form normalization, target resolution and
ambiguity handling ("телегу", "колесо телеги", "дверь справа") are
Interaction Model v1 — the parser today maps only `examine X` to the narrow
IntentCommand; the queue mechanism does not expand the parser.

## Consequences and gates

- `packages/world/src/offline-intent/{types,classifier,resolver,index}.ts`:
  pure, frozen DTOs, unit-tested (classification matrix, base/current
  replay, determinism, no internal identifiers in player-facing text).
- Shared target resolution: `findExamineTarget` extracted from the examine
  gate so the classifier and the Rule use the identical predicate.
- API: `POST /api/worlds/:worldId/offline-command` with
  `{ input, idempotencyKey, baseRevision }` (400 invalid envelope, 405 wrong
  method, 404 unknown world, 503 poisoned). Response carries
  `{ ok, resolution, message?, reason? }`; `accepted` responses also carry
  the normal command-cycle payload (events, state, presentation,
  observerThreads, observerThreadDelta) so the browser reconciles in one
  round trip.
- Browser: `offline-queue.js` (localStorage envelopes per world, bounded;
  banner rendering; flush on reconnect). On transport failure the composer
  saves the envelope; on the next successful connection the queue flushes;
  accepted → refresh authoritative views; rejected/conflict → server text.
- `already_processed` uses the durable `processed_keys` table; regression
  test covers the restart case.
- GLOSSARY: Offline Intent Envelope, Base Revision, Offline Intent
  Resolution (accepted/rejected/conflict/already_processed).
- Docs: DECISIONS D-018; UX_ROADMAP UX-6.3; PROJECT_MAP data flow;
  CODEX_HANDOFF (next milestones: Interaction Model v1, second living
  process — foreign presence traces).
