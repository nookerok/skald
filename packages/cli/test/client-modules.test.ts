import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dirname, "../public");

describe("Browser ES modules — import link integrity", () => {
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
});
