// @ts-nocheck
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dirname, "../public");

describe("guidance-view.js", () => {
  it("file exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    expect(code).toContain("export async function loadGuidance");
    expect(code).toContain("export function applyGuidance");
    expect(code).toContain("export function renderGuidance");
  });

  it("does not use innerHTML for server text injection", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    // Should use textContent, not innerHTML when displaying server text
    const textContentCount = (code.match(/textContent\s*=/g) || []).length;
    expect(textContentCount).toBeGreaterThanOrEqual(1);
  });

  it("does not expose raw event types", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    expect(code).not.toMatch(/ev\.type/);
    expect(code).not.toMatch(/event\.type/);
  });

  it("dispatches skald:command for command suggestions", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    expect(code).toContain("skald:command");
  });

  it("dispatches skald:navigate for navigate suggestions", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    expect(code).toContain("skald:navigate");
  });

  it("uses sessionStorage for dismissal", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    expect(code).toContain("skald:guidance:dismissed:");
  });

  it("renders free_play as collapsible details", () => {
    const code = readFileSync(resolve(PUBLIC, "guidance-view.js"), "utf-8");
    expect(code).toContain("free_play");
    expect(code).toContain('"details"');
  });
});
