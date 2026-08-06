# Simulation Bible — Living Processes Catalog

Status: draft (bridging document)

The Simulation Bible answers one question: **which living processes must exist
for the world to count as alive?** This catalog is the bridge between three
layers:

- the System Definitions (`docs/simulation/definitions/*.yaml`, per
  `docs/SIMULATION_BIBLE_ARCHITECTURE.md`);
- the Rule Graph and its dead/dormant/rare/common/critical classification
  (`npm run eval:living`, `eval-out/rule-graph.json`);
- the Evaluation Framework metrics (`Livingness`, `Emergence`, `Diversity`,
  `Rule Reachability`, `Knowledge Growth`, `Average Chain Depth`).

A process has exactly one of three **statuses**:

- `Live` — part of the current world model and must work (verified by the Rule
  Graph: rules fire, events occur in a probe);
- `Deferred` — recognized as necessary but consciously postponed (per
  ADR-0023); its inactivity is expected, not a defect;
- `Future` — a perspective idea without an architectural commitment (needs an
  ADR + Events/Rules before it can be claimed).

Status is verified by the Rule Graph, never asserted in prose. In the future
the Rule Graph will classify unfired rules by their process status:
`dead` (a real error), `deferred` (expected absence), `future` (experimental
domain).

## How a world is "alive"

A world is alive when its processes *interact*: the output of one process
becomes the input of another, producing causal chains longer than a single
rule hop. The metrics to watch:

| Metric | What it means for aliveness |
|---|---|
| Livingness | composite of diversity, emergence, knowledge growth, rule reachability |
| Emergence | share of causal chains crossing >=3 distinct event types |
| Average Chain Depth | how far one cause propagates before terminating |
| Rule Reachability | fraction of registered rules that actually fire |
| Dead Rules | rules whose trigger event type never occurs |
| Knowledge Growth | observer belief count before vs after a long probe |

## Process catalog

| # | Process | Status | Trigger events | Participating rules | Feeds |
|---|---|---|---|---|---|
| P01 | Weather cycle | Live | TickPassed | weather.tick | river (planned), visibility (planned) |
| P02 | River hydrology | Live | TickPassed | hydrology.river_level | crossing |
| P03 | Crossing conditions | Live | RiverLevelChanged | hydrology.crossing_condition | travel (planned) |
| P04 | Settlement dynamics | Live | TickPassed | settlement.pattern | economy (planned) |
| P05 | Heat law (grid) | Live | TickPassed | heat.spread | hazard (planned) |
| P06 | Heat transfer (zonal) | Deferred | TickPassed | heat.transfer | — (starts at equilibrium, never emits) |
| P07 | Relations | Live | give intent | relations.give | economy (planned), narrative |
| P08 | Observation & belief | Live | examine intent | perception.observe, examinedCuriosity | memory, knowledge growth |
| P09 | Consequences (audacity) | Deferred | ObservationUpdated(risk_taken) | consequences.repercussion/expire/fire | world reaction (planned) |
| P10 | Situations (forest fire) | Deferred | ConsequenceFired -> fear threshold | situations.start/spread/end | ecology (planned) |
| P11 | Movement & exploration | Deferred | move intent | physics.movement, observations.risk_taker | — (grid move blocked in location worlds) |
| P12 | Journeys | Deferred | JourneyRequested | journey.start/validate | travel, economy |
| P13 | Economy / trade | Future | — | — | relations, settlement |
| P14 | Migration | Future | — | — | ecology, settlement |
| P15 | Information spread | Future | — | — | knowledge, belief |
| P16 | Memory | Live | read models only | observer-threads, belief | knowledge |
| P17 | Day / night | Future | — | — | weather, visibility |
| P18 | Fog / visibility | Live | read-side engine only | visibility (no rules) | exploration, map |

## Per-process detail

### P01 Weather cycle — Live
- Purpose: the world has atmospheric state that changes without the player.
- Triggers: TickPassed → `WeatherStateChanged`.
- Rules: `weather.tick`.
- Feeds: planned river water-inflow, planned visibility.
- Metrics: Diversity (WeatherStateChanged is a meaningful type); Idle (weather
  events are sparse). A long probe must see sky/precipitation/wind change.

### P02 River hydrology — Live
- Purpose: a deterministic watercourse that rises and falls on a cycle.
- Triggers: TickPassed → `RiverLevelChanged`.
- Rules: `hydrology.river_level`.
- Feeds: crossing conditions (P03).
- Metrics: Emergence (river → crossing is a 2-hop chain); Average Chain Depth.

