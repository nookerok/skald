# SKALD — Pilot Region Visual Canon: Review Request

**Date:** 2026-08-07
**Source:** Visual analysis of `ChatGPT Image 6 авг. 2026 г., 22_23_11.png`
**Files produced:**
- `docs/worldbuilding/pilot-region/VISUAL_CANON_REPORT.md` — full analysis
- `docs/worldbuilding/pilot-region/visual-canon.json` — machine-readable data

---

## What we are asking you to accept

### A1. Existing region data is visually consistent (NO changes needed)

All six canonical locations and four landmarks from `packages/world/src/region/definition.ts` are identifiable in the illustration. No canon facts in `docs/canon/regions/pilot-region/geography.yaml` or `monolith.yaml` are contradicted.

**Action:** Acknowledge. No code or canon changes required.

---

### A2. Visual registration data (accept as reference)

The `visual-canon.json` provides pixel-to-metre registration for all locations and landmarks using a two-point anchor system (waystation + monolith). This data is a reference artifact for future visual QA and region verification.

**Action:** Accept as documentation. No runtime impact.

---

## What we are asking you to decide (propose/reject)

### P1. Add secondary settlement `southern_borough` (C1)

**What:** The image shows a walled settlement south of the main city, at approximately metre (9500, 5000). It has two walled enclosures and towers. This does not exist in the current region definition.

**Change required:**
- Add `RegionLocation` entry to `packages/world/src/region/definition.ts`
- Add `LocationDefined` bootstrap event to `compiler.ts`
- Add `TravelMetadataAttached` for road from city to settlement
- Add `SpatialObservationRecorded` for initial knowledge

**Risk:** Low — additive only. No Rule changes. No Event schema changes.

**Recommendation:** Accept. The settlement is clearly visible and adds depth to the region.

---

### P2. Enrich monolith description with observable energy phenomenon (C3)

**What:** The image shows blue-white energy beams rising from the monolith base. The current description says 'silhouette monolith'. The proposal is to add 'occasional luminescence' as an observable attribute without revealing hidden truth.

**Change required:**
- Update `description` field for `suspended_monolith` in `definition.ts`
- Update corresponding Canon fact if needed (addendum, not contradiction)

**Risk:** Low — observable attribute only. Does not leak constitutional truth.

**Recommendation:** Accept with caution. The description must stay within 'what the observer can see', not 'what the monolith truly is'.

---

### P3. Add waterfall observation evidence (C2)

**What:** The image shows prominent waterfalls on the western mountain face. The proposal is to add initial `SpatialObservationRecorded` entries for the waterfalls as rumoured/observed features.

**Change required:**
- Add `SpatialObservationRecorded` bootstrap entries (existing event type)

**Risk:** None — documentation-level enrichment of initial observations.

**Recommendation:** Accept. The waterfalls are visually significant and enrich the player's initial belief model.

---

### P4. Accept visual canon report as reference documentation

**What:** The `VISUAL_CANON_REPORT.md` provides a structured analysis of the illustration, mapping every visual feature to the existing region data. It is a reference document for future worldbuilding and visual QA.

**Change required:** None — documentation only.

**Risk:** None.

**Recommendation:** Accept. The report provides a verified baseline for future region work.

---

## What we are NOT asking you to decide

- No new Event types are proposed.
- No new Rules are proposed.
- No changes to the projection, read models, or persistence.
- No changes to the Observation/Belief DTO.
- No changes to the player-facing UI contract.
- No RPG/quest content.
- No runtime code changes in this review cycle.

---

## Summary

| Item | Type | Decision needed |
|---|---|---|
| A1 | Existing data consistency | Acknowledge |
| A2 | Visual registration reference | Accept as docs |
| P1 | New settlement `southern_borough` | Accept / Reject |
| P2 | Monolith description enrichment | Accept / Reject |
| P3 | Waterfall observation evidence | Accept / Reject |
| P4 | Visual canon report as reference | Accept / Reject |


## Implementation status addendum (2026-08-09)

The review proposal has now been implemented as a reference-only
canonicalization layer:

- `region-interpretation.json` is the structured handoff for Canon review.
- `visual-interpretation.yaml` records the accepted design-time boundary.
- P1 (southern borough) and D6.1 (initial visual observations) were already
  present in runtime and are recorded as `already_compiled`, so no duplicate
  events were added.
- P2 (monolith luminescence), P3 (waterfall evidence), resource nodes and
  historical hypotheses remain explicit proposals until separately accepted.
- `npm run canon:validate` validates both the Canon Model and the new
  interpretation artifact.
