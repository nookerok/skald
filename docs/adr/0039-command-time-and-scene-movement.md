# ADR 0039: Command Time and Scene-Relative Movement

Status: accepted

Amends ADR-0013 movement ownership and ADR-0015 command cost clarity.

Two review items blocked acceptance (review 2026-10-04); both were addressed,
T3 landed and the full gate passed, so this ADR is accepted:

1. the journey `+2` source — **resolved** (see below);
2. the full-owner characterization matrix, deterministic-vs-master-turn parity
   and `npm run validate` — **resolved** (see below).

### Open item 1 — resolved (2026-10-04)

`packages/cli/test/command-time-characterization.test.ts` ("journey start:
full causal event trace") proves the causal graph:

```text
JourneyRequested      ts=1  cmd-1  (root)
JourneyValidated      ts=1
JourneyStarted        ts=1
JourneyStepRequested  ts=1
TickPassed            ts=2  ← created by journey.progress, not the CLI
RiverLevelChanged     ts=2
...
world.time after = 2
```

There is **no generic root tick** (`rootTicks=0`): the CLI `suppressTick`
works. The second world-time step is the first journey step itself —
`journey-progress.ts:139` emits the first `TickPassed` at
`Math.max(world.time, event.timestamp) + 1`. The fix therefore belongs to the
journey rule (emit the first pulse at the command's own logical time, T+1),
not to `planCommandTime`. This ADR keeps the cost table's `journey_start = 1`
and adds that the journey's first pulse must carry the start command's
timestamp.

### Open item 2 — resolved (2026-10-04)

Full gate after T3 (2026-10-04): Test Files 230 passed (230); Tests 2865
passed | 1 skipped (2866); typecheck clean; canon 11 concepts / 2 anchors / 7
not-simulated / 0 warnings; visual-canon, map-matrix, region compile PASS;
simulation 5 definitions / 2 bindings; eval 10 scenarios / 0 failing;
diff-check PASS; `[validate]` PASS.

### Implementation — landed (2026-10-04)

`packages/world/src/command-time-policy.ts` owns the cost table
(`planCommandTime`, `commandCorrelationId`); both `suppressTick` copies are
removed; `journey-progress.ts` exposes `initialJourneyPulseTimestamp` (first
step at the start command's own time, T+1) and `nextJourneyPulseTimestamp`
(later waits). Observed post-fix: journey start +1 / 1 pulse (was +2 / 1),
traveling rejection 0 / 0 (was +1 / 0), interrupt 0 / 0 (was +1 / 0); parity
deterministic vs master-turn is delta=1, ticks=1 in both.

`command-time-characterization.test.ts` (18 tests) proves each owner branch:
`grid_direction` → `physics.movement`; `present_contact` → `contact_approach`
with a single outcome; `connected_location` → `interaction.movement`;
contact/connection collision (operation-aware); `remote_location` → journey
with no `PlayerLocationChanged`/`MovementSucceeded`; unknown → clarification;
and the absent-known-contact collapse to clarification (the defect this ADR
fixes). The gate is reported with its overall counters (test files / passed /
skipped / typecheck / Canon / diff-check / exit code), not a focused-suite
count.

### Implementation — movement targets (T4, revised 2026-10-04)

`resolveMovementTarget` (`target-resolver.ts`) classifies a movement intent
with the operation-aware priority; `locationConnectionMatches` replaces the
`String.includes` connection comparison with the shared Russian stemmer
(`sameRussianStem`) and matches only the player-facing connection NAME (never
the internal destination id), ranking all-word > exact > stem and returning
`ambiguous` for ties. `resolveApproachTarget` checks a present contact before a
connection, so a colliding NPC stays approachable. `world-handlers` preflight
turns a known-but-absent contact into a cost-0 `action_rejection`
(`target_not_present`, «X сейчас не рядом») with no Domain Event, persisted as
an `action_rejection` conversation turn; a model-proposed plan runs the SAME
preflight, so the two entry points agree — deterministic, scripted model plan
and repaired plan all return the same `action_rejection` (repaired-path test:
invalid proposal → repair → valid plan → `action_rejection`, 2 provider calls,
one turn, no time, no Events). Gate: Test Files 231 passed (231); Tests 2890
passed | 1 skipped (2891). Acceptance evidence:
`artifacts/.../command-time-and-scene-movement/acceptance`. Status stays
`proposed`: acceptance is a separate explicit step.

## Context

Skald runs two coexisting movement worlds: the legacy grid
(`player.x/y`, `walls`, no `currentLocationId`) and the living region
(`currentLocationId`, `locations`, `connections`). Time, movement ownership
and proximity grew independently, and T1 characterization
(`packages/cli/test/command-time-characterization.test.ts`, 2026-10-04)
pinned observable divergences:

- `projection.ts:425` sets `s.time = event.timestamp` unconditionally, so any
  event carries a new timestamp — `TickPassed` is not the only carrier of
  world time.
- The command executor stamps `ts = before.time + 1` on the root event and on
  its `TickPassed`; a duplicated `suppressTick` policy exists in both
  `master-turn-executor.ts` and `world-handlers.ts`, and the two paths
  disagree (a journey start observed cost **+2 with one pulse**, not the
  intended one step without a pulse).
- A command issued while traveling is rejected *and* still advances world time
  by one; an interrupt also advances world time by one.
- Movement ownership is split across `physics.movement` (grid),
  `interaction.movement` (connections) and `interactions.contact_approach`
  (present contacts), but the typed target classification is reconstructed
  from strings in more than one place.

The LLM may recognize intent, but it must not decide command cost, route
availability, movement outcome or proximity.

## Decision

### 1. Command time is one pure policy

A single pure function owns command cost:

```text
planCommandTime(intent, world): CommandTimePlan
  { kind, cost, eventTimestamp, emitTickPassed, reason }
```

Cost table:

| Command | kind | cost | TickPassed |
|---|---|---|---|
| inquiry / meta answer / clarification | `read_only` | 0 | no |
| instant read-only interaction | `instant` | 0 | no |
| ordinary action (observe, take, …) | `turn` | 1 | yes |
| blocked physical attempt | `turn` | 1 | yes |
| target not determined (preflight/contextual) | `read_only` | 0 | no |
| approach to a present contact | `turn` | 1 | yes |
| move to a connected location | `turn` | 1 | yes |
| journey start | `journey_start` | 1 | no |
| journey wait | `journey_wait` | N | yes per pulse |
| journey interrupt | `journey_interrupt` | 0 | no |
| unrelated command while traveling | `rejected_while_traveling` | 0 | no |

Rules:

1. `event.timestamp` is the event's own clock value; `world.time` is the
   projection's latest applied timestamp; they are not interchangeable with
   "cost".
2. A cost-0 command that must still be journaled stamps **current** world
   time, never `world.time + 1`. This removes the "TickPassed suppressed but
   time advanced" masking effect.
3. `TickPassed` remains the authoritative discrete pulse for time-driven Rules
   (heat, weather, river, settlement, journey progression). Its presence is
   not the definition of time; the policy above is.
4. The duplicated `suppressTick` policy is deleted; both
   `master-turn-executor.ts` and `world-handlers.ts` call `planCommandTime`.
5. `duration-check` keeps "traveling before insufficient_time" order; a
   traveling rejection has cost 0 and must not move the clock or
   `lastActionTick`; a resolved/or blocked turn attempt of cost 1 updates
   `lastActionTick` even when blocked.
6. Journey progression must not add a second world-time unit at start. The
   T1 event trace proved the `+2` comes from `journey.progress` emitting the
   first `TickPassed` at `Math.max(world.time, event.timestamp) + 1`, not from
   the CLI. The rule exposes two explicit branches — no shared arithmetic with
   a hidden special case:

   ```text
   initialJourneyPulseTimestamp(event, world)  // first step: the start command's own ts (T+1)
   nextJourneyPulseTimestamp(world)            // later waits: world.time + 1
   ```

   `elapsedTicks` stays consistent: the first pulse still counts one step, but
   at the start command's logical time. Parity is confirmed: the deterministic
   command cycle and the master-turn executor produce the same cost and pulse
   count for the same journey replica.

### 2. Movement targets are typed; each has exactly one owner

```text
type MovementTarget =
  | { kind: "grid_direction"; direction }
  | { kind: "connected_location"; locationId; connectionId }
  | { kind: "present_contact"; contactRef; locationId }
  | { kind: "remote_location"; locationId; routeId? }
  | { kind: "unavailable_contact"; surface; name }
  | { kind: "ambiguous"; candidates }
  | { kind: "unknown"; surface };

resolveMovementTarget(intent, world): MovementTarget
```

The order is **operation-aware**, not a fixed contact/connection precedence:

| Operation | Priority |
|---|---|
| `approach` | present contact → connection → object → unknown |
| `enter` | connection → unknown |
| `travel` / journey | route/location → unknown |
| `move` + direction | grid direction (no `currentLocationId`) or connection |
| several equal candidates | clarification |

«Подойду к X» prefers a present contact even when X also names a location
connection; «Войду в X» / «Пойду через X» prefer the connection. A blanket
"connection wins" rule would make an NPC whose name collides with a place
unreachable by approach (T1 collision characterization).

| Target | Owner rule | Outcome |
|---|---|---|
| `grid_direction` | `physics.movement` | `MovementSucceeded`/`MovementBlocked` |
| `connected_location` | `interaction.movement` | `PlayerLocationChanged` |
| `present_contact` | `interactions.contact_approach` | `ActionResolved[approach]` |
| `remote_location` | journey rules | journey events |
| `unavailable_contact` | preflight rejection | `action_rejection`, no event |
| `ambiguous` | preflight | clarification with observer-safe candidates |
| `unknown` | preflight/contextual | clarification, no events |

No action may yield two outcomes (e.g. both an approach resolution and a
location change).

Matching is **morphological**, never `targetRaw.includes(connName)`, and only
the player-facing connection NAME is a search surface — never the internal
destination id (knowing an internal id must not address an unobserved route).
The resolver uses the project's Russian morphology layer (ё/е normalization,
tokenization, `stemRussianToken`, `sameRussianStem`) and ranks: all content
words match > one exact word > one shared stem. Ties (e.g. «Северные ворота»
vs «Старые ворота» for «воротам») return `ambiguous`, never the first match.
Required positives: дверь/двери/дверью, переправа/переправе/переправу,
Речной Страж/Речного Стража/Речному Стражу. Required negatives:
река ≠ рука, мост ≠ место, страж ≠ страна, and
«Северные ворота» ≠ «Северный перевозчик».

A known but absent contact is an **`action_rejection`** (responseKind
`action_rejection`, reason `target_not_present`), not a clarification: the
player named a real person, so no rephrase is asked. Cost 0, no Domain Event,
answer «X сейчас нет рядом». Both the deterministic path and a model-proposed
plan run the SAME preflight, so the response kind, text, time and event count
agree across entry points; the rule-level `ActionBlocked(contact_unavailable)`
stays only as defense-in-depth when the contact vanishes after preflight.

Observer-safe filtering (T10): preflight (`resolveMovementTarget` via
`observerSafeConnectionMatches`) reuses the existing observer-scoped spatial
read model (`observedRouteEndpoints`), so a connection whose destination the
player has not observed is invisible to preflight and never appears in
ambiguity options; the authoritative movement Rule still reads the full
snapshot. A legacy world without a spatial model keeps its authored location
graph (there is no knowledge model to filter against).

### 3. Scene proximity is a state, not metres

Proximity is a per-scene state, not coordinates. Without adding a new Event
type, `ActionResolved` is extended additively with
`{ result: "approach", targetRef, locationId, engagement: "near" }`; older
runtimes ignore the extra fields (safe rollback).

Projection exposes an observer-scoped read view:

```text
interface SceneEngagement { targetRef; locationId; state: "near" | "engaged"; establishedAt }
playerSceneEngagement?: SceneEngagement
```

Set on `ActionResolved[approach]`; cleared on `PlayerLocationChanged`,
journey start, the target leaving the location, or a withdraw. Repeated
approach to the same target does not create a second state and answers
meaningfully. Proximity gates only proximity-dependent acts (close
inspection, handing over an item, whispering, physical interaction); ordinary
address, greeting and questions remain available to any visible person.

### 4. Location graph is primary; coordinates are compatibility

The location graph is the primary gameplay movement model for player-facing
proximity. Grid coordinates stay for legacy worlds and `physics.movement` and
may not be removed until a reader audit proves no live consumer. Audit
categories: `grid-only`, `location-only`, `compatibility`, `mixed`.

### 5. The LLM stays non-authoritative

The model recognizes intent and names; it never assigns cost, decides route
availability, movement outcome or proximity. Availability, importance and
consequences are classified on the backend (ADR-0037).

## Scope boundary

This decision does not define: the legacy grid math itself; the journey route
resolver; weather/river/heat processes; the AI Gateway referent algorithm;
narration wording; or whether grid coordinates are eventually deleted.

## Persistence and replay

No new Domain Event type and no table change. The `ActionResolved` extension is
additive, so old Event Logs replay unchanged and a rollback to the previous
runtime ignores the new fields. `scene engagement` is derived projection state,
rebuilt identically on replay. Existing worlds need no migration.

## Consequences

- Command cost becomes testable as data (`planCommandTime`), and the
  executor/handler duplication disappears.
- The T1 characterization assertions for journey start, traveling rejection
  and interrupt are updated when the policy lands.
- Rules stop re-deriving movement type from raw strings; a target is
  classified once.
- Approach to a present object becomes reachable through the typed classifier
  rather than being refused by preflight.

## Verification

Focused unit tests: `planCommandTime` cost table (all kinds), the
`resolveMovementTarget` classification matrix, single-owner outcome tests, and
engagement lifecycle (set/clear/replay/idempotent). Characterization tests in
`command-time-characterization.test.ts` pin the transition. The repository gate
remains `npm run validate`.
