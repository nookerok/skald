# ADR-0025 — Image-backed region canonization and deterministic compilation

Status: Accepted  
Date: 2026-08-09

## Decision

The supplied region image has two deliberately separate paths. It is a
design-time reference artifact for authoring and Canon review, and it may also
be copied into the browser bundle as a visible presentation asset for the
player map. The browser path is explicitly non-authoritative: it never creates
facts, labels, routes, visibility or events. The image is registered by an
artifact manifest, interpreted into normalized visual observations, separated
into proposals/hypotheses, and accepted through author review. Only the
reviewed compiler projection is authoritative input to the deterministic Canon
compiler.

The compiler writes a versioned CompiledRegionBundle containing the region definition and bootstrap Event batch. Each bootstrap payload carries provenance references, digests, regionVersion and the projection compiler version. The bundle also carries structured region, content, discovery and simulation definitions plus an object-level provenance index. The first batch Event is CanonGenesisRecorded. The simulation backend reads the Event Log and generated bundle, never image pixels, proposal files or LLM output. The browser may load a separately copied presentation asset from packages/cli/public/assets/maps/ through a versioned static manifest. That asset is non-authoritative artwork: it carries no baked labels, coordinates, visibility state or new world facts and is never imported by Canon, the compiler, Projection or ObserverMapDTO.

The normal player map consumes ObserverMapDTO evidence for facts. A presentation layer may place the overview artwork beneath a deterministic fog mask and show five derived detail crops. Terrain, labels, routes and visibility remain DTO-driven; hidden coordinates and rumored geometry are never serialized to the DTO or inferred from artwork.

The pilot projection is region version 4 and includes four reviewed runtime read models: hydrography (two accepted watercourses, one explicitly unresolved southern water body, one catchment and no wetlands), relative elevation bands/constraints, and a reviewed toponym index with aliases. Southern water remains classification-unresolved; coast, estuary, delta, tidal simulation, exact heights and deferred lake/wetland candidates are intentionally absent. Observer map watercourses and water bodies are emitted only when corresponding observation evidence exists.

## Consequences

- Replaying the Event Log remains the simulation runtime source of truth.
- Presentation artwork can be cached, replaced or removed without changing a world, replay, or Canon digest; only the browser visual layer changes.
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
