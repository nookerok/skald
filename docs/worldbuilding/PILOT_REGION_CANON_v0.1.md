# PILOT_REGION_CANON_v0.1

Status: draft — first game contract
Commit reference: 7b83302
Scope: Бассейн Речного Стража (Riverwatch Basin), the first living region.

The purpose of this document is **not** to describe the region. Its purpose is
to fix the **minimum body of knowledge required for the player's first
research cycle to exist**. It is a contract between the World Simulation, the
Observation Layer and the Player Experience. It is not an encyclopedia, not
lore, not a design document.

---

## 0. Purpose

The Pilot Region exists to validate three game hypotheses, each measurable:

1. **The Observe → Hypothesis → Test loop works without quests.**
   Can a player, starting with a small honest knowledge surface, form and test
   a hypothesis about the world using only observation, belief, and the
   world's own responses?
2. **There is enough information without quest markers.**
   Does the knowledge surface give the player *directions of inquiry* — not
   goals — so that natural research goals emerge?
3. **The world visibly changes because of time and the player's actions.**
   Does the river rise, the settlement drift, the relation grow — and can the
   player attribute change to a cause?

Every seed and loop below is the **minimum** that satisfies these three
hypotheses. Nothing is promised beyond what the current build can deliver.

### The Discovery Contract

A governing principle for any mechanic in SKALD. A valid discovery always
passes through the whole chain:

```
Observation → Evidence → Hypothesis → Experiment → World Response → Updated Belief
```

- A mechanic that jumps from **Observation straight to Truth** is invalid.
- A mechanic shaped as **Quest → Reward** is invalid.
- A mechanic that ends in **Updated Belief** (never in a revealed truth) is
  SKALD.

This contract binds every Discovery Seed and Loop in this document.

---

## 1. Region Identity

| Field | Value |
|---|---|
| id | `riverwatch-basin` (pilot_region) |
| name | Бассейн Речного Стража (Riverwatch Basin) |
| scale | 20 × 20 km (6400 tiles of 250 m; 400 simulation cells of 1 km) |
| purpose | first living-world observation zone |
| epoch | post-collapse; ruins and the monolith predate current culture |
| climate role | temperate river valley framed by snow-capped northern highlands |
| place in world | a bounded basin: the player's first window into a larger world |

Identity is factual and minimal. No hidden truth is declared here.

---

## 2. Geographic Pattern Graph

Not an object list — a dependency graph. The player investigates *these
links*. All subjects below exist in the current region definition.

```
High Ridge (Северный перевал)
      │ creates
      ▼
River Source (река из северных гор)
      │ feeds · P02 Live
      ▼
Floodplain / River Valley
      ├── supports · P04 Live → Southern Borough (Южный посад)
      ├── supports · P04 Live → Речной Страж (riverwatch_city)
      └── crosses · P03 Live → ford (river_crossing) → Переправа у Чёрного леса
          │
Blackwood Forest (Кромка Чёрного леса)
      │ borders · road_waystation_forest (rumored) → into the unknown
      │ embeds · P08 → Стеклянная впадина (glass_crater)
          │
Monolith (Парящий монолит) — overhangs the basin; glimpsed from the waystation
          │
Ruins (Развалины на уступе) — east ridge, reached by the Восточный тракт
```

Three of these edges are **live and observable today**: river→crossing
(P02→P03), settlement drift (P04), relations via giving (P07). The rest are
investigation targets — geography the player must reach to see.

---

## 3. Knowledge Surface

For every subject the contract fixes only **what the player may know**,
never all that exists. Values match the bootstrap
`SpatialObservationRecorded` exactly.

| Subject | player_surface | confidence |
|---|---|---|
| Переправа у Чёрного леса | traversed | 1.0 |
| Дорога к Речному Стражу | observed | 0.9 |
| Переправа (ford) | observed | 0.85 |
| Кромка Чёрного леса | observed | 0.7 |
| Парящий монолит | glimpsed (bearing северо-восток) | 0.45 |
| Стеклянная впадина (location) | rumored | 0.3 |
| Стеклянная впадина (landmark) | rumored (bearing юго-запад) | 0.25 |
| Лесная дорога | rumored | 0.5 |
| Речной Страж, Южный посад, Развалины, Северный перевал | unknown | — |
| Exact truth geometry; monolith meaning; crater origin | impossible | — |

Rules of the surface:

- `rumored` and `glimpsed` never carry exact coordinates or meaning.
- The surface only grows through further `SpatialObservationRecorded`
  (re-observation, travel, events).
- The `impossible` tier is enforced by the no-truth-leak audit; the player
  cannot be told more than the surface allows.

---

## 4. Discovery Seeds

Each seed answers four questions only: **Observation → Possible explanations →
How the player can test → What new observations become available.** Truth is
never revealed. Where a path requires a Future process, it is tagged.

### Seed S1 — the river has a law
- **Observation**: «Река поднялась: переправа стала трудной.» (Live, P02→P03)
- **Possible explanations**: a cycle; weather upstream; something blocking the
  course.
- **How to test**: observe the crossing over several days; wait at the trough;
  predict the ford will reopen.
