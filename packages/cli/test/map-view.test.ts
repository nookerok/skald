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
    listeners: {},
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      contains(name) { return classes.has(name); },
    },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
    dispatchEvent(event) { for (const handler of this.listeners[event.type] || []) handler(event); },
  };
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function mapDto() {
  return {
    schemaVersion: 2,
    revision: { worldTime: 4, eventNumber: 12 },
    region: { ref: "riverwatch-basin", name: "Pilot" },
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
    vi.stubGlobal("localStorage", {
      values: {},
      getItem(key) { return this.values[key] ?? null; },
      setItem(key, value) { this.values[key] = String(value); },
    });
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

  it("uses the server detail allow-list for DTO v3", () => {
    const container = element("div");
    renderObserverMap(container, {
      ...mapDto(),
      schemaVersion: 3,
      availableDetails: [{
        id: "central-valley",
        coverageBounds: { minXMetres: 5_000, minYMetres: 7_000, maxXMetres: 12_000, maxYMetres: 14_000 },
      }],
    });
    const nodes = descendants(container);
    const central = nodes.find((node) => node.attributes["data-map-detail"] === "central-valley");
    const locked = nodes.filter((node) => node.attributes["data-map-detail-state"] === "locked");
    expect(central.classList.contains("map-detail-card--locked")).toBe(false);
    expect(locked).toHaveLength(0);
  });

  it("projects server-owned reveal zones and ignores client-side inference", () => {
    const dto = {
      ...mapDto(),
      schemaVersion: 3,
      revealZones: [
        { kind: "vicinity", center: { xMetres: 20, yMetres: 30 }, radiusMetres: 20, strength: 1 },
        { kind: "route", path: [{ xMetres: 20, yMetres: 30 }, { xMetres: 50, yMetres: 60 }], widthMetres: 10, strength: 0.5 },
      ],
    };
    const model = buildFogRevealModel(dto, dto.knownArea, { width: 400, height: 300 });
    expect(model.circles).toHaveLength(1);
    expect(model.circles[0].radius).toBe(60);
    expect(model.corridors).toHaveLength(1);
    expect(model.corridors[0].width).toBe(30);
    expect(model.circles[0].strength).toBe(1);
    expect(model.corridors[0].strength).toBe(0.5);
  });

  it("renders reference artwork below observer-scoped fog and never plots rumored coordinates", () => {
    const container = element("div");
    renderObserverMap(container, mapDto());

    const nodes = descendants(container);
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("player-map-terrain"))).toHaveLength(1);
    expect(nodes.some((node) => node.classList.contains("player-map-fog"))).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("map-location"))).toHaveLength(2);
    expect(nodes.filter((node) => node.classList.contains("map-observer-marker"))).toHaveLength(1);
    expect(nodes.map((node) => node.textContent).join(" ")).toContain("Rumor");
  });


  it("persists zoom, pan and selected detail artwork across rerender", () => {
    const dto = {
      ...mapDto(),
      locations: [...mapDto().locations, {
        ref: "loc-central", name: "Central", knowledge: "traversed",
        xMetres: 8000, yMetres: 9500,
      }],
    };
    const first = element("div");
    renderObserverMap(first, dto);
    const nodes = descendants(first);
    const zoomIn = nodes.find((node) => node.attributes["data-map-control"] === "zoom-in");
    zoomIn.dispatchEvent({ type: "click" });
    const detail = nodes.find((node) => node.attributes["data-map-detail"] === "central-valley");
    detail.dispatchEvent({ type: "click" });
    const overview = nodes.find((node) => node.attributes["data-map-detail"] === "overview");
    overview.dispatchEvent({ type: "click" });

    const second = element("div");
    renderObserverMap(second, dto);
    const image = descendants(second).find((node) => node.tagName === "IMAGE");
    const svg = descendants(second).find((node) => node.tagName === "SVG");
    expect(image.attributes.href).toContain("riverwatch-basin-overview.png");
    expect(svg.attributes["data-map-view"]).toBe("overview");
    expect(svg.attributes["data-zoom"]).toBe("1.15");
  });


  it("registers pilot artwork by canonical region name when runtime ref is opaque", () => {
    const container = element("div");
    renderObserverMap(container, { ...mapDto(), region: { ref: "region-15q72dw", name: "\u0411\u0430\u0441\u0441\u0435\u0439\u043d \u0420\u0435\u0447\u043d\u043e\u0433\u043e \u0421\u0442\u0440\u0430\u0436\u0430" } });
    const nodes = descendants(container);
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("map-detail-card"))).toHaveLength(0);
  });



  it("renders v4 terrain regions and organic memory geometry without grid seams", () => {
    const dto = {
      ...mapDto(),
      schemaVersion: 4,
      terrainRegions: [{
        polygon: [
          { xMetres: 0, yMetres: 0 },
          { xMetres: 50, yMetres: 0 },
          { xMetres: 50, yMetres: 50 },
          { xMetres: 0, yMetres: 50 },
        ],
        surface: "forest",
        elevationBand: 1,
        slopeBand: 0,
      }],
      revealZones: [
        { kind: "vicinity", profile: "organic", seed: "start", edgeVariance: 0.2, center: { xMetres: 20, yMetres: 30 }, radiusMetres: 20, strength: 1 },
        { kind: "route", profile: "memory_trace", seed: "path", edgeVariance: 0.2, path: [{ xMetres: 20, yMetres: 30 }, { xMetres: 50, yMetres: 60 }], widthMetres: 10, strength: 1 },
      ],
      availableDetails: [{ id: "overview", coverageBounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 100, maxYMetres: 100 } }],
    };
    const model = buildFogRevealModel(dto, dto.knownArea, { width: 400, height: 300 });
    expect(model.blobs).toHaveLength(1);
    expect(model.memoryTraces).toHaveLength(1);
    expect(model.circles).toHaveLength(0);
    expect(model.blobs[0].path).toContain("Q");
    const container = element("div");
    renderObserverMap(container, dto);
    const nodes = descendants(container);
    expect(nodes.filter((node) => node.classList.contains("player-map-terrain-region"))).toHaveLength(1);
    expect(nodes.filter((node) => node.classList.contains("player-map-terrain"))).toHaveLength(0);
    expect(nodes.filter((node) => node.tagName === "LINE")).toHaveLength(0);
    expect(nodes.filter((node) => node.classList.contains("map-detail-card"))).toHaveLength(0);
  });

  it("renders glimpsed knowledge as a text silhouette and rumors only in memory list", () => {
    const dto = {
      ...mapDto(),
      schemaVersion: 4,
      locations: [
        { ref: "loc-home", name: "Home", knowledge: "traversed", xMetres: 20, yMetres: 30 },
        { ref: "loc-glimpse", name: "Glimpse", knowledge: "glimpsed", xMetres: 70, yMetres: 60, bearing: "северо-восток", approximation: { shape: "haze", bearing: "северо-восток", distanceBand: "far", angularSpan: 42 } },
        { ref: "loc-rumor", name: "Rumor", knowledge: "rumored", xMetres: null, yMetres: null, bearing: "юг" },
      ],
      landmarks: [],
      routes: [],
      revealZones: [],
      availableDetails: [{ id: "overview", coverageBounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 100, maxYMetres: 100 } }],
    };
    const container = element("div");
    renderObserverMap(container, dto);
    const nodes = descendants(container);
    expect(nodes.filter((node) => node.classList.contains("map-location"))).toHaveLength(1);
    expect(nodes.some((node) => node.classList.contains("map-approximation"))).toBe(true);
    expect(nodes.some((node) => node.classList.contains("map-approximation-haze"))).toBe(true);
    expect(nodes.map((node) => node.textContent).join(" ")).toContain("Слух: Rumor — к юг");
    expect(nodes.map((node) => node.textContent).join(" ")).not.toContain("точная позиция");
  });

  it("keeps pilot artwork for a legacy map without region metadata", () => {
    const container = element("div");
    renderObserverMap(container, { ...mapDto(), region: null });
    const nodes = descendants(container);
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("map-detail-card"))).toHaveLength(0);
    expect(nodes.some((node) => node.classList.contains("player-map-fog"))).toBe(true);
  });

  it("does not borrow pilot raster artwork for an unregistered region", () => {
    const container = element("div");
    renderObserverMap(container, { ...mapDto(), region: { ref: "unknown-region", name: "Other" } });
    const nodes = descendants(container);
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(false);
    expect(nodes.filter((node) => node.classList.contains("map-detail-card"))).toHaveLength(0);
    expect(nodes.some((node) => node.classList.contains("player-map-fog"))).toBe(true);
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
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("map-location"))).toHaveLength(0);
    expect(nodes.some((node) => node.classList.contains("player-map-fog"))).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("map-detail-card"))).toHaveLength(0);
  });

  it("shows only detail artwork unlocked by observer knowledge", () => {
    const container = element("div");
    renderObserverMap(container, {
      ...mapDto(),
      locations: [{
        ref: "loc-waystation", name: "Waystation", knowledge: "traversed",
        xMetres: 8000, yMetres: 9500,
      }],
    });
    const nodes = descendants(container);
    const central = nodes.find((node) => node.attributes["data-map-detail"] === "central-valley");
    expect(central.classList.contains("map-detail-card--locked")).toBe(false);
    expect(nodes.filter((node) => node.attributes["data-map-detail-state"] === "locked")).toHaveLength(0);
  });
});
describe("observer map HTTP client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the server-owned v3 map DTO", async () => {
    const dto = { ...mapDto(), schemaVersion: 3, revealZones: [], availableDetails: [{ id: "overview", coverageBounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 100, maxYMetres: 100 } }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, map: dto }),
    }));
    await expect(loadObserverMap("riverwatch-main")).resolves.toEqual(dto);
  });

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
