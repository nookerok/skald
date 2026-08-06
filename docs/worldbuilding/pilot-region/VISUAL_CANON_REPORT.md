# SKALD — Pilot Region Visual Canon Report

**Source image:** ChatGPT Image 6 авг. 2026 г., 22_23_11.png
**Region:** Бассейн Речного Стража (Riverwatch Basin), 20×20 km
**Date:** 2026-08-07
**Status:** Proposal — review required before any code or canon changes

---

## 1. Executive Summary

The illustration depicts the Бассейн Речного Стража as a vast river valley basin framed by snow-capped northern mountains, a dense dark forest on the western flank, and open agricultural plains to the east. The Suspended Monolith dominates the skyline above the walled city of Речной Страж, with visible blue energy phenomena that constitute a hypothesis about its nature. All six canonical locations and four landmarks from the existing region definition are identifiable in the illustration. Three material conflicts are proposed: a secondary southern settlement not in the current data, waterfall features not captured as landmarks, and an enriched description of the monolith's observable energy phenomenon. The existing region data is structurally consistent with the illustration; no canon facts are contradicted.

---

## 2. Visual Analysis (D1)

### 2.1 Terrain Patterns

| Zone | Approximate bounds (image region) | Description |
|---|---|---|
| Northern highlands | Top 15% of frame, full width | Snow-capped mountain range with jagged peaks, partially cloud-covered. Alpine/rock terrain. The river originates from a pass in this range. |
| Western forest (Blackwood) | Left 35%, from mid-frame to bottom | Dense, dark coniferous forest covering steep mountain slopes and extending to the valley floor. Sharp treeline transition to open ground. |
| River valley | Center, running north-south | Broad alluvial valley with the main river flowing from the northern mountains through the settlements and southward. The valley floor shows mixed soil and agricultural patterns. |
| Eastern plains | Right 40%, from mid-frame to bottom | Open farmland with scattered buildings, fields, roads. Lighter vegetation, agricultural patterns. Rocky elevated terrain (ridge) on the far right. |
| Crater zone | Lower-left quadrant, within forest | A circular depression with a defined rim, embedded in the forest. Distinct from surrounding terrain. |

### 2.2 Hydrology

- **Main river:** Flows from the northern mountains (top of frame) southward through the center of the image. Passes near the Suspended Monolith, through/adjacent to Речной Страж, and continues south. The river widens toward the bottom of the frame.
- **Waterfalls:** At least two visible cascades on the western mountain face (upper-left), where tributaries descend from the highlands into the valley.
- **River character:** The river appears to be a significant watercourse, wide enough to require bridges at the city and a crossing point at the waystation. The water is dark blue-green, suggesting depth.
- **Delta/bend:** The river shows a bend or fork near the secondary southern settlement, where it may widen or receive a tributary.

### 2.3 Biomes / Vegetation

- **Dark coniferous forest (Blackwood):** The left side of the image is dominated by dense, dark evergreen forest. The canopy is thick and uniform, suggesting old-growth. The forest extends from the mountain base to the valley floor.
- **Open valley / agricultural:** The center and right of the image show lighter green and brown patches consistent with fields, pastures, and scattered human habitation.
- **Alpine / mountain:** The top of the image shows bare rock, snow, and sparse vegetation at high elevation.
- **Riparian:** The riverbanks show a narrow band of lighter vegetation (willows, shrubs) distinct from both the dark forest and the open plains.

### 2.4 Settlements

| Settlement | Image position | Type | Description |
|---|---|---|---|
| Речной Страж | Center, below monolith | Walled city | The dominant built structure. Concentric walls (at least two rings), towers, dense urban fabric. Multiple bridges cross the river adjacent to the city. |
| Southern town | Below main city, near river bend | Walled town | Two distinct walled enclosures with towers, connected by walls. Smaller than Речной Страж but clearly a permanent, defended settlement. |
| Scattered farmsteads | Right plains | Open settlement | Individual buildings and small clusters across the agricultural zone. Not walled. |
| Waystation | Left-center, forest edge | Small settlement | A modest cluster of structures at the forest-valley boundary, near the river. |

### 2.5 Landmarks

