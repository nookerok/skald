# Canon Model (docs/canon/)

Design-time authority for world knowledge (ADR-0021). This directory holds the
Canon Model as data; the human-readable World Bible is a generated projection
(`npm run canon:generate-wb`, output `docs/WORLD_BIBLE.md`, git-ignored, never
hand-edited). Runtime never reads this directory: the only path into a world is
deterministic compilation into bootstrap Domain Events (A0, A-5).

## Layout

- `universal/` — Universal Canon (scope `Universal`), grouped by domain.
- `regions/` — Regional Canon, one directory per region.
- `anchors/` — Canonical Anchor registry (the only named instances in Canon).
- `not-simulated/` — claims about the boundaries of simulation (A-21).
- `deferred/` — Not Built tooling registry with triggers (A-27).
- `schema/` — JSON Schemas for all record types.

## Authoring rules (short)

1. One file per Concept; a Fact is an atom inside its Concept file.
2. Every Fact requires `consequences` (A-2) and `provenance`; a Fact without
   consequences does not exist.
3. `Fact.lifecycle` must never exceed `Concept.lifecycle` (A-10).
4. `Simulated`/`CoreSimulation` Concepts require `runtimeMapping` or a
   `plannedRuntime` ADR reference (A-19).
5. Relations use typed edges only (`grounds`, `causes`, `locatedIn`,
   `contains`, `exemplifies`, `predates`, `dependsOn`, `contradicts`) and the
   Concept Graph must stay acyclic (A-8).
6. Proposed/Experimental may be edited freely; anything that entered a Genesis
   Digest changes only via `supersedes` or `deprecatedReason` (A-16).
7. YAML subset: 2-space indents, block lists, one-line scalars, no inline
   comments (see `scripts/canon/lib/mini-yaml.mjs`).

## Commands

- `npm run canon:validate` — linter (part of `npm run validate`).
- `npm run canon:generate-wb` — regenerate the World Bible projection.

Full lifecycle, gates and versioning: `docs/WORLD_BIBLE_ARCHITECTURE.md`.
