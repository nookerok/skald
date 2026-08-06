# ADR 0023 — Risk and Exposure Model

Status: accepted

Date: 2026-08-06

## Context

The Rule Graph and the 10 vertical scenarios give a stable experimental
diagnosis: the `risk → audacity → fire` chain is unreachable. `risk_taken`
grows only from `MovementSucceeded` (rule `observations.risk_taker`), and grid
movement is blocked in the location-based worlds SKALD actually runs. The
diagnosis did not change when the scenario library grew from 3 to 10 — this is
an architectural property of the current world, not a missing test.

The deeper issue is semantic, not mechanical. Risk is defined today as a
single global observation counter (`risk_taken`) with exactly one source
(successful grid movement) and exactly one consumer (the audacity consequence
that feeds the forest-fire situation). In a living world risk is broader, and
the current definition is the first specialized channel of a wider Exposure
model — a channel that the current worlds cannot reach.

## The semantics of risk in SKALD

These definitions are normative for the model; the current code is a
single-channel instance of them.

1. **What is risk?** Risk is an observer-visible measure of the player's
   exposure to consequential outcomes. It is the world's memory of risky
   behaviour — an `ObservationUpdated` key, never a player stat (AGENTS
   forbids XP/LevelSystem; observations are the world's reaction memory, which
   is constitutional).
2. **What increases risk?** Conceptually: exploring ruins, camping in the open,
   lighting a fire, crossing a river, helping a stranger, approaching an
   anomaly, environmental exposure (fire, flood) and staying out at night.
   Today: only `MovementSucceeded`.
3. **What decreases risk?** Conceptually: retreating to a safe place, resting,
   gaining caution/knowledge. Today: nothing — `risk_taken` is monotonic
   cumulative.
4. **Local, global or contextual?** Conceptually contextual: location (ruins vs
   a waystation), action, environment (dry forest), and time (night) all
   modulate it. Today: one global per-world counter.
5. **Who creates risk?** Conceptually the player, the environment, and time;
   NPCs in the future. Today: the player only.
6. **What does risk feed?** Conceptually consequences, situations (not only
   fire), discovery (risk produces clues), observer threads and narrative.
   Today: only `audacity → fire`.

`fire` is therefore one *consumer* of a more general `Exposure` model, not the
definition of risk.

## Alternatives

1. **Keep the current chain and revive grid movement** so `MovementSucceeded`
   fires again. Rejected: it re-couples risk to one deprecated movement path
   and contradicts the semantics above; a global counter fed by one action is
   not a risk model.
2. **Redesign risk as a general Exposure model now** (many sources, sinks,
   contextual scope, several consumers). Rejected for this commit: it is a
   large vertical slice (new rules, likely new events, read-model decisions)
   that should come after the measurement phase and be driven by the
   Simulation Bible — it needs its own slice ADR following the ADR-0007
   adoption boundary.
3. **Defer the risk → fire domain honestly.** Accepted as the immediate
   decision: mark the audacity/fire processes as Deferred in the Simulation
   Bible, stop treating them as `dead` defects, and record the Exposure
   redesign as the planned path.

## Decision

- Adopt the **Exposure semantic model** above as the definition of risk.
  `risk_taken` is the **first specialized Exposure channel**, implemented to
  verify the consequence mechanic; the full Exposure model will consist of
  several independent sources and consumers.
- **Defer the `risk → audacity → fire` chain** as a future domain: processes
  P09 (consequences/audacity) and P10 (situations/forest fire) in
  `docs/simulation/LIVING_PROCESSES.md` are marked `Deferred` per this ADR.
  The chain is not "broken"; it is postponed and no longer counted as a defect.
- **No code changes in this commit.** The Rule Graph enhancement to classify
  rules by their process status — `deferred` (expected absence) vs `future`
  (experimental domain) vs `dead` (a real error) — is recorded as a consequence
  to implement with the next domain work.
- **Future path:** when the other living processes are live, implement
  Exposure as a vertical slice — contextual sources and sinks, who/what creates
  exposure, and consumers (consequences, situations, discovery, narrative) —
  with its own ADR, explicit Event/ReadonlyWorld mapping, deterministic tests
  and an Observation/Belief DTO decision, per the ADR-0007 adoption boundary.

## Consequences

Positive: the dashboard stops flagging a deliberately-deferred domain as a
defect; the risk concept is documented so it cannot be misread as a stat or a
movement-only feature; the direction for the future Exposure slice is fixed.
The 10-scenario evidence ("Dead/Dormant unchanged as scenarios grew") is now
interpreted correctly as an architectural decision point, not a test gap.

Negative: fire remains absent from play for now; the unfired audacity/fire
rules keep appearing in the Rule Graph until the `deferred` classification
exists.

## Operational gates

- `docs/simulation/LIVING_PROCESSES.md` statuses are the source of truth for
  which processes are Deferred, pending the Rule Graph `deferred` enhancement.
- Any future Exposure slice must add an ADR, map Events/ReadonlyWorld
  explicitly, ship deterministic tests, and state the Observation/Belief DTO
  decision before any rule is added.
