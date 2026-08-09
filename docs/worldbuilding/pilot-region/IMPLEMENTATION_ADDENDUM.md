# Pilot Region Canonicalization — implementation addendum

Date: 2026-08-09

The reference image is now represented by
`docs/worldbuilding/pilot-region/region-interpretation.json`. This is the
Region Interpretation Layer, not a texture, map payload or runtime input.

It contains:

- terrain zones and normalized visual bounds;
- hydrology evidence, including the western waterfalls;
- biome/resource candidates explicitly marked as proposals;
- mappings to the existing canonical locations and landmarks;
- toponym meaning proposals;
- observer-safe discovery nodes and gameplay hooks;
- deterministic seed records, including the already-compiled southern borough
  and initial observations;
- historical hypotheses with confidence and `notCanonTruth: true`.

The design-time Canon entry is
`docs/canon/regions/pilot-region/visual-interpretation.yaml`. Runtime remains
authoritative through `packages/world/src/region/definition.ts` and the
deterministic bootstrap compiler. The image and interpretation JSON are never
read by runtime.

P1 (southern borough) and D6.1 (initial visual observations) were already
present in the working runtime and are recorded as `already_compiled`; no
P1 and D6.1 remain already compiled; no duplicate Events were added. The authored waterfall location, landmark and inspectable physical witness are runtime content; the waterfall seed, resource nodes and historical explanations remain proposals and do not create runtime facts.

Validation is enforced by `npm run canon:validate`, including
`scripts/canon/validate-visual-canon.mjs`.
