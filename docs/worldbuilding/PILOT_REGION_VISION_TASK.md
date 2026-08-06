# SKALD — Pilot Region Vision Implementation Task

Version: 1.0
Status: dispatch-ready (for a model that can read images)
Author: SKALD architecture (repository task)

## 1. Role

You are a vision-capable systems designer working inside the SKALD repository.
Your job is NOT to invent a new game. Your job is to make the **first living
region** — currently abstract data in the codebase — the *verified visual canon*
that the illustration actually depicts, and to produce the region inventory,
toponyms, gameplay hooks and simulation seeds that flow from that illustration.

The deliverable is a **reviewable proposal**, not a blind merge. Anything that
changes the region, Events, Rules or read models must be marked as PROPOSAL and
passed through the repository's review gate.

## 2. What SKALD is (read these first, in this order)

1. `AGENTS.md` — the constitution. **Non-negotiable invariants**:
   - Event Log is the only source of truth; append-only.
   - Projection Purity: projection derives fully from the Event Log.
   - Rules are deterministic `(Event, ReadonlyWorld) → Event[]`: no
     `Date.now()`, `Math.random()`, network, LLM, mutable global state.
   - LLM/Narrative never decide for the world, NPCs or offline players.
   - Forbidden concepts: Spell, Mana, XP, Class, SkillTree, QuestManager,
     DialogueTree, `NPC.decide()`, LevelSystem.
   - Command ≠ Event. No runtime rule generation.
2. `docs/ARCHITECTURE.md` — authority and execution model.
3. `docs/simulation/LIVING_PROCESSES.md` — the living-process catalog with
   **Live / Deferred / Future** statuses (the region must map to these).
4. `docs/adr/0023-risk-and-exposure-model.md` — risk/Exposure semantics;
   the risk→fire chain is **Deferred**, not a defect.
5. `docs/ux/PLAYER_EXPERIENCE_VISUAL_REPORT.html` — what the player sees and
   what is constitutionally hidden.
6. `docs/canon/regions/pilot-region/*.yaml` + `docs/WORLD_BIBLE_ARCHITECTURE.md`
   — the design-time Canon for the pilot region (geography, monolith).
7. `docs/adr/0012-first-living-region.md`, `docs/adr/0014-region-bootstrap-observer-map.md`,
   `docs/adr/0019-player-map-observer-dto.md`, `docs/adr/0017-river-hydrology-and-crossing.md`.

## 3. The input image

**Path:** `C:\Users\Ольга\Downloads\ChatGPT Image 6 авг. 2026 г., 22_23_11.png`

Its role, stated once: the illustration is **not concept art**. It is the
**physical representation of the first region of the world**. Everything in it
is canonical geography; anything the simulation later invents that contradicts
it is wrong.

## 4. Read the existing region data before writing anything

The region already exists as data. Cross-check the illustration against it:

- `packages/world/src/region/definition.ts` — the authored region:
  - name: «Бассейн Речного Стража» (Riverwatch Basin), 20×20 km.
  - locations: `river_waystation` (Переправа у Чёрного леса, anchor 8000,9500),
    `riverwatch_city` (Речной Страж, 13500,7500), `blackwood_edge`
    (Кромка Чёрного леса, 6000,12000), `old_ruins` (Развалины на уступе,
    16000,14000), `glass_crater` (Стеклянная впадина, 3800,4200),
    `high_pass` (Северный перевал, 12000,18000).
  - landmarks: `suspended_monolith` (Парящий монолит, 11000,18000, elev 1400,
    silhouette monolith), plus city/crater/ruin landmarks.
  - relations: roads waystation→city, waystation→forest, city→ruins; river
    crossing; river basin.
- `packages/world/src/region/types.ts` — `RegionDefinition`, `RegionLocation`,
  `RegionLandmark`, `SpatialRelation`, `SpatialObservationPayload`.
- `packages/world/src/region/compiler.ts` — the deterministic bootstrap
  (`RegionDefined`, `LocationDefined`, `TravelMetadataAttached`,
  `RiverProcessDefined`, `CrossingConditionInitialized`, `WeatherProcessDefined`,
  `HeatProcessDefined`, `SettlementCreated`, `SpatialObservationRecorded`,
  `StrategySet`).
- `docs/canon/regions/pilot-region/geography.yaml` and `monolith.yaml` — the
  Canon facts (statement per fact; do not contradict without a Migration ADR).

The terrain itself (6400 tiles, 400 cells) is **generated deterministically** by
the compiler — do **not** regenerate or edit it. The image is used to author
and verify the *entity layer*: locations, landmarks, relations, observation
evidence, and (as proposals) process seeds.

## 5. Boundaries — you must not

- Create a new top-level package.
- Change the Event schema, canonical Rules, persistence or deployment.
- Add `Math.random()`, timestamps, network or LLM calls to any runtime path.
- Change what the player may see: normal UI reads only the Belief DTO and
  documented read DTOs; exact truth geometry of glimpsed landmarks never
  renders.
- Invent mechanisms. Every proposed behavior must map to an existing Event /
  Rule / read model or be explicitly tagged **Future** (per LIVING_PROCESSES.md).
- Add RPG concepts (quests, levels, inventories, NPC hubs). Settlements are
  **Living Patterns**, not NPC hubs.
- Edit `docs/canon/*` facts in place unless the change is a documented
  Migration (prefer adding a proposal section).

## 6. Deliverables

Produce a single report and the machine-readable files below. Every claim
about the illustration must cite the visual evidence (region of the image).

### D1. Visual analysis → region inventory
Describe the illustration as structured data:
- **Terrain patterns**: broad zones you see (forest, river valley, plains,
  highland, crater, marsh/water), with approximate normalized bounds.
