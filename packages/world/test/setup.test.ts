import { describe, it, expect } from "vitest";
import { CHARACTER_PRESETS, getCharacterPreset, listCharacterPresets } from "../src/setup/character-presets.js";
import { WORLD_TEMPLATES, getWorldTemplate, listWorldTemplates } from "../src/setup/world-templates.js";
import { buildBootstrapEvents } from "../src/setup/bootstrap-builder.js";
import { WorldProjector } from "../src/projection.js";
import { listRegionEntrypoints, getDefaultRegionEntrypoint } from "../src/setup/entrypoints.js";
import { buildPrologue } from "../src/setup/prologue.js";
import { loadCompiledRegionBundle } from "../src/region/bundle-loader.js";

describe("character presets", () => {
  it("registry is immutable", () => {
    expect(() => { (CHARACTER_PRESETS as any).wanderer = null; }).toThrow();
    expect(() => { (CHARACTER_PRESETS as any).new = {}; }).toThrow();
  });

  it("has at least 2 presets", () => {
    expect(listCharacterPresets().length).toBeGreaterThanOrEqual(2);
  });

  it("every preset has required fields", () => {
    for (const p of listCharacterPresets()) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.wound).toBeTruthy();
      expect(p.promise).toBeTruthy();
      expect(p.principle).toBeTruthy();
      expect(p.profileVersion).toBeGreaterThanOrEqual(1);
    }
  });

  it("getCharacterPreset returns null for unknown ID", () => {
    expect(getCharacterPreset("nonexistent")).toBeNull();
  });

  it("getCharacterPreset returns preset for known ID", () => {
    const p = getCharacterPreset("wanderer");
    expect(p).not.toBeNull();
    expect(p!.id).toBe("wanderer");
  });
});

describe("character backgrounds", () => {
  it("uses authored titles and exposes the five narrative questions", () => {
    expect(getCharacterPreset("wanderer")?.title).toBe("Изгнанник с северной дороги");
    expect(getCharacterPreset("keeper")?.title).toBe("Последний ученик сгоревшего архива");
    expect(getCharacterPreset("echo")?.title).toBe("Свидетель ночи у переправы");
    for (const background of listCharacterPresets()) {
      expect(background.formerRole).toBeTruthy();
      expect(background.rupture).toBeTruthy();
      expect(background.reasonInRegion).toBeTruthy();
      expect(background.knownConnection).toBeTruthy();
      expect(background.obligation).toBeTruthy();
      expect(background.startingTestimony).toBeTruthy();
      expect(background.startingContact).toBeTruthy();
      expect(background.startingItem).toBeTruthy();
      expect(background.familiarPlace).toBeTruthy();
      expect(background.procedureKnowledge).toBeTruthy();
    }
  });

  it("materializes background effects through domain events", () => {
    for (const background of listCharacterPresets()) {
      const events = buildBootstrapEvents({
        templateId: "living_region",
        regionId: "riverwatch-basin",
        entrypointId: "river_waystation_arrival",
        backgroundId: background.id,
      });
      const types = new Set(events.map((event) => event.type));
      for (const expectedType of ["TestimonyReceived", "RelationChanged", "WorldObjectPlaced", "ItemMoved", "ItemPossessionChanged", "SpatialObservationRecorded", "KnowledgeAcquired"]) {
        expect(types.has(expectedType)).toBe(true);
      }
      expect(events.filter((event) => event.type === "TestimonyReceived").every((event) => (event.payload as any).observerId === "player")).toBe(true);
      expect(events.some((event) => event.type === "WorldObjectPlaced" && (event.payload as any).state?.backgroundId === background.id)).toBe(true);
    }
  });
});

describe("world templates", () => {
  it("registry is immutable", () => {
    expect(() => { (WORLD_TEMPLATES as any).old_tower = null; }).toThrow();
  });

  it("has at least 2 templates", () => {
    expect(listWorldTemplates().length).toBeGreaterThanOrEqual(2);
  });

  it("every template has required fields", () => {
    for (const t of listWorldTemplates()) {
      expect(t.id).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.startingQuestion).toBeTruthy();
      expect(t.available).toBe(true);
    }
  });

  it("getWorldTemplate returns null for unknown ID", () => {
    expect(getWorldTemplate("nonexistent")).toBeNull();
  });
});

