# ADR 0021 — Canon Model (World Bible architecture) as design-time authority

Status: accepted

Date: 2026-08-04

## Context

SKALD has a strict runtime constitution (Event Log authority, Projection
Purity, deterministic Rules, observer-scoped knowledge), but no governed
system for design-time world knowledge. That knowledge is scattered across
`docs/worldbuilding/` (a governed design layer, ADR-0007), region documents
(ADR-0012/0014) and ADR prose. There is no canon lifecycle, no fact statuses,
no runtime mapping, no protection against encyclopedic growth, and no
verifiable link between world facts and the Rules/Events that embody them.

An architectural interview (Blocks 0–7, 2026-08-04) produced a complete
specification: `docs/WORLD_BIBLE_ARCHITECTURE.md`. Its core moves:

- Canon Model is the single design-time authority; World Bible is one of its
  read models (A−1), never the Canon itself.
- The only path from Canon to a world is deterministic compilation into
  bootstrap Domain Events (A0, A−5, A−6). Runtime never reads Canon; Canon
  never rewrites the past of existing worlds (retrocannon only via Migration
  ADR: new worlds or compensating events; full rebuild forbidden).
- A fact exists only if it has consequences (A−2, master filter: "why does
  the world become worse without this fact?").
- Simulation Depth is a runtime commitment, not a tag (A−19); Not Simulated
  is first-class knowledge (A−21).

## Alternatives

1. Keep world knowledge as prose documents (status quo). Rejected: no
   lifecycle, no traceability, inevitable encyclopedia drift; links between
   facts and runtime rot silently.
2. Treat the World Bible document as the Canon itself (document-centric).
   Rejected: representation is not Canon; contradicts A−1 and the Projection
   Purity analogy (A−3).
3. Build full knowledge-graph tooling and `packages/canon/` immediately.
   Rejected: A−27 (tooling follows Canon maturity); the package appears only
   when the contract becomes shared infrastructure, as with
   `@skald/observation`.
4. Runtime-readable canon database. Rejected: violates A0 and Projection
   Purity; creates a second runtime truth.

## Decision

1. The Canon Model specification `docs/WORLD_BIBLE_ARCHITECTURE.md` is
   accepted, including the axiom registry A−1…A−27, the record types
   (Concept, Fact, CanonicalAnchor, NotSimulatedClaim; NarrativeAsset outside
   the model), the three-axis classification (Scope × Domain × Temporal),
   the lifecycle (Experimental → Proposed → Canon → Deprecated → Archived),
   the depth-differentiated Promotion Gate and the SemVer + Genesis Digest
   versioning.
2. Physical form: YAML data in `docs/canon/` (one file per Concept), JSON
   Schemas in `docs/canon/schema/`, dependency-free tooling in
   `scripts/canon/`. `packages/canon/` is created only through a separate ADR
   when at least one sharing criterion is met (schema consumed by
   runtime/compiler, validator needed by multiple packages, projection part
   of CI).
3. Relationship to `docs/worldbuilding/`: it remains the accepted
   principles-and-checklists layer (ADR-0007, unchanged). Canon Model is the
   operational canon. Promotion path: a worldbuilding principle becomes a
   Proposed fact candidate with provenance (`InterviewDecision` /
   `ImportedFromCode`) and passes the normal Review Gate. ADR-0007 is not
   superseded; it governs the lower layer.
4. Pilot region retro-import (A−25): existing bootstrap facts (ADR-0012,
   ADR-0014) are recorded in `docs/canon/regions/pilot-region/` with
   `provenance: ImportedFromCode` and pass the Review Gate per Concept. Code
   is respected as a historical source and never equals Canon. Pre-Canon
   worlds are historical objects (A−24); Genesis Digest minting waits for the
   first real compilation from Canon Model.
5. Tooling: `npm run canon:validate` (schema, references, statuses,
   acyclicity, anchors, depth constraints) joins `scripts/validate.sh`;
   `npm run canon:generate-wb` generates the human-readable projection
   `docs/WORLD_BIBLE.md`, which is never hand-edited and is git-ignored as
   generated output.
6. No runtime Events, Rules, Projection fields, persistence tables or UI are
   added by this decision. Region compiler, digest registry, concept graph UI
   and emergence detector stay in the Not Built registry
   (`docs/canon/deferred/tooling.yaml`) with explicit triggers (A−27).

## Consequences

- New world facts must carry consequences, provenance and temporal scope;
  deep facts additionally require Runtime Mapping or a registered
  `plannedRuntime` before Canon status.
- The repository validation gate now fails on Canon Model violations
  (dangling references, lifecycle violations, cycles, depth without
  mapping).
- AGENTS.md, PROJECT_MAP.md and DECISIONS.md index the Canon Model as a
  source of truth for design-time world knowledge.
- A future `packages/canon/` ADR must replace the transitional mini-YAML
  parser in `scripts/canon/lib/` with the shared contract implementation.
- Canon changes that alter bootstrap, Universal Laws or Anchors are MAJOR
  Canon versions and require a Migration ADR before touching living worlds.
