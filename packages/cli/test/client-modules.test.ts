import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { execFileSync } from "node:child_process";

const PUBLIC = resolve(import.meta.dirname, "../public");

describe("Browser JS syntax gate", () => {
  const jsFiles = readdirSync(PUBLIC).filter((f) => extname(f) === ".js");

  for (const file of jsFiles) {
    it(`${file} passes node --check`, () => {
      const filePath = resolve(PUBLIC, file);
      execFileSync(process.execPath, ["--check", filePath]);
    });
  }
});

describe("Browser ES modules — import link integrity", () => {
  it("journal-view.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "journal-view.js"), "utf-8");
    expect(code).toContain("export async function loadJournal");
    expect(code).toContain("export function renderJournal");
  });

  it("discovery-view.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "discovery-view.js"), "utf-8");
    expect(code).toContain("export async function loadDiscoveries");
    expect(code).toContain("export function renderDiscoveries");
  });

  it("guidance-view.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    expect(code).toContain("export async function loadGuidance");
    expect(code).toContain("export function applyGuidance");
    expect(code).toContain("export function renderGuidance");
  });

  it("guidance.css exists", () => {
    expect(existsSync(resolve(PUBLIC, "guidance.css"))).toBe(true);
    const css = readFileSync(resolve(PUBLIC, "guidance.css"), "utf-8");
    expect(css).toContain(".guidance-action");
    expect(css).toContain(".guidance-onboarding");
  });

  it("new-game-view.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "new-game-view.js"), "utf-8");
    expect(code).toContain("export async function initNewGame");
    expect(code).toContain("export function renderNewGame");
  });

  it("new-game-state.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "new-game-state.js"), "utf-8");
    expect(code).toContain("export function loadDraft");
    expect(code).toContain("export function saveDraft");
    expect(code).toContain("export function clearDraft");
  });

  it("new-game-view.js preserves pending request on retry", () => {
    const code = readFileSync(resolve(PUBLIC, "new-game-view.js"), "utf-8");
    expect(code).toContain("submitPendingRequest");
    expect(code).toContain("loadPendingRequest");
    expect(code).toContain("clearPendingRequest");
    expect(code).toContain("skald:new-game:pending");
  });

  it("new-game-view.js has start-over for terminal errors", () => {
    const code = readFileSync(resolve(PUBLIC, "new-game-view.js"), "utf-8");
    expect(code).toContain("terminal");
    expect(code).toContain("Начать заново");
  });

  it("new-game-view.js captures targetWorldId before clearing pending", () => {
    const code = readFileSync(resolve(PUBLIC, "new-game-view.js"), "utf-8");
    // Verify targetWorldId is saved and used as fallback in success block
    expect(code).toContain("const targetWorldId = result.world");
    expect(code).toContain('"#/world/" + targetWorldId');
  });

  it("all named imports in app.js actually exist in the target modules", () => {
    const appCode = readFileSync(resolve(PUBLIC, "app.js"), "utf-8");
    const stmts = appCode.matchAll(/import\s+\{\s*([^}]+)\s*\}\s*from\s+["']([^"']+)["']/g);
    for (const [, namesStr, importPath] of stmts) {
      const names = namesStr.split(",").map((n) => n.trim());
      const targetPath = resolve(PUBLIC, importPath);
      expect(existsSync(targetPath)).toBe(true);
      const targetCode = readFileSync(targetPath, "utf-8");

      for (const name of names) {
        const re = new RegExp(`export\\s+(async\\s+)?function\\s+${name}|export\\s+(const|let|var)\\s+${name}`);
        expect(targetCode.match(re)).not.toBeNull();
      }
    }
  });

  it("api-client.js exports match app.js expectations", () => {
    const code = readFileSync(resolve(PUBLIC, "api-client.js"), "utf-8");
    expect(code).toContain("export async function sendCommand");
    expect(code).toContain("export async function fetchState");
    expect(code).toContain("export function retryLast");
  });

  it("presentation-view.js exports match app.js expectations", () => {
    const code = readFileSync(resolve(PUBLIC, "presentation-view.js"), "utf-8");
    expect(code).toContain("export function renderTurn");
    expect(code).toContain("export function renderState");
    expect(code).toContain("export const renderDiagnostics");
  });

  it("belief renderer enforces schemaVersion 2 before rendering", () => {
    const code = readFileSync(resolve(PUBLIC, "belief-view.js"), "utf-8");
    expect(code).toContain("export function isBeliefModelV2");
    expect(code).toContain("model.schemaVersion === 2");
    expect(code).toContain("belief-unavailable");
  });

  it("belief validator rejects malformed nested relations and contradictions", async () => {
    const beliefViewPath = new URL("../public/belief-view.js", import.meta.url).href;
    const { isBeliefModelV2 } = await import(beliefViewPath);
    const base = { schemaVersion: 2, observerId: "player", beliefs: [], activeHypotheses: [], lastUpdated: 0 };
    expect(isBeliefModelV2({ ...base, knownRelations: [null], contradictions: [] })).toBe(false);
    expect(isBeliefModelV2({ ...base, knownRelations: [], contradictions: [null] })).toBe(false);
  });

  it("belief validator rejects malformed existence explanations", async () => {
    const beliefViewPath = new URL("../public/belief-view.js", import.meta.url).href;
    const { isBeliefModelV2 } = await import(beliefViewPath);
    const base = { schemaVersion: 2, observerId: "player", beliefs: [], activeHypotheses: [], knownRelations: [], contradictions: [], lastUpdated: 0 };
    const belief = { patternId: "x", displayName: "X", currentInterpretation: "x", confidence: 0.5, supportingEvidence: [], openHypotheses: [], lastObserved: 0, freshness: 1 };
    const explanation = { patternId: "x", confidence: 0.5, supportingFactors: [], weakeningFactors: [], criticalDependencies: [], collapseConditions: [] };
    expect(isBeliefModelV2({ ...base, beliefs: [{ ...belief, existenceExplanation: { ...explanation, collapseConditions: [null] } }] })).toBe(false);
    expect(isBeliefModelV2({ ...base, beliefs: [{ ...belief, existenceExplanation: explanation }] })).toBe(true);
  });

  it("player-facing list renderers do not fall back to internal identifiers", () => {
    const sidebar = readFileSync(resolve(PUBLIC, "world-sidebar-view.js"), "utf-8");
    const rail = readFileSync(resolve(PUBLIC, "context-rail-view.js"), "utf-8");
    expect(sidebar).not.toContain("item.id ||");
    expect(sidebar).not.toContain("item.kind ||");
    expect(sidebar).not.toContain("item.target ||");
    expect(rail).not.toContain("value.kind ||");
    expect(rail).not.toContain("value.target ||");
    expect(rail).not.toContain("value.id ||");
  });

  it("client-state.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "client-state.js"), "utf-8");
    expect(code).toContain("export const APP");
    expect(code).toContain("export const CMD");
    expect(code).toContain("export const JOURNAL");
    expect(code).toContain("export function createInitialState");
    expect(code).toContain("export function transition");
  });

  it("status-view.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "status-view.js"), "utf-8");
    expect(code).toContain("export function renderStatus");
    expect(code).toContain("export function renderJournalStatus");
  });



  it("visual shell preserves mobile navigation and overlay accessibility hooks", () => {
    const shell = readFileSync(resolve(PUBLIC, "game-shell-view.js"), "utf-8");
    const html = readFileSync(resolve(PUBLIC, "index.html"), "utf-8");
    const css = readFileSync(resolve(PUBLIC, "living-world.css"), "utf-8");
    expect(shell).toContain('target === "journal-overlay"');
    expect(shell).toContain('target === "context-knowledge"');
    expect(shell).toContain('event.key !== "Escape"');
    expect(shell).toContain('overlayOpeners');
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('aria-controls="context-knowledge"');
    expect(css).not.toContain(".command-retry{display:none}");
  });

  it("threads-view.js exists, exposes the panel renderer and never classifies or leaks internals", () => {
    const code = readFileSync(resolve(PUBLIC, "threads-view.js"), "utf-8");
    expect(code).toContain("export function renderThreadsPanel");
    expect(code).toContain("export function threadChangeTag");
    expect(code).toContain("Пока ты не заметил процессов, которые продолжаются во времени.");
    expect(code).toContain("Новая нить");
    expect(code).toContain("Изменилось");
    expect(code).toContain("Завершилось");
    expect(code).toContain("Требует проверки");
    expect(code).toContain("Есть противоречие");
    expect(code).toContain("Эта нить требует нового наблюдения.");
    expect(code).not.toContain("threadKey");
    expect(code).not.toContain("situation:");
    expect(code).not.toContain("onCommand");
  });

  it("game shell registers the threads tab and mobile target", () => {
    const html = readFileSync(resolve(PUBLIC, "index.html"), "utf-8");
    const shell = readFileSync(resolve(PUBLIC, "game-shell-view.js"), "utf-8");
    const rail = readFileSync(resolve(PUBLIC, "context-rail-view.js"), "utf-8");
    expect(html).toContain('data-context="threads"');
    expect(html).toContain('aria-controls="context-threads"');
    expect(html).toContain('data-mobile-target="context-threads"');
    expect(shell).toContain('target === "context-threads"');
    expect(rail).toContain('renderThreadsPanel');
    expect(rail).toContain('snapshot.observerThreads');
  });

  it("visual shell has no shipped D-pad or social CSS selectors", () => {
    const css = readFileSync(resolve(PUBLIC, "styles.css"), "utf-8");
    expect(css).not.toMatch(/#dpad|\.dir-btn|\.social-btn|#social-actions/);
  });

  it("UX-7.2 extracts activity and causal surfaces out of the main center into context tabs", () => {
    const html = readFileSync(resolve(PUBLIC, "index.html"), "utf-8");
    const shell = readFileSync(resolve(PUBLIC, "game-shell-view.js"), "utf-8");
    // The per-center lower-panels are gone; activity and causal live in rail tabs.
    expect(html).not.toContain('id="activity-panel"');
    expect(html).not.toContain('id="causal-panel"');
    expect(html).not.toContain("lower-panels");
    expect(html).toContain('data-context="activity"');
    expect(html).toContain('id="context-activity"');
    expect(html).toContain('data-context="causal"');
    expect(html).toContain('id="context-causal"');
    expect(shell).toContain('target === "context-activity"');
  });

  it("presentation-view.js does not expose raw event type in presentation rendering", () => {
    const code = readFileSync(resolve(PUBLIC, "presentation-view.js"), "utf-8");
    // renderTurn and renderState functions only use presentation data (pres.primary.text, state.*)
    // The renderDiagnostics module (diagnostics panel) intentionally shows ev.type — that is allowed.
    // Extract just the renderTurn and renderState function bodies to verify they don't leak event names.
    const renderTurnMatch = code.match(/export function renderTurn[\s\S]*?(?=\nexport )/);
    const renderStateMatch = code.match(/export function renderState[\s\S]*?(?=\nexport )/);
    if (renderTurnMatch) {
      expect(renderTurnMatch[0]).not.toMatch(/ev\.type/);
    }
    if (renderStateMatch) {
      expect(renderStateMatch[0]).not.toMatch(/ev\.type/);
    }
  });
});