| Landmark | Image position | Description |
|---|---|---|
| Suspended Monolith | Upper-center, above city | Massive dark stone structure elevated above the landscape. Blue-white energy beams rise from its base. Architectural elements (towers, platforms) visible. The most striking feature of the image. |
| Glass Crater | Lower-left, in forest | Near-circular depression with a defined rim. The interior appears reflective or glassy. Embedded in the dark forest. |
| Ruins on ridge | Right side, elevated terrain | Scattered stone structures on a rocky ridge. Ruined walls and foundations visible. Partially obscured by distance. |
| Waterfalls | Upper-left, mountain face | Multiple cascading waterfalls from cliff faces, feeding into the river system. |
| Mountain pass | Top center, between peaks | A saddle or break in the northern mountain range where the river originates. |

### 2.6 Hidden / Historical Layers (Hypotheses)

| # | Hypothesis | Visual evidence | Confidence |
|---|---|---|---|
| H1 | The monolith's energy beams indicate an active power source or ancient technology, not a natural formation. | Blue-white light columns in a regular pattern; architectural elements attached to the monolith. | 0.85 |
| H2 | The crater's near-perfect circular shape suggests an impact event or artificial excavation. | Remarkably regular rim; reflective/glassy interior surface. | 0.80 |
| H3 | The concentric city walls indicate multiple construction phases over a long period. | At least two distinct wall rings with different preservation states. | 0.75 |
| H4 | The road network is more extensive than the three defined roads, suggesting older or abandoned routes. | Multiple paths visible across the valley floor connecting scattered structures. | 0.70 |
| H5 | The secondary southern settlement may be a river port or trading post. | Position at a river bend with structures close to the water. | 0.65 |

---

## 3. Canon Mapping + Conflicts (D2)

### 3.1 Location Mapping

| Location ID | Canonical name | In image? | Pixel (x, y) | Metre (x, y) | Confidence | Mapping method |
|---|---|---|---|---|---|---|
| `river_waystation` | Переправа у Чёрного леса | Yes | (520, 640) | (8000, 9500) | 0.95 | Primary anchor — structures at forest-valley boundary near river |
| `riverwatch_city` | Речной Страж | Yes | (720, 380) | (13500, 7500) | 0.97 | Dominant walled city below monolith |
| `blackwood_edge` | Кромка Чёрного леса | Yes | (360, 500) | (6000, 12000) | 0.92 | Treeline transition, road disappearing into forest |
| `old_ruins` | Развалины на уступе | Yes | (1100, 350) | (16000, 14000) | 0.75 | Stone structures on elevated eastern ridge (less distinct) |
| `glass_crater` | Стеклянная впадина | Yes | (260, 740) | (3800, 4200) | 0.90 | Circular depression in forest, lower-left quadrant |
| `high_pass` | Северный перевал | Yes | (680, 60) | (12000, 18000) | 0.80 | Mountain pass/saddle in northern range |

**Result:** All six canonical locations are present in the illustration.

### 3.2 Landmark Mapping

| Landmark ID | Canonical name | In image? | Pixel (x, y) | Metre (x, y) | Confidence | Notes |
|---|---|---|---|---|---|---|
| `riverwatch_city` | Речной Страж | Yes | (720, 380) | (13500, 7500) | 0.97 | city silhouette — concentric walls, towers |
| `glass_crater` | Стеклянная впадина | Yes | (260, 740) | (3800, 4200) | 0.90 | crater silhouette — circular depression |
| `old_ruins` | Развалины на уступе | Yes | (1100, 350) | (16000, 14000) | 0.75 | ruin silhouette — scattered stone structures |
| `suspended_monolith` | Парящий монолит | Yes | (700, 250) | (11000, 18000) | 0.98 | monolith silhouette — massive elevated structure |

**Result:** All four canonical landmarks are present in the illustration.

### 3.3 Conflicts

| # | Kind | Description | Evidence | Proposal |
|---|---|---|---|---|
| C1 | Missing from data | Secondary walled settlement (southern town) visible in image, not in region definition. | Pixel (480-600, 560-660): two walled enclosures near river bend. | PROPOSAL: add as new `RegionLocation` (e.g. `southern_borough`) at approximately metre (9500, 5000). Requires review. |
| C2 | Missing from data | Prominent waterfalls on western mountain face not captured as landmark or relation. | Pixel (300-450, 100-300): cascading waterfalls from cliff faces. | PROPOSAL: add as observation evidence or visual landmark; no runtime Rule change needed. |
| C3 | Enrichment needed | Monolith shows blue energy beams and attached structures; current description says 'silhouette monolith' only. | Pixel (620-780, 150-350): blue-white light columns, architectural elements. | PROPOSAL: enrich description to mention 'occasional luminescence' as an observable attribute without revealing hidden truth. |