- **Hydrology**: the watercourse(s), their shape, direction, any delta/bend.
- **Biomes / vegetation**: forest edge, dark forest, open valley, uplands.
- **Settlements**: every built structure and its type (town, waystation, ruins).
- **Landmarks**: every distinctive object (monolith, crater, ruins, mountain
  ridge, bridges).
- **Hidden / historical layers**: anything implied (old roads, aligned
  structures, suspicious regularities) — mark these as **hypotheses**, never
  as confirmed facts.

### D2. Canon mapping (image ↔ existing region)
For each of the six existing locations and four existing landmarks: confirm it
appears in the illustration, give its approximate pixel location, and state the
mapping method. Explicitly list **conflicts** (image shows something the data
lacks, or the data has something the image contradicts). Conflicts are
PROPOSALS for review, not silent edits.

### D3. Region canon JSON (machine-readable proposal)
Write `docs/worldbuilding/pilot-region/visual-canon.json`:
```jsonc
{
  "schemaVersion": 1,
  "source": "ChatGPT Image 6 авг. 2026 г., 22_23_11.png",
  "image": { "widthPx": 0, "heightPx": 0 },
  "registration": { "method": "anchor-based", "anchors": [ { "pixelX": 0, "pixelY": 0, "metreX": 8000, "metreY": 9500 } ] },
  "locations": [ /* id, name, pixelX, pixelY, metreX, metreY, confidence, visualEvidence */ ],
  "landmarks": [ /* id, name, pixelX, pixelY, metreX, metreY, elevationBand, silhouetteClass, confidence, bearing */ ],
  "relations": [ /* id, kind, fromId, toId, label, pathPointsMetres[], confidence */ ],
  "conflicts": [ /* what the image contradicts, with evidence */ ],
  "hypotheses": [ /* hidden/historical layers, mapped to Future processes */ ]
}
```
Coordinates must be in metres on the 20×20 km grid (0..20000), derived from a
documented registration (use the waystation anchor 8000,9500 as the primary
reference; state any rotation/scale you assumed).

### D4. Toponyms + meaning layer
For every location and landmark: keep the **existing canonical name**; propose
(do not replace) an additional meaning layer as a proposal:
`{ oldName, etymology, origin: { culture, ageEstimateYears }, observedMeaning,
 relationHint }` — a toponym is Geography + History + Culture + Observed
Meaning, not a pretty label.

### D5. Gameplay hooks
For each location/landmark, produce a hooks table:
- what a player can **observe** there (with a concrete observation payload);
- what **hypothesis** it invites (belief openHypotheses);
- which **living processes** it touches (P01..P18) and their status
  (Live/Deferred/Future);
- a **first interaction** a player can perform **today** (existing verbs:
  observe/inspect/listen/touch/take/open/apply_force/give/examine, moves, waits)
  — only verbs that exist in the current build;
- what is **constitutionally hidden** (the truth the player will never read).

### D6. Simulation event seeds (proposal)
A proposed, deterministic bootstrap addition (marked PROPOSAL — do not apply)
that makes the region live per the image: e.g. which locations get initial
`SpatialObservationRecorded` entries, which `TravelMetadataAttached` relations,
and the initial `RiverProcessDefined` / `CrossingConditionInitialized` /
`WeatherProcessDefined` / `HeatProcessDefined` / `SettlementCreated` states.
Must conform exactly to the event types in `packages/world/src/event-types.ts`
and the payload shapes in `compiler.ts`. No new event types.

### D7. Validation
- Run `node scripts/canon/validate.mjs` and `npm run typecheck` — nothing may
  regress.
- If you touched `packages/` code, add focused unit tests and run
  `npm run validate` (the single repository gate). Prefer: **do not touch
  `packages/` code**; ship proposals as data/docs only, so the repository's
  own architects decide what to merge.
- Check determinism: any seed you propose must be a pure constant, no
  randomness.

## 7. Output locations

- `docs/worldbuilding/pilot-region/VISUAL_CANON_REPORT.md` — the full report
  (analysis, mapping, conflicts, toponyms, hooks, seeds, acceptance evidence).
- `docs/worldbuilding/pilot-region/visual-canon.json` — D3 data.
- A short `docs/worldbuilding/pilot-region/REVIEW_REQUEST.md` — what you are
  asking the repo's architects to accept or reject, item by item.

## 8. Acceptance criteria

1. Every statement about the illustration cites a visual region of the image.
2. The existing six locations and four landmarks are mapped with metre
   coordinates and a documented registration; conflicts are explicit.
3. No runtime, Event, Rule or read-model change is applied silently — it is a
   marked proposal.
4. Player-facing content never states hidden truth (e.g. «the monolith is X»).
5. Toponyms keep existing canonical names; meaning layers are proposals.
6. Gameplay hooks use only existing verbs and map to Live/Deferred/Future
   processes.
7. Deterministic: no randomness, no timestamps in proposed seeds.
8. `docs/canon` facts are not contradicted without a documented Migration note.

## 9. Explicitly out of scope

- The 6400/400 terrain/cell generation.
- New Event types, Rules, or read models.
- A day/night cycle, economy, migration, information spread (all Future).
- Changing the Observer/Belief DTO or the no-truth-leak contract.
- RPG/quest content of any kind.

## 10. Report format (use this structure)

1. Executive summary (3–5 sentences).
2. Visual analysis (D1).
3. Canon mapping + conflicts (D2).
4. Machine data (D3) — reference the JSON file.
5. Toponyms (D4).
6. Gameplay hooks table (D5).
7. Simulation seeds proposal (D6).
8. Validation evidence (D7).
9. Review request (what to accept/reject).
10. Open questions for the repository architects.
