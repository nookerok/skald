# ADR-0026: Resource nodes and deterministic processes

## Decision

Resource metadata remains descriptive until an author-reviewed resource definition is compiled. A runtime resource node has an integer capacity, current stock derived from Events, extraction methods and an optional regeneration law.

The first vertical slice is `resource.blackwood_timber`. `ResourceExtractionRequested` is a command-root event; the deterministic `resource.extraction` Rule emits `ResourceExtracted`. `TickPassed` drives `resource.regeneration`, which emits `ResourceRegenerated` using world time only.

Projection is discardable and rebuilt from the Event Log. The normal player DTO exposes only observed estimates; exact stock and regeneration parameters are diagnostics data.

## Boundaries

- Canon provides definitions, not mutable stock.
- Rules never use wall-clock time, randomness, LLM output or mutable globals.
- Commands are structurally validated before the root Event is created.
- Regeneration is capped by both node capacity and definition maximum.
- Proposal-only resource candidates are excluded from bundles.
