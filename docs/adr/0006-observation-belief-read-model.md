# ADR 0006 — Observation & Belief Read Model

## Context

The new visual contract presents the world through the observer's incomplete
knowledge. The normal player renderer must not consume a second authoritative
world model, raw truth fields, or an unfiltered Event Log. Existing discovery cards are not
enough to explain confidence, freshness, evidence, hypotheses and
contradictions.

## Decision

Add a deterministic Observation & Belief read model under
packages/world/src/observation/.

buildBeliefModel(events, world, observerId):

- consumes only the canonical Event Log and ReadonlyWorld;
- emits no Domain Events and writes no Projection or SQLite state;
- translates recorded observations into Evidence, ObservationRecord,
  PatternBelief, Hypothesis, RelationObservation and Contradiction DTOs;
- applies freshness decay from simulation time;
- keeps contradictions in the result until the source evidence disappears from
  the Event Log (which cannot happen under append-only persistence);
- exposes serializeBeliefModel() at the HTTP boundary because a JavaScript
  Map is not JSON-safe.

The browser receives BeliefModelDTO in the Game Shell and through
GET /api/worlds/:worldId/beliefs (with the legacy /api/beliefs mapping).
The Knowledge panel renders only that DTO. It does not infer confidence,
freshness, hypotheses, relations or contradictions.

## Scope

This is a read-side vertical slice. It does not add Observation domain events,
new Rules, persistence tables, LLM calls, or free-text action controls.
ObservationAPI is a pure query adapter for the derived model: observe,
relations, history, existence explanation and causal trace.

## Consequences

- New model code is replayable and projection-pure.
- Evidence is intentionally incomplete and time-decaying; absence is not proof.
- Predictions are represented by the contract but remain empty until a
  deterministic prediction source exists.
- Existing DiscoveryJournal and KnowledgeSummary remain available for backward
  compatibility, diagnostics and legacy read views while the normal browser
  Knowledge tab uses the belief DTO. They must not become a parallel source
  for belief rendering.

