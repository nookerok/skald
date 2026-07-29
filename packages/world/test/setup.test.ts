import { describe, it, expect } from "vitest";
import { CHARACTER_PRESETS, getCharacterPreset, listCharacterPresets } from "../src/setup/character-presets.js";
import { WORLD_TEMPLATES, getWorldTemplate, listWorldTemplates } from "../src/setup/world-templates.js";
import { buildBootstrapEvents } from "../src/setup/bootstrap-builder.js";
import { WorldProjector } from "../src/projection.js";

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
