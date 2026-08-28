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

The trusted diagnostics surface receives BeliefModelDTO through
GET /api/worlds/:worldId/beliefs (with the legacy /api/beliefs mapping). The
normal Game Shell, Presence and command responses receive the separate frozen
PlayerKnowledgePresentation. The Knowledge panel does not infer confidence,
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
  Knowledge tab uses the player knowledge DTO. They must not become a parallel source
  for belief rendering.

## Player-facing knowledge boundary (Stage 7)

The internal `BeliefModelDTO` is not a normal player UI contract. The Game
Shell, Presence and command read responses consume the frozen
`PlayerKnowledgePresentation` adapter instead. It exposes only category,
plain-language text, origin, status and simulation time; provenance IDs,
confidence, pattern keys and raw propositions remain backend/diagnostics data.
The adapter is pure and observer-scoped, so this decision adds no Events,
Rules, Projection fields or persistence state.

The player-facing `/discoveries` route follows the same boundary through a
frozen `PlayerDiscoveryJournal` serializer. It retains only localized card and
evidence prose, stage/status and simulation time; raw discovery/subject/journal
references, source event ids, observer ids and confidence/freshness are kept in
the internal journal only. Rumors are admitted only for `observerId: "player"`.
