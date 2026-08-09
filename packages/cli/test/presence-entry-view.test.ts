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

  it("keeps stale-memory diagnostics out of the player return surface", () => {
    const src = code("presence-view.js");
    expect(src).toContain("selectPresenceHighlights");
    expect(src).toContain("presence-highlights");
    expect(src).not.toContain("presence-doubt");
    expect(src).not.toContain("presence-stale-line");
    expect(src).not.toContain("presence-dormant-line");
  });

  it("limits the return surface to at most two concrete signals", async () => {
    const { selectPresenceHighlights } = await import("../public/presence-view.js");
    const highlights = selectPresenceHighlights({
      statements: [
        { source: "belief_freshness", text: "Память о преграде ослабла." },
        { source: "known_thread", text: "История осталась без продолжения." },
        { source: "belief_contradiction", text: "Граница пути изменилась." },
      ],
      presence: {
        nearbyChanges: [{ description: "На дороге появился след." }, { description: "На дороге появился след." }],
        focus: { ambientDescription: "В воздухе чувствуется тепло." },
      },
    });
    expect(highlights).toEqual([
      "На дороге появился след.",
      "Граница пути изменилась.",
    ]);
    expect(highlights).toHaveLength(2);
  });

  it("derives rendering exclusively from backend-provided fields", () => {
    const src = code("presence-view.js");
    expect(src).not.toContain("fetch(");
    expect(src).not.toMatch(/Math\./);
    expect(src).not.toContain("eventNumber");
    expect(src).not.toContain("toLocaleDateString");
  });
  it("combines return and focus context into one surface with one action", () => {
    const src = code("presence-view.js");
    expect(src).toContain("presence-return-context");
    expect(src).toContain("focus.ambientDescription");
    expect(src).toContain("focus.sensoryCues");
    expect(src).toContain('enterBtn.textContent = mode === "first" ? "Войти в мир" : "Продолжить"');
    expect(src).toContain("skald:presence-ack");
    expect(src).not.toContain("presence-continue-btn");
  });
});

describe("focus-view.js", () => {
  it("file exists and has expected exports", () => {
    expect(code("focus-view.js")).toContain("export function renderFocusView");
  });

  it("renders only real focus fields and skips null blocks", () => {
    const src = code("focus-view.js");
    expect(src).toContain("if (focus && focus.ambientDescription)");
    expect(src).toContain("if (focus && focus.sensoryCues && focus.sensoryCues.length > 0)");
    expect(src).toContain("if (focus && focus.rememberedContext && focus.rememberedContext.length > 0)");
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
    expect(src).toContain('code === "stale_revision" || code === "duplicate_request"');
    expect(src).toContain("RELOAD_SESSION");
  });

  it("unlocks the game shell only through the ready signal", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain("skald:presence-ready");
    expect(src).not.toContain("interactionReady = true");
  });

  it("uses the honest loading phrases mapped to phases", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain("loadingTextForPhase");
    expect(src).not.toContain("Разбираем намерение");
    expect(src).not.toContain("Собираем последствия");
  });

  it("uses one primary acknowledge action on the unified return surface", () => {
    const src = code("presence-entry-controller.js");
    expect(src).toContain("skald:presence-ack");
    expect(src).toContain("state.phase !== PHASE.PRESENCE");
    expect(src).not.toContain("skald:presence-continue");
  });
});

describe("presence-entry.css", () => {
  it("gives the unified enter button a 44px touch target", () => {
    const css = code("presence-entry.css");
    expect(css).toContain(".presence-enter-btn");
    expect(css).toMatch(/\.presence-enter-btn\s*\{[^}]*min-height:\s*48px/s);
  });

  it("keeps the hidden presence panel out of the layout", () => {
    expect(code("presence-entry.css")).toContain("#panel-presence-entry[hidden] { display:none; }");
  });

  it("extends the full-width mobile layout to the unified enter button", () => {
    const css = code("presence-entry.css");
    const mobile = css.slice(css.indexOf("@media (max-width:600px)"));
    expect(mobile).toContain(".presence-enter-btn { width:100%; }");
  });
});

describe("app.js boot flash", () => {
  it("covers the static shell frame with the loading dialog until the first snapshot", () => {
    const src = code("app.js");
    expect(src).toContain("setShellLoading(true)");
    expect(src).toContain("refreshShell()");
    expect(src).toContain("setShellLoading(false)");
  });
});

describe("presence-exit-controller.js duplicate handling", () => {
  it("treats a 409 duplicate_request as an already-recorded exit, never a false error", () => {
    const src = code("presence-exit-controller.js");
    const duplicateBranch = src.slice(src.indexOf('code === "duplicate_request"'));
    expect(duplicateBranch).toContain("hideOverlay()");
    expect(duplicateBranch).toContain("skald:exit-ready");
    expect(duplicateBranch).toContain("clearExitPending");
    expect(duplicateBranch).not.toContain("Не удалось зафиксировать точку возвращения.");
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

  it("gates the game shell behind the browser-session lease", () => {
    const src = code("app.js");
    expect(src).toContain("hasPresenceLease");
    expect(src).toContain("resolveWorldRoute");
    expect(src).toContain('window.location.replace("#/world/" + worldId + "/return")');
  });

  it("routes the new world to the return path after creation", () => {
    const src = code("new-game-view.js");
    expect(src).toContain('"#/world/" + targetWorldId + "/return"');
  });

  it("wires the graceful exit flow and blocks commands while leaving", () => {
    const src = code("app.js");
    expect(src).toContain("initExitFlow");
    expect(src).toContain("requestLeave");
    expect(src).toContain("isExitInProgress()");
    expect(src).toContain("exit-world-btn");
    expect(src).toContain("skald:exit-ready");
  });

  it("serves the presence modules from the static whitelist", () => {
    const src = code("../src/http-server.ts");
    expect(src).toContain('"/presence-lease.js"');
    expect(src).toContain('"/presence-route.js"');
    expect(src).toContain('"/presence-exit-state.js"');
    expect(src).toContain('"/presence-exit-controller.js"');
  });
});
