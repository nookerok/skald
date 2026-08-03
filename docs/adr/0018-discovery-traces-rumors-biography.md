# ADR 0018: Discovery — Traces, Rumors, Monolith & Biography

Status: accepted

## Context

The existing discovery system (`packages/world/src/discovery/`) provides a
`DiscoveryJournal` with `DiscoveryCard` instances at stages `trace →
hypothesis → discovered`. Three definitions exist: `risk_draws_attention`,
`heat_changes_material`, `sound_draws_attention`. Evidence is collected from
Domain Events and classified by static definitions.

However:
- Evidence types are limited to `trace | omen | echo`.
- No spatial traces (water, movement, structural).
- No rumor system.
- No monolith sighting progression.
- No biography chains linking discoveries to player history.
- The builder collects from events but does not filter by observer scope.

The Spatial Movement (ADR-0015), Visibility (ADR-0016) and River Hydrology
(ADR-0017) systems add new observable facts that should generate discovery
evidence: river level changes, crossing condition changes, travel observations,
landmark sightings.

## Decision

Extend the discovery system with spatial evidence types, observer-scoped
collection, hypothesis classification, rumor tracking and biography chains.

### 1. Extended evidence kinds

Add spatial trace types:
- `physical_trace` — visible marks, tracks, damage
- `water_trace` — water level marks, wet stones, current sounds
- `movement_trace` — travel evidence, paths
- `landmark_trace` — distant silhouette, bearing observation
- `structural_trace` — building condition, material changes

Preserve existing: `trace | omen | echo`.

### 2. Observer-scoped evidence

Evidence is only collected from events the observer could plausibly witness:
- Events at the observer's current location.
- Events the observer has directly observed (via visibility).
- Offline events (`playerOffline`) do not generate evidence.

### 3. Hypothesis classification

Evidence independence rules:
- Different `worldTime` → independent.
- Different location → independent.
- Different source event type → independent.
- Same event chain (causationId) → not independent.

Thresholds per definition:
- `trace`: 1 evidence
- `hypothesis`: 2+ independent evidence
- `discovered`: hypothesis + direct confirmation event

### 4. Rumors

Rumors are separate knowledge objects:
- `unverified` — hearsay without confirmation
- `supported` — corroborated by observation
- `contradicted` — contradicted by observation
- `faded` — lost freshness

Rumors never automatically become facts.

### 5. Biography chains

Causal chains linking player actions to discoveries:
- Steps: action → observation → trace → hypothesis → confirmation
- Built from `causationId`/`correlationId` + worldTime
- LLM may name chains but not add steps

### 6. No new Domain Events

Discovery is a read model. No `DiscoveryUnlocked`, `HypothesisCreated`, etc.
Existing events (`SpatialObservationRecorded`, `RiverLevelChanged`,
`CrossingConditionChanged`, `EntityExamined`, `SoundObserved`) become evidence
through the collector pipeline.

### 7. Monolith progression

Glimpsed → observed → re-observed:
- Glimpsed: bearing + distance, no coordinates
- Observed: direct line-of-sight from elevated position
- Re-observed: second observation from different position

Never reveals: origin, purpose, exact coordinates when glimpsed.

## Consequences

- **Extended types**: `DiscoveryEvidenceKind`, `RumorRecord`,
  `BiographyDiscoveryChain`, `BiographyDiscoveryStep`.
- **New definitions**: `river_cycle`, `monolith_sighting`,
  `crossing_condition_change`, `travel_observations`.
- **Builder pipeline**: observer scope filter → evidence normalization →
  definition matching → classification → biography chain construction.
- **Tests**: evidence independence, hypothesis thresholds, rumor lifecycle,
  biography chain determinism, observer scope filtering.

## Definition of Done

Player notices water trace at crossing → forms hypothesis from repeated
observations → sights monolith from valley → re-observes from ridge →
forms discovery → receives biography chain. Rumors remain unverified without
confirmation. Offline events do not create evidence. Replay produces
identical results.
