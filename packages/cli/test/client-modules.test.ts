import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dirname, "../public");

describe("Browser ES modules — import link integrity", () => {
  it("journal-view.js exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "journal-view.js"), "utf-8");
    expect(code).toContain("export async function loadJournal");
    expect(code).toContain("export function renderJournal");
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
