// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFogRevealModel, renderObserverMap } from "../public/map-view.js";
import { loadObserverMap } from "../public/map-client.js";

function element(tag) {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(),
    children: [],
    attributes: {},
    className: "",
    style: {},
    textContent: "",
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      contains(name) { return classes.has(name); },
    },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
  };
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function mapDto() {
  return {
    schemaVersion: 2,
    revision: { worldTime: 4, eventNumber: 12 },
    region: { ref: "region-1", name: "Pilot" },
    observer: { locationRef: "loc-home", xMetres: 20, yMetres: 30 },
    knownArea: { minXMetres: 0, minYMetres: 0, maxXMetres: 100, maxYMetres: 100 },
    knownTerrain: [{ bounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 50, maxYMetres: 50 }, surface: "forest", elevationBand: 3, slopeBand: 2 }],
    locations: [
      { ref: "loc-home", name: "Home", knowledge: "traversed", xMetres: 20, yMetres: 30 },
      { ref: "loc-seen", name: "Seen", knowledge: "observed", xMetres: 50, yMetres: 60 },
      { ref: "loc-glimpse", name: "Glimpse", knowledge: "glimpsed", xMetres: 70, yMetres: 60 },
      { ref: "loc-rumor", name: "Rumor", knowledge: "rumored", xMetres: 95, yMetres: 95 },
    ],
    landmarks: [],
    routes: [{
      ref: "route-1",
      kind: "road",
      label: "Known road",
      knowledge: "observed",
      geometry: {
        kind: "observed_path",
        points: [{ xMetres: 20, yMetres: 30 }, { xMetres: 50, yMetres: 60 }],
      },
    }],
  };
}

describe("observer map fog of war", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: (tag) => element(tag),
      createElementNS: (_namespace, tag) => element(tag),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens fog only from observer-scoped non-rumored knowledge", () => {
    const dto = mapDto();
    const model = buildFogRevealModel(dto, dto.knownArea, { width: 400, height: 300 });

    expect(model.circles).toHaveLength(4);
    expect(model.circles.map((circle) => circle.radius)).toEqual([62, 52, 40, 24]);
    expect(model.circles.at(-1).strength).toBe(0.48);
    expect(model.corridors).toHaveLength(1);
    expect(model.corridors[0].width).toBe(24);
    expect(Object.isFrozen(model.circles)).toBe(true);
    expect(Object.isFrozen(model.corridors)).toBe(true);
  });

  it("renders observer-scoped vector terrain below fog and never plots rumored coordinates", () => {
    const container = element("div");
    renderObserverMap(container, mapDto());

    const nodes = descendants(container);
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(false);
    expect(nodes.filter((node) => node.classList.contains("player-map-terrain"))).toHaveLength(1);
    expect(nodes.some((node) => node.classList.contains("player-map-fog"))).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("map-location"))).toHaveLength(3);
    expect(nodes.filter((node) => node.classList.contains("map-observer-marker"))).toHaveLength(1);
    expect(nodes.map((node) => node.textContent).join(" ")).toContain("Rumor");
  });

  it("keeps a fully fogged map surface when no exact knowledge exists", () => {
    const dto = {
      ...mapDto(),
      observer: { locationRef: null, xMetres: null, yMetres: null },
      knownArea: null,
      locations: [{ ref: "rumor", name: "Rumor", knowledge: "rumored", xMetres: 99, yMetres: 99 }],
      routes: [],
    };
    const container = element("div");
    renderObserverMap(container, dto);

    const nodes = descendants(container);
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(false);
    expect(nodes.filter((node) => node.classList.contains("map-location"))).toHaveLength(0);
    expect(nodes.some((node) => node.classList.contains("player-map-fog"))).toBe(true);
  });
});

describe("observer map HTTP client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps the ObserverMapDTO from the world map response", async () => {
    const dto = mapDto();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, map: dto }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadObserverMap("world / one")).resolves.toEqual(dto);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worlds/world%20%2F%20one/map",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