### P03 Crossing conditions — Live
- Purpose: a ford changes passability as the river rises.
- Triggers: `RiverLevelChanged` → `CrossingConditionChanged`.
- Rules: `hydrology.crossing_condition`.
- Feeds: planned travel/passability.
- Metrics: Emergence; a flood scenario must reach `difficult`/`closed`.

### P04 Settlement dynamics — Live
- Purpose: a settlement's population/risk drift on a TickDriven law.
- Triggers: TickPassed → `SettlementStateChanged`.
- Rules: `settlement.pattern`.
- Feeds: planned economy.
- Metrics: Diversity; Knowledge Growth (settlement changes enter the observer's
  world). A long probe must produce many `SettlementStateChanged`.

### P05 Heat law (grid) — Live
- Purpose: heat sources radiate into neighbouring cells (legacy grid).
- Triggers: TickPassed → `HeatRadiated`.
- Rules: `heat.spread`.
- Feeds: planned hazards.
- Metrics: Idle Simulation (HeatRadiated is churn); heatMap growth in state.

### P06 Heat transfer (zonal) — Deferred
- Purpose: zonal thermal equilibrium (PR-7.1).
- Rules: `heat.transfer`.
- Status reason: the initial thermal state equals ambient, so the rule
  honestly emits nothing. Live only when a prior non-equilibrium state exists.

### P07 Relations — Live
- Purpose: giving changes the social fabric.
- Triggers: give intent → `RelationChanged`.
- Rules: `relations.give`.
- Feeds: narrative, planned economy.
- Metrics: rule reachability; presentation honesty (humanized relation labels).

### P08 Observation & belief — Live
- Purpose: examining builds curiosity observations and belief.
- Triggers: examine intent → `EntityExamined` → `ObservationUpdated` (curiosity).
- Rules: `perception.observe`, `examinedCuriosity`, belief read model.
- Feeds: memory, knowledge growth.
- Metrics: Knowledge Growth; Information Honesty (belief DTO never leaks truth).

### P09 Consequences (audacity) — Deferred (ADR-0023)

- Purpose: accumulated risk creates a consequence that fires later.
- Status reason: `risk_taken` grows only from `MovementSucceeded`, and grid
  movement is blocked in location-based worlds — the chain is unreachable
  today. Per ADR-0023 the risk→fire domain is consciously deferred, not a
  defect: risk is redefined as a general Exposure model whose current v1
  channel (movement-only) is a documented approximation.

### P10 Situations (forest fire) — Deferred (ADR-0023)

- Purpose: the world reacts to the player with a long-lived process.
- Status reason: requires the audacity chain (P09), which is deferred.
  Observer threads already read fire events whenever they occur; the process
  itself is postponed as a future domain.

### P11 Movement & exploration — Deferred
- Purpose: the player moves through the world and learns about it.
- Status reason: grid movement fires only in the legacy grid path; in
  location-based worlds a move attempt is honestly blocked (`ActionBlocked`).

### P12–P15, P17 (Journeys, Economy, Migration, Information, Day/night) — Future
No runtime. Adding any of these requires its own ADR with an explicit
Event/ReadonlyWorld mapping, deterministic tests and a decision about the
Observation/Belief DTO, following ADR-0007's adoption boundary.

### P16 Memory — Live
Observer threads, belief revisions and presence checkpoints exist as read
models; they are honest views over events, not autonomous processes.

### P18 Fog / visibility — Live
The visibility engine is a pure read-side service (ADR-0016), not a
simulation process; it has no Rules and no Domain Events.

## How the catalog is used

1. **Author a vertical scenario** for one or more Live processes, tag it with
   the process ids (P01..P18) and add it to `packages/cli/eval-scenarios/`.
   The eval framework runs it automatically.
2. **Read the Rule Graph** after the run: an unfired rule reveals whether its
   process is `Live` (a real defect or a missing scenario), `Deferred`
   (expected absence), or `Future` (experimental). Deferred/Future inactivity
   is not a bug.
3. **Watch the metrics** per commit (`npm run eval:living`,
   `npm run eval:compare`): a world becomes alive when Livingness, Emergence and
   Average Chain Depth rise because *processes interact*, not because events
   are artificially injected.
4. **Revive or remove** a dead rule only after the scenario evidence says which
   of the three cases it is: rule unnecessary (remove), world never creates the
   condition (fix the source), or a missing intermediate link (add the link).
