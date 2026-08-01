// @ts-nocheck
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dirname, "../public");

function code(name) {
  return readFileSync(resolve(PUBLIC, name), "utf-8");
}

describe("presence-view.js", () => {
  it("file exists and has expected exports", () => {
    const src = code("presence-view.js");
    expect(src).toContain("export function presenceModeFor");
    expect(src).toContain("export function renderPresenceView");
  });

  it("classifies the six entry modes from backend state only", () => {
    const src = code("presence-view.js");
    expect(src).toContain('if (session.checkpointState === "missing") return "first"');
    expect(src).toContain('if (session.checkpointState === "incompatible") return "invalid"');
    expect(src).toContain('if (session.drift.level === "low") return "valid-low"');
    expect(src).toContain('if (session.drift.level === "medium") return "valid-medium"');
    expect(src).toContain('if (session.drift.level === "high") return "valid-high"');
    expect(src).toContain('return "valid-none"');
  });

  it("renders only backend-authored montage statements, never event names", () => {
    const src = code("presence-view.js");
    expect(src).toContain("statement.text");
    expect(src).not.toMatch(/statement\.(type|name|event)/);
    expect(src).not.toContain("eventNumber");
    expect(src).not.toContain("toLocaleDateString");
  });

  it("renders suggested reobservations as passive doubts without buttons", () => {
    const src = code("presence-view.js");
    expect(src).toContain("presence-doubt");
    expect(src).toContain("Сомнения");
    expect(src).not.toContain('textContent = "Понаблюдать"');
    expect(src).not.toContain('textContent = "Проверить"');
  });

  it("derives rendering exclusively from backend-provided fields", () => {
    const src = code("presence-view.js");
    expect(src).not.toContain("fetch(");
    expect(src).not.toMatch(/Math\./);
    expect(src).not.toContain("eventNumber");
    expect(src).not.toContain("toLocaleDateString");
  });
});

describe("focus-view.js", () => {
  it("file exists and has expected exports", () => {
    expect(code("focus-view.js")).toContain("export function renderFocusView");
  });

  it("renders only real focus fields and skips null blocks", () => {
    const src = code("focus-view.js");
    expect(src).toContain("if (focus.ambientDescription)");
    expect(src).toContain("if (focus.sensoryCues && focus.sensoryCues.length > 0)");
    expect(src).toContain("if (focus.rememberedContext && focus.rememberedContext.length > 0)");
    expect(src).not.toMatch(/focus\.timeDescription/);
  });

  it("has the single Я здесь acknowledge button", () => {
    const src = code("focus-view.js");
    expect(src).toContain('ackBtn.textContent = "Я здесь"');
    expect(src).toContain("skald:presence-ack");
    expect((src.match(/createElement\("button"\)/g) || []).length).toBe(1);
  });

  it("dispatches an event instead of deciding for the world", () => {
    const src = code("focus-view.js");
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("acknowledgePresence");
  });
});

describe("presence-entry-controller.js", () => {
  it("file exists and has expected exports", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain("export async function startPresenceEntry");
    expect(src).toContain("export function retryAck");
    expect(src).toContain("export function retrySession");
  });

  it("delegates decisions to the deterministic state machine", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain('from "./presence-entry-state.js"');
    expect(src).toContain("transitionPresenceEntry");
    expect(src).toContain('from "./presence-view.js"');
    expect(src).toContain('from "./focus-view.js"');
  });

  it("uses the durable same-key retry for acknowledge transport failures", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain("ackStorageKey");
    expect(src).toContain("readPending");
    expect(src).toContain("writePending");
    expect(src).not.toContain("setInterval");
  });

  it("re-fetches the session on staleness and never auto-acks", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain('if (code === "stale_revision")');
    expect(src).toContain('if (code === "duplicate_request")');
    expect(src).toContain("RELOAD_SESSION");
  });

  it("unlocks the game shell only through the ready signal", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain("skald:presence-ready");
    expect(src).not.toContain("interactionReady = true");
  });

  it("uses the single truthful loading phrase", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain("LOADING_TEXT");
    expect(src).not.toContain("Разбираем намерение");
    expect(src).not.toContain("Собираем последствия");
  });
});

describe("app.js return route", () => {
  it("routes /return into the presence entry panel", () => {
    const src = code("app.js");
    expect(src).toContain('"/return"');
    expect(src).toContain("startPresenceEntry");
    expect(src).toContain("panel-presence-entry");
  });

  it("returns to the game shell after presence ready", () => {
    const src = code("app.js");
    expect(src).toContain("skald:presence-ready");
    expect(src).toContain('#/world/" + readyWorldId');
  });
});
