# SKALD Observation & Belief Model

Status: **normative UI contract, v2.0**

This document is the source of truth for what the normal player UI may read
and how it represents incomplete knowledge. The executable TypeScript contract
lives in `packages/observation/src/types.ts`; runtime validation and JSON Schema
live beside it. The current `packages/world/src/observation/builder.ts` is a
compatibility adapter and is not the contract owner.

## Product boundary

The UI does not receive the authoritative World, an unfiltered Event Log, or
"truth" fields. The normal player renderer receives a `BeliefModelDTO` and
current `ObservationRecord` data produced by the Observation Engine. It may
render those records, but it must not infer facts, confidence, importance,
causality, actions, or outcomes in the browser.

The Event Log remains the sole simulation authority. Projection remains the
sole canonical simulation read model. Observation & Belief is a deterministic,
observer-scoped read model over those sources; it is not a second authority.
The existing Game Shell may retain compatibility read views for world context,
character, attention, and presentation, but its Knowledge surface is governed
exclusively by this contract.

## Normative vocabulary

| Term | Meaning |
|---|---|
| `Evidence` | An observed, typed and time-stamped reason supporting a belief. |
| `ObservationRecord` | One observer-scoped result of the Observation Engine for a target and lens. |
| `Hypothesis` | A provisional interpretation supported or contradicted by evidence. |
| `PatternBelief` | The current interpretation of one observed pattern plus evidence and open hypotheses. |
| `BeliefModel` | The complete observer-scoped collection of beliefs, hypotheses, relations and contradictions. |
| `Lens` | The allowed perspective: terrain, ecology, relations, emergence, history or prediction. |
| `Freshness` | A deterministic confidence-like value that decays when no new evidence arrives. |
| `Contradiction` | Persistent evidence that conflicts with an active interpretation. |
| `ObserverId` | The identity whose perception and knowledge scope are being rendered. |

Canonical enums are defined in `observation/types.ts`: `EvidenceType`,
`ObservationSource`, `HypothesisStatus`, `RelationType`, `Trend` and
`EmergenceStage`. New UI code must reuse those types rather than introducing
parallel labels.

## Data contract

`BeliefModel` contains:

- `schemaVersion: 2`;
- `observerId` and `lastUpdated` in simulation time;
- `beliefs: Map<PatternId, PatternBelief>` internally, serialized as an array
  of `PatternBelief` objects in HTTP `BeliefModelDTO`;
- `activeHypotheses` with supporting and contradicting evidence IDs;
- `knownRelations` with observed strength, trend, confidence and evidence IDs;
- `contradictions`, which remain visible and are never silently removed.

Every `PatternBelief` contains a player-readable display name and interpretation, confidence,
supporting evidence, open hypotheses, optional existence explanation, the
last observed simulation time and deterministic freshness. Every `ObservationRecord` contains observer,
target, lens, observation time, confidence, freshness, source, evidence,
hypothesis IDs and a lens-specific payload. Payloads contain only observed or
inferred presentation values; they never contain `actual*`, `true*` or `real*`
fields.

The exact JSON boundary is:

```ts
interface BeliefModelDTO {
  schemaVersion: 2;
  observerId: string;
  beliefs: PatternBelief[];
  activeHypotheses: Hypothesis[];
  knownRelations: RelationObservation[];
  contradictions: Contradiction[];
  lastUpdated: number;
}
```

## Observation API

The pure `ObservationAPI` exposes these read operations:

- `observe(targetId, observerId, lens, context?)`;
- `queryRelations(patternId, observerId, filters?)`;
- `queryHistory(patternId, observerId, timeRange?)`;
- `listObservable(observerId, lens?)`;
- `explainExistence(patternId, observerId)`;
- `trace(rootId, observerId, maxDepth?)`.

The current runtime supports only the `player` observer identity; every other identity fails closed with an empty model.
An observer that is outside the supported perception scope receives no record,
relation or trace. The API must not widen scope merely because an event exists
in the canonical log.

## Hard invariants

1. No `actual*`, `true*` or `real*` fields may appear in an observation payload
   or player-facing DTO.
2. The Observation Engine runs before any observation data is returned.
3. Lens/read-model code consumes `ObservationRecord` or `BeliefModel` data, not
   mutable simulation state.
4. The normal renderer reads only `BeliefModelDTO` and current observation
   records. It never reads raw Event IDs, payloads, Rules or Projection maps.
5. Confidence and freshness decay deterministically with simulation time when
   no new observation arrives; old evidence is retained.
6. Contradictions are append-only read-side facts: they remain visible until
   the underlying append-only evidence is no longer in the log (which is not a
   normal operation).
7. Observation code emits no Domain Events, does not write Projection or
   SQLite, and never calls an LLM or network service.
8. Narrative/LLM may rephrase selected belief text only. It cannot create
   evidence, choose facts, classify confidence, resolve contradictions, choose
   actions or alter the model.

## Renderer rules

The Knowledge surface must make uncertainty legible:

- show interpretation, confidence and freshness together;
- make supporting evidence expandable and time-stamped;
- expose "why this is believed" from `ExistenceExplanation` when available;
- keep contradictions visible rather than replacing them with a single answer;
- distinguish an empty model from an unavailable/stale transport state;
- never render raw event names, JSON, internal IDs or hidden world state in the
  normal player surface;
- keep the command composer free-text. A belief card may suggest a question in
  prose, but it must not become a preselected action button.

Developer Diagnostics is a separate trusted-LAN surface. It may show raw
events and traces only after explicit user opening and must never be used as
the data source for the normal Knowledge renderer.

## HTTP and compatibility

The canonical endpoint is `GET /api/worlds/:worldId/beliefs`; the legacy
`GET /api/beliefs` route maps to `legacy-world`. Responses contain
`{ ok: true, beliefModel: BeliefModelDTO }`. `POST` is not a read operation and
returns `405`.

`packages/cli/public/belief-view.js` is a pure DOM renderer for this DTO.
The contract package also exports zod parsers and generated JSON Schemas for
server and client boundary tests. It
must remain free of domain classification, event interpretation, network
authority and action selection. Any contract change requires a schema version
and an ADR update before changing the UI.

## Verification obligations

Changes to this contract or its renderer require:

- pure tests for builder replay, observer scope, freshness, contradictions,
  immutability and forbidden-field absence;
- HTTP tests for DTO shape and method rejection;
- `npm run validate` and `git diff --check`;
- a real browser run through the fixed NTFS QA task, recorded separately from
  API/unit-test results.
