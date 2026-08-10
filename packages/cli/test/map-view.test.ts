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

  it("renders reference artwork below observer-scoped fog and never plots rumored coordinates", () => {
    const container = element("div");
    renderObserverMap(container, mapDto());

    const nodes = descendants(container);
    expect(nodes.some((node) => node.tagName === "IMAGE")).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("player-map-terrain"))).toHaveLength(1);
    expect(nodes.some((node) => node.classList.contains("player-map-fog"))).toBe(true);
    expect(nodes.filter((node) => node.classList.contains("map-location"))).toHaveLength(3);
    expect(nodes.filter((node) => node.classList.contains("map-observer-marker"))).toHaveLength(1);
    expect(nodes.map((node) => node.textContent).join(" ")).toContain("Rumor");
  });


  it("persists zoom, pan and selected detail artwork across rerender", () => {
    const first = element("div");
    renderObserverMap(first, mapDto());
    const nodes = descendants(first);
    const zoomIn = nodes.find((node) => node.attributes["data-map-control"] === "zoom-in");
    zoomIn.dispatchEvent({ type: "click" });
    const detail = nodes.find((node) => node.attributes["data-map-detail"] === "northern-pass");
    detail.dispatchEvent({ type: "click" });
    const overview = nodes.find((node) => node.attributes["data-map-detail"] === "overview");
    overview.dispatchEvent({ type: "click" });

    const second = element("div");
    renderObserverMap(second, mapDto());
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
    expect(nodes.filter((node) => node.classList.contains("map-detail-card"))).toHaveLength(5);
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
    expect(nodes.filter((node) => node.classList.contains("map-detail-card"))).toHaveLength(5);
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
