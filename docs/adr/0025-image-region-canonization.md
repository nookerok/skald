# ADR-0025 — Image-backed region canonization and deterministic compilation

Status: Accepted  
Date: 2026-08-09

## Decision

The supplied region image is a design-time reference artifact only. It is
registered by an artifact manifest, interpreted into normalized visual
observations, separated into proposals/hypotheses, and accepted through an
author review. Only the reviewed compiler projection is authoritative input to
the deterministic Canon compiler.

The compiler writes a versioned `CompiledRegionBundle` containing the region
definition and bootstrap Event batch. Each bootstrap payload carries
`provenance.canonicalRefs`, `canonDigest`, `compilerInputDigest`, `regionVersion` and the projection compiler version. The bundle also carries structured region, content, discovery and simulation definitions plus an object-level provenance index. The first batch Event is `CanonGenesisRecorded`; runtime
reads the Event Log and generated bundle, never the image, proposal files or
LLM output.

The normal player map consumes only `ObserverMapDTO` evidence. Its terrain is a
vector `knownTerrain` projection clipped to observer-known bounds; hidden tiles,
rumored coordinates and the reference image are not serialized to the DTO.

The pilot projection is region version 4 and includes four reviewed runtime read models: hydrography (two accepted watercourses, one explicitly unresolved southern water body, one catchment and no wetlands), relative elevation bands/constraints, and a reviewed toponym index with aliases. Southern water remains classification-unresolved; coast, estuary, delta, tidal simulation, exact heights and deferred lake/wetland candidates are intentionally absent. Observer map watercourses and water bodies are emitted only when corresponding observation evidence exists.

## Consequences

- Replaying the Event Log remains the runtime source of truth.
- Canon changes are reviewable through stable input/bootstrap digests.
- Proposed resources, historical hypotheses and duplicate waterfall seeds stay
  non-runtime until a separate author review accepts them.
- The compiled JSON is a versioned source artifact, not a build directory; a
  stale bundle fails `canon:validate`.
- Existing historical worlds keep their Event Logs and are not retroactively
  re-canonized.

## Validation

`npm run canon:validate` validates the Canon Model, authoring bundle and exact
compiled output (`compile-region.mjs --check`). `npm run validate` additionally
runs typecheck, tests, simulation/evaluation and diff checks.
