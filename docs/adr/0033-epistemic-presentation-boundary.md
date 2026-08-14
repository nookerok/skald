# ADR 0033: Epistemic Presentation Boundary and Social Emergence Freeze

Status: accepted

## Context

Skald already separates canonical World Truth, observer-scoped Knowledge and
read-side Narrative. The current Action Capability integration adds
TestimonyReceived and EpistemicEvidenceRecorded; the presentation layer must
carry that distinction into prose without creating a second belief engine.

Population, Culture, Society and Polity remain designed concepts only. The
settlement vertical slice's SettlementState.population is a local settlement
attribute and is not a Population simulation. The Simulation Bible may mention
Population as an example of a future Simulation System, but that mention is not
runtime scope.

The existing Relation primitive is sufficient for the current domain boundary:

    RelationEdge { from, to, kind, value }

It is storage/projection infrastructure, not a social domain model.

## Decision

1. Keep Social Emergence deferred. Do not add social entities, components,
   Events, Rules, Projections, APIs or Simulation Definitions.
2. Keep SettlementState.population unchanged.
3. Keep RelationEdge unchanged. A future social model requires a separate ADR
   based on a concrete vertical slice; no speculative Relation subsystem is
   introduced.
4. Add a server-side EpistemicClass to deterministic PresentationCandidate and
   PresentationEntry:
   established_fact, observed_fact, testimony, inference, interpretation.
5. Presentation templates assign the class. Selector grouping chooses the most
   cautious class and never promotes certainty during grouping, demotion o
   fallback.
6. Narrative Adapter receives structured text, class and source Event IDs. The
   LLM may rephrase only these facts and must preserve their modality. It cannot
   create Events, change Projection or promote testimony/belief into World Truth.
7. Normal UI receives the resulting prose and existing Belief/Observation
   read models; raw epistemic labels are not a second browser-side truth source.

## Epistemic flow

    World Truth / Event Log
            ↓
    Observation and Evidence
            ↓
    Belief / Knowledge read model
            ↓
    Deterministic Presentation + EpistemicClass
            ↓
    Narrative Adapter (read-only)
            ↓
    Player prose

Testimony is not truth. Belief is not truth. Interpretation is not truth.

## Consequences

A false NPC report can remain testimony until a direct observation records
contradictory evidence. Replay remains authoritative because this ADR adds no
Domain Event or mutable state. Social Emergence stays available as a future
design track without competing with the playable interaction loop.

## Verification

Tests cover testimony versus direct observation, explicit fallback class,
class preservation through grouping/demotion, structured Narrative payloads,
modal-preservation prompt constraints and the existing belief-boundary tests.
The repository gate remains npm run validate.