- **New observations**: the river is periodic → the player can plan travel.
  Confidence in the hypothesis rises with each verified return.
- Contract ends at **Updated Belief**: the player knows the *law*, not a cause.

### Seed S2 — the settlements breathe
- **Observation**: Речной Страж and Южный посад drift (population/risk) via
  `SettlementStateChanged` (Live, P04).
- **Possible explanations**: internal dynamics; the river; the road; the
  player's actions.
- **How to test**: wait over many ticks; observe whether risk falls and
  population grows; give help and watch the relation and the settlement react.
- **New observations**: settlement change over time; a relation edge (P07).
- Note: economy (P13) and migration (P14) are **Future** — dependency between
  settlements is not yet simulated; the seed stops where the system stops.

### Seed S3 — the monolith is only a bearing
- **Observation**: glimpsed, north-east, no coordinates (Live surface).
- **Possible explanations**: a physical landmark; something else entirely —
  unknown.
- **How to test**: travel north; re-observe from other elevations and weather;
  watch whether the bearing refines or the silhouette resolves.
- **New observations**: refined bearing/visibility (P18) — but exact
  coordinates and meaning are `impossible`; the player learns *about the
  sight*, not *the thing*.

### Seed S4 — the crater's surface is not its origin
- **Observation**: rumored; «круглая чаша земли, где камень блестит после
  дождя» (rumored, bearing юго-запад).
- **Possible explanations**: natural; artificial; ancient process.
- **How to test**: travel to it (unknown today); inspect and touch the
  material (existing verbs).
- **New observations**: material details (P08). Origin stays a hypothesis —
  the crater's `future` process is not built.

### Seed S5 — the forest road is rumored
- **Observation**: Кромка Чёрного леса observed; the forest road is rumored.
- **Possible explanations**: an old route; a trap; nothing.
- **How to test**: follow the road; listen at the edge.
- **New observations**: what the forest lets the player see — nothing more.

---

## 5. Discovery Loops

Loops are graphs; a loop may **break at any stage** and remain a valid,
honest experience. The player is never obligated to complete one.

### Loop A — River
```
Notice the ford changed
        ↓
Track it over days
        ↓
Find the pattern (period)
        ↓
Form hypothesis
        ↓
Observe the return
        ↓
Confidence rises (Updated Belief)
```
Live today (P02→P03, belief freshness). Breaking point: if the player never
waits, the loop simply does not begin.

### Loop B — Settlement
```
Observe Южный посад / Речной Страж drift
        ↓
Understand the dependence on the river and time
        ↓
Influence conditions (give help → relation)
        ↓
See the consequence in the settlement/relation
```
Live today (P04, P07). Future depth (economy, migration) is tagged Future.

### Loop C — Ancient Structure
```
Rumor (crater) / glimpsed bearing (monolith) / distant ruins
        ↓
Travel toward it (needs the unknown surface to open)
        ↓
Gather evidence (inspect, touch, listen)
        ↓
Form hypothesis (belief openHypotheses)
        ↓
Re-observe → confidence or contradiction
```
Reachable today via observation + belief; the structures' *meaning* stays
`impossible`.

---

## 6. System Coverage

The contract promises only what the build delivers.

| System | Used | Notes |
|---|---|---|
| Observation | ✅ | perception, examinedCuriosity (P08) |
| Belief | ✅ | confidence/freshness/hypotheses (P08, P16) |
| River / Crossing | ✅ | P02 → P03 |
| Settlement | ✅ | two settlements, P04 |
| Relations | ✅ | give → RelationChanged, P07 |
| Weather | ✅ | P01 |
| Heat law | ✅ | P05 (grid); P06 zonal deferred |
| Visibility / Map | ✅ | observer map, P18 |
| Travel | ⏳ | road metadata exists; journeys Deferred (P12) |
| Economy | ⏳ | Future (P13) |
| Ecology | ⏳ | Future (P14) |
| Information spread | ⏳ | Future (P15) |
| Consequences / Fire | Deferred | ADR-0023 |

`⏳` means *the contract does not promise it*; the seed stops at the system
boundary.

---

## 7. Validation Targets

Measurable outcomes for the first 30 minutes of play. These are check targets,
not acceptance criteria of a feature:

1. **Pattern**: the player can name at least one recurring behavior of the
   world (the river returns, the settlement drifts) supported by evidence.
2. **Testable hypothesis**: the player records at least one belief hypothesis
   (`openHypotheses`) that can be confirmed or refuted by further observation.
3. **World response**: the player encounters a world change caused by time
   (river, settlement) or by their own action (relation, observation).
4. **No truth revealed**: at no point is the player told hidden state (exact
   monolith meaning, crater origin, rule internals).

If these four hold, the fundamental SKALD loop works **without quests, levels
or rewards**.

---

## 8. Boundary reminders

- No new Event types. `SpatialObservationRecorded` is the only way knowledge
  enters the surface.
- No second Canon layer: this document references the existing region data and
  `docs/canon/regions/pilot-region/`; it does not replace them.
- The Discovery Contract is normative for any future mechanic proposal.