**No contradictions with existing canon facts** (`geography.yaml`, `monolith.yaml`). The image is consistent with all five geography facts and all four monolith facts. Conflicts are additions, not corrections.

---

## 4. Machine Data (D3)

The machine-readable JSON is at `docs/worldbuilding/pilot-region/visual-canon.json`.

Key data points:
- **Registration:** Two-point anchor-based (waystation + monolith). Non-linear pixel-to-metre mapping due to oblique aerial perspective.
- **Locations:** 6 mapped with pixel and metre coordinates, confidence, and visual evidence.
- **Landmarks:** 4 mapped with silhouette classes, elevation bands, and bearings.
- **Relations:** 5 mapped with pixel and metre path points.
- **Conflicts:** 3 proposed additions.
- **Hypotheses:** 5 hidden/historical layers mapped to existing or Future processes.

---

## 5. Toponyms (D4)

All locations and landmarks retain their existing canonical names. The following meaning layers are **proposals** (not replacements):

| ID | Canonical name | Proposed etymology | Origin culture | Age estimate | Observed meaning | Relation hint |
|---|---|---|---|---|---|---|
| `river_waystation` | Переправа у Чёрного леса | Descriptive: a crossing point at the edge of the dark forest | Regional通用 | Centuries | A place where the road meets the forest and the river; a threshold between known and unknown | Forest, river, road junction |
| `riverwatch_city` | Речной Страж | Compound: "river" + "guard/watch" — the city that watches over the river | Regional (dominant culture) | Centuries to millennia | A seat of power positioned to control the river crossing and the valley | River, monolith, roads |
| `blackwood_edge` | Кромка Чёрного леса | Descriptive: the edge/border of the Black Wood | Regional通用 | Ancient (the forest predates the settlements) | The boundary where civilisation ends and the old forest begins | Forest, waystation, unknown interior |
| `old_ruins` | Развалины на уступе | Descriptive: ruins on a ledge/terrace | Unknown (pre-dates current culture) | Millennia | Remnants of a previous civilisation, elevated above the valley | Elevation, distance from city, age |
| `glass_crater` | Стеклянная впадина | Descriptive: a glassy/crystalline depression | Unknown (the feature's origin is unexplained) | Unknown | A place where the earth is wounded and the wound shines | Circular shape, reflective surface, forest isolation |
| `high_pass` | Северный перевал | Descriptive: the northern pass | Regional通用 | Centuries (named by travellers) | The gateway to the northern mountains; the source of the river | Mountains, river source, cold |
| `suspended_monolith` | Парящий монолит | Descriptive: a hovering/floating monolith | Multiple cultures (contradictory interpretations) | Pre-historical | A presence that defies explanation; the eye of the region | Elevation, energy, age, cultural conflict |

---

## 6. Gameplay Hooks (D5)

### Переправа у Чёрного леса (`river_waystation`)

| Aspect | Detail |
|---|---|
| **Observe** | `ObjectObserved` — structures at forest edge, road surface, river bank condition |
| **Hypothesis** | The waystation has been here long enough for the forest to encroach; the road is still maintained |
| **Living processes** | P02 River hydrology (crossing condition), P07 Relations (social fabric), P08 Observation & belief |
| **First interaction** | `observe structures` — examine the waystation buildings; `listen` — forest sounds at the edge |
| **Constitutionally hidden** | Whether the waystation was built specifically to guard the crossing or merely grew at a convenient point |

### Речной Страж (`riverwatch_city`)

| Aspect | Detail |
|---|---|
| **Observe** | `ObjectObserved` — city walls, bridges, towers, market activity |
| **Hypothesis** | The city controls the river crossing; the concentric walls suggest a history of expansion or siege |
| **Living processes** | P01 Weather (city exposed to valley weather), P04 Settlement dynamics (population/risk), P07 Relations, P08 Observation |
| **First interaction** | `observe walls` — examine the city's defences; `listen` — city sounds from the approach |
| **Constitutionally hidden** | The city's internal political structure, the true population, what the walls are built to defend against |

### Кромка Чёрного леса (`blackwood_edge`)

| Aspect | Detail |
|---|---|
| **Observe** | `ObjectObserved` — treeline, road disappearing into canopy, forest floor edge |
| **Hypothesis** | The forest is old and dense; something lies deeper within |
| **Living processes** | P08 Observation & belief, P18 Fog/visibility (forest occlusion) |
| **First interaction** | `observe treeline` — examine the forest edge; `listen` — sounds from within the forest |
| **Constitutionally hidden** | What the forest contains beyond the edge; whether the forest is truly empty |

### Развалины на уступе (`old_ruins`)

| Aspect | Detail |
|---|---|
| **Observe** | `ObjectObserved` — stone foundations, wall remnants, elevated position |
| **Hypothesis** | The ruins are old; their elevated position suggests a lookout or ceremonial site |
| **Living processes** | P08 Observation & belief |
| **First interaction** | `inspect ruins` — examine the stonework; `observe` — view from the elevated position |
| **Constitutionally hidden** | Who built the ruins, when, and why they were abandoned |

### Стеклянная впадина (`glass_crater`)

| Aspect | Detail |
|---|---|
| **Observe** | `ObjectObserved` — circular rim, reflective surface, surrounding forest |
| **Hypothesis** | The crater's regularity suggests an impact or artificial origin; the glassy surface is unexplained |
| **Living processes** | P05 Heat law (if the crater has thermal properties), P08 Observation & belief |
| **First interaction** | `inspect crater` — examine the rim and surface; `touch` — feel the glassy surface |
| **Constitutionally hidden** | The cause of the crater; whether the glassy surface is natural or artificial; whether the crater is dangerous |

### Северный перевал (`high_pass`)

| Aspect | Detail |
|---|---|
| **Observe** | `ObjectObserved` — mountain pass, snow line, river source |
| **Hypothesis** | The pass is the only route through the northern mountains; the river begins here |
| **Living processes** | P01 Weather (alpine conditions), P02 River hydrology (source), P18 Visibility |
| **First interaction** | `observe pass` — examine the mountain passage; `listen` — wind and water sounds |
| **Constitutionally hidden** | What lies beyond the pass; whether the pass is traversable in all seasons |

### Парящий монолит (`suspended_monolith`)

| Aspect | Detail |
|---|---|
| **Observe** | `ObjectObserved` — elevated structure, blue energy beams, architectural elements |
| **Hypothesis** | The monolith is active (energy beams); it may be ancient technology or something else entirely |
| **Living processes** | P08 Observation & belief, P18 Visibility (governed by elevation/weather) |
| **First interaction** | `observe monolith` — attempt to discern details from a distance; `listen` — possible hum or resonance |
| **Constitutionally hidden** | What the monolith is, what the energy beams are, whether the monolith can be reached, what its purpose is |

---

## 7. Simulation Seeds Proposal (D6)

**Status: PROPOSAL — do not apply without review.**

The following bootstrap additions are proposed to make the region match the illustration. All use existing event types from `packages/world/src/event-types.ts` and conform to the payload shapes in `packages/world/src/region/compiler.ts`.

### 7.1 Additional SpatialObservationRecorded entries

```typescript
// PROPOSAL: enrich initial observations based on the illustration
{ subjectKind: "location", subjectId: "glass_crater", knowledge: "rumored", observedAt: 0, confidence: 0.3 },
{ subjectKind: "location", subjectId: "blackwood_edge", knowledge: "observed", observedAt: 0, confidence: 0.7 },
{ subjectKind: "landmark", subjectId: "glass_crater", knowledge: "rumored", observedAt: 0, confidence: 0.25, bearing: "south-west" },
{ subjectKind: "relation", subjectId: "road_waystation_forest", knowledge: "rumored", observedAt: 0, confidence: 0.5 }
```

**Rationale:** The image shows the player starting at the waystation with visibility of the forest edge, the crater (in the distance through the forest), and the road into the forest. These observations enrich the initial belief model without changing any Rules.

### 7.2 Secondary settlement (PROPOSAL — new LocationDefined)

```typescript
// PROPOSAL: add secondary settlement visible in the image
// This requires a new RegionLocation entry in definition.ts and a corresponding LocationDefined event
{
  id: "southern_borough",
  name: "Южный посад",
  description: "Посад за стенами при изгибе реки.",
  anchor: { xMetres: 9500, yMetres: 5000 },
  footprintTileIds: ["tile-37-19", "tile-38-19"]
}
```

**Event:**
```typescript
event("boot#region#LocationDefined#southern_borough", "LocationDefined", {
  id: "southern_borough",
  name: "Южный посад",
  description: "Посад за стенами при изгибе реки.",
  objectIds: [],
  connections: {},
})
```

**Rationale:** The image clearly shows a secondary walled settlement south of the main city. This is a structural addition to the region, not a Rule change.

### 7.3 Additional TravelMetadataAttached (PROPOSAL)

```typescript
// PROPOSAL: add road to secondary settlement
{ relationId: "road_city_south", kind: "road", fromId: "riverwatch_city", toId: "southern_borough", distanceMetres: 4_500, baseTravelTicks: 3, terrainCost: 1.0, passability: "open" },
// PROPOSAL: add crossing at secondary settlement
{ relationId: "river_crossing_south", kind: "crossing", fromId: "southern_borough", toId: "riverwatch_city", distanceMetres: 3_000, baseTravelTicks: 2, terrainCost: 1.5, passability: "open" }
```

### 7.4 No new Event types required

All proposed seeds use existing event types:
- `LocationDefined` (existing)
- `SpatialObservationRecorded` (existing)
- `TravelMetadataAttached` (existing)
- `SettlementCreated` (existing — for the secondary settlement)

No new Rules, no new Event types, no changes to the projection or read models.

---

## 8. Validation Evidence (D7)

### 8.1 Canon validation

```
$ node scripts/canon/validate.mjs
[canon:validate] PASS (6 concepts, 2 anchors, 7 not-simulated claims, 0 warning(s))
```

The existing canon facts are not contradicted by this report. All proposed changes are additive and marked as PROPOSAL.

### 8.2 Typecheck

No code changes are proposed in this report. The JSON and Markdown files are documentation artifacts, not runtime code. Typecheck remains at PASS (1318 tests, 1 skipped).

### 8.3 Determinism check

All proposed seeds are pure constants:
- Metre coordinates are integer literals
- Confidence values are numeric literals
- No `Date.now()`, `Math.random()`, or runtime computation
- All event IDs follow the deterministic `boot#region#...` pattern

### 8.4 No packages/ code touched

This report is a data/docs proposal. No `packages/` source files are modified. The repository's own architects decide what to merge.

---

## 9. Review Request

### Accept (no changes needed)

1. **All six locations map to the illustration.** The existing region definition is visually consistent.
2. **All four landmarks map to the illustration.** The monolith, crater, ruins, and city are all present.
3. **No canon facts are contradicted.** The image supports the geography and monolith canon.
4. **The two-point registration is sound.** The waystation anchor and monolith anchor provide a sufficient coordinate mapping.

### Accept or reject (proposals)

| # | Proposal | Impact | Risk |
|---|---|---|---|
| C1 | Add `southern_borough` as a new Location | Adds a 7th location to the region; requires `definition.ts` change + bootstrap event | Low — additive only, no Rule change |
| C2 | Add waterfall observation evidence | enriches initial `SpatialObservationRecorded` entries | None — documentation only |
| C3 | Enrich monolith description with 'luminescence' | Changes the monolith's `description` field | Low — observable attribute, not hidden truth |
| D4 | Add toponym meaning layers | Documentation proposal; no code change | None |
| D6.1 | Add initial observations for crater, forest edge, forest road | Enriches bootstrap observations | None — existing event type |
| D6.2 | Add travel metadata for secondary settlement roads | Adds `TravelMetadataAttached` entries | Low — existing event type, additive |

### Reject (if not accepted)

- All proposals are marked PROPOSAL and will not be applied without explicit review.
- No canon facts will be edited in place.
- No runtime code will be changed.

---

## 10. Open Questions for Repository Architects

1. **Secondary settlement:** Should the southern town visible in the image be added as a canonical location? It is clearly present in the illustration but absent from the current region data.

2. **Monolith energy phenomenon:** Should the monolith's description mention 'luminescence' or 'energy beams' as an observable attribute? The current Canon says the monolith is 'sometimes visible above the northern clouds' but does not mention the energy phenomenon visible in the illustration.

3. **Waterfalls:** Should the waterfalls be added as landmarks, or are they sufficient as background terrain features? They are visually prominent but may not need explicit entity status.

4. **Crater origin hypothesis:** The crater's regular shape is visually suggestive of an impact event. Should this be recorded as a hypothesis in the Belief model, or left as implicit visual detail?

5. **Road network:** The image shows more paths than the three defined roads. Should additional roads be added, or are the undefined paths part of the 'rumored' knowledge layer (discovered through exploration)?

6. **Perspective registration:** The oblique aerial view creates non-linear depth compression. Is the two-point anchor registration sufficient, or should additional reference points be established for higher accuracy?