describe("living region onboarding", () => {
  it("exposes only authored starts", () => {
    const entries = listRegionEntrypoints();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "river_waystation_arrival", locationId: "river_waystation" });
    expect(getDefaultRegionEntrypoint().id).toBe("river_waystation_arrival");
  });

  it("compiles the authored entrypoint with one location transition and scoped evidence", () => {
    const bundle = loadCompiledRegionBundle("riverwatch-basin");
    const compiled = bundle.entrypoints?.find((entry) => entry.id === "river_waystation_arrival");
    expect(compiled?.presentation.title).toBe("Переправа у Чёрного леса");
    expect(compiled?.bootstrapEvents).toBeTruthy();
    expect(compiled?.bootstrapEvents?.filter((event) => event.type === "PlayerLocationChanged")).toHaveLength(1);
    const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival" });
    expect(events.filter((event) => event.type === "PlayerLocationChanged")).toHaveLength(1);
    const observed = events.filter((event) => event.type === "SpatialObservationRecorded");
    expect(observed).toHaveLength(compiled?.initialObservationRefs.length ?? 0);
    const initialKnowledge = events.filter((event) => event.type === "KnowledgeAcquired");
    expect(initialKnowledge).toEqual(expect.arrayContaining([expect.objectContaining({ type: "KnowledgeAcquired", payload: expect.objectContaining({ knowledgeId: "entrypoint:river_waystation_arrival:location:river_waystation" }) }), expect.objectContaining({ type: "KnowledgeAcquired", payload: expect.objectContaining({ knowledgeId: "entrypoint:river_waystation_arrival:relation:road_waystation_city" }) })]));
    expect(events).toEqual(buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival" }));
  });

  it("binds a selected background to deterministic starting knowledge", () => {
    const events = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    });
    expect(events.filter((event) => event.type === "KnowledgeAcquired")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "KnowledgeAcquired",
        payload: expect.objectContaining({
          subjectId: "player",
          knowledgeId: "background:keeper",
        }),
      }),
    ]));
  });

  it("covers every authored background in the prologue matrix", () => {
    const entrypoint = getDefaultRegionEntrypoint();
    for (const background of listCharacterPresets()) {
      const prologue = buildPrologue({ characterName: "Ирден", background, entrypoint });
      expect(prologue.paragraphs.join(" ")).toContain(background.history);
      expect(prologue.paragraphs.join(" ")).toContain(entrypoint.openingSituation);
      expect(prologue.openingHook).toContain(background.openingHook);
    }
  });

  it("builds deterministic personalized prologue content", () => {
    const background = getCharacterPreset("keeper")!;
    const entrypoint = getDefaultRegionEntrypoint();
    const first = buildPrologue({ characterName: "Ирден", background, entrypoint });
    const second = buildPrologue({ characterName: "Ирден", background, entrypoint });
    expect(first).toEqual(second);
    expect(first.paragraphs.join(" ")).toContain("Ирден");
    expect(first.paragraphs.join(" ")).toContain(entrypoint.title);
    expect(first.openingHook).toContain(background.openingHook);
  });
});

describe("bootstrap builder", () => {
  it("produces events for old_tower", () => {
    const events = buildBootstrapEvents("old_tower");
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "PlayerSpawned")).toBe(true);
    expect(events.some((e) => e.type === "WallPlaced")).toBe(true);
  });

  it("produces events for crossroads", () => {
    const events = buildBootstrapEvents("crossroads");
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "PlayerSpawned")).toBe(true);
    expect(events.some((e) => e.type === "WallPlaced")).toBe(true);
  });

  it("different templates produce different projections", () => {
    const towerEvents = buildBootstrapEvents("old_tower");
    const crossEvents = buildBootstrapEvents("crossroads");

    const towerProj = new WorldProjector();
    for (const e of towerEvents) towerProj.apply(e);

    const crossProj = new WorldProjector();
    for (const e of crossEvents) crossProj.apply(e);

    const tw = towerProj.getSnapshot().walls;
    const cw = crossProj.getSnapshot().walls;
    // Walls should differ between templates
    expect([...tw].sort()).not.toEqual([...cw].sort());
  });

  it("throws for unknown template", () => {
    expect(() => buildBootstrapEvents("unknown_template")).toThrow(/Unknown world template/);
  });

  it("legacy template produces valid events", () => {
    const events = buildBootstrapEvents("legacy");
    expect(events.some((e) => e.type === "PlayerSpawned")).toBe(true);
    expect(events.some((e) => e.type === "WallPlaced")).toBe(true);
  });
});
