// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function createElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: "",
    hidden: false,
    textContent: "",
    dataset: {},
    children: [],
    attributes: {},
    append(...nodes) { this.children.push(...nodes.filter(Boolean)); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes.filter(Boolean); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    addEventListener(name, callback) { this.events = this.events || {}; this.events[name] = callback; },
    querySelector(selector) {
      if (selector.startsWith(".")) return this.children.find((child) => child.className === selector.slice(1)) || null;
      return null;
    },
    querySelectorAll() { return []; },
  };
}
function createDocument() {
  const ids = [
    "active-world-label", "time-display", "place-display", "pos-display",
    "stage-location-title", "stage-location-description", "stage-marker",
    "stage-links", "stage-attention", "stage-attention-text", "situation-card",
    "primary-card", "empty-state", "notable-list", "background-list",
    "critical-check-card", "world-activity-list", "causal-timeline",
    "context-world", "context-character", "context-knowledge",
    "world-sidebar-nearby", "world-sidebar-places", "world-sidebar-relations",
    "world-sidebar-interest", "turn-history-list",
  ];
  const elements = new Map(ids.map((id) => [id, createElement("div")]));
  return {
    elements,
    getElementById(id) { return elements.get(id) || null; },
    createElement,
    querySelectorAll() { return []; },
    dispatchEvent: vi.fn(),
  };
}

describe("Visual Shell — presentation purity", () => {
  let doc;
  beforeEach(() => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("renders current world facts without mutating snapshot", async () => {
    const { renderLivingWorld } = await import("../public/living-world-shell.js");
    const snapshot = {
      worldId: "legacy-world",
      revision: { worldTime: 12, eventNumber: 30 },
      world: { position: { x: 1, y: 2 }, locationName: "Старая башня", locationDescription: "Туман стелется у стен.", connectedLocations: [] },
      attention: { level: "stirring", marks: 2, maxMarks: 5, explanation: "Твой поступок заметили." },
      currentSituation: null,
      character: { displayName: "Странник", wound: "Порез", promise: "Вернуться", principle: "Слушать", relations: [], consequences: [] },
      recentActivity: [],
      knowledge: { facts: [], hypotheses: [], traces: [], recentEvidence: [] },
      lastTurn: null,
    };
    const before = JSON.stringify(snapshot);
    renderLivingWorld(snapshot);
    expect(doc.getElementById("stage-location-title").textContent).toBe("Старая башня");
    expect(doc.getElementById("stage-attention").children).toHaveLength(5);
    expect(JSON.stringify(snapshot)).toBe(before);
    const rendered = [...doc.elements.values()].map((element) => element.textContent).join(" ");
    expect(rendered).not.toMatch(/population|prosperity|inventory|hunger|late autumn|°C/i);
  });
  it("renders honest empty states for absent facts", async () => {
    const { renderLivingWorld } = await import("../public/living-world-shell.js");
    renderLivingWorld({ world: {}, attention: {}, character: {}, knowledge: {}, recentActivity: [], lastTurn: null });
    expect(doc.getElementById("stage-location-title").textContent).toBe("Место неизвестно");
    expect(doc.getElementById("world-sidebar-places").children[0].textContent).toContain("Известных мест");
    expect(doc.getElementById("empty-state").hidden).toBe(false);
  });
  it("keeps the shell free of action suggestions and d-pad controls", () => {
    const html = readFileSync(resolve(import.meta.dirname, "../public/index.html"), "utf8");
    expect(html).not.toMatch(/D-pad|Suggested Intentions|guidance-action|dir-btn|social-btn/i);
    expect(html).toContain('id="command-form"');
    expect(html).toContain('id="send-btn"');
  });
});

describe("Visual Shell — contextual map selection", () => {
  let doc;
  beforeEach(() => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("renders connected location names and dispatches a read-only selection", async () => {
    const { renderWorldStage } = await import("../public/world-stage-view.js");
    renderWorldStage({ locationName: "Башня", connectedLocations: [{ id: "crossing", name: "Перекрёсток" }] }, { marks: 0, maxMarks: 5 }, null);
    expect(doc.getElementById("stage-links").children[0].textContent).toBe("Перекрёсток");
    const button = doc.getElementById("stage-links").children[0];
    button.events.click();
    expect(doc.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "skald:context-select" }));
    expect(doc.dispatchEvent.mock.calls[0][0].detail.locationId).toBe("crossing");
  });
});

describe("Visual Shell — critical presentation", () => {
  let doc;
  beforeEach(() => { doc = createDocument(); vi.stubGlobal("document", doc); });
  afterEach(() => vi.unstubAllGlobals());
  it("shows recorded critical check facts without action buttons", async () => {
    const { renderCriticalCheck } = await import("../public/critical-check-view.js");
    renderCriticalCheck([
      { text: "Критический момент: дверь поддастся.", kind: "outcome" },
      { text: "Бросок: 14.", kind: "outcome" },
      { text: "Итого 16: Успех!", kind: "outcome" },
    ]);
    const card = doc.getElementById("critical-check-card");
    expect(card.hidden).toBe(false);
    expect(card.children.map((child) => child.textContent).join(" ")).toContain("Критический момент");
    expect(card.children.some((child) => child.tagName === "BUTTON")).toBe(false);
  });
  it("renders both success and failure stakes from structured critical data", async () => {
    const { renderCriticalCheck } = await import("../public/critical-check-view.js");
    renderCriticalCheck([{
      text: "Критический момент: дверь.",
      critical: { success: "Дверь открывается.", failure: "Дверь остаётся закрытой.", modifiers: [] },
    }]);
    const card = doc.getElementById("critical-check-card");
    const stakes = card.children[2].children[1];
    expect(stakes.children.map((child) => child.textContent).join(" ")).toContain("Дверь открывается.");
    expect(stakes.children.map((child) => child.textContent).join(" ")).toContain("Дверь остаётся закрытой.");
  });
});


describe("Visual Shell — DOM contract", () => {
  it("uses DOM APIs rather than innerHTML in browser modules", () => {
    const publicDir = resolve(import.meta.dirname, "../public");
    const files = readdirSync(publicDir).filter((file) => file.endsWith(".js"));
    for (const file of files) {
      expect(readFileSync(resolve(publicDir, file), "utf8"), file).not.toContain("innerHTML");
    }
  });
});
