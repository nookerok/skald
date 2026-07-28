// @ts-nocheck
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dirname, "../public");

describe("discovery-view.js", () => {
  it("file exists and has expected exports", () => {
    const code = readFileSync(resolve(PUBLIC, "discovery-view.js"), "utf-8");
    expect(code).toContain("export async function loadDiscoveries");
    expect(code).toContain("export function renderDiscoveries");
  });

  it("discovery-view.js does not expose raw event types", () => {
    const code = readFileSync(resolve(PUBLIC, "discovery-view.js"), "utf-8");
    expect(code).not.toMatch(/ev\.type/);
    expect(code).not.toMatch(/event\.type/);
  });

  it("renders empty state text", () => {
    const code = readFileSync(resolve(PUBLIC, "discovery-view.js"), "utf-8");
    expect(code).toContain("Ты пока не заметил устойчивых закономерностей");
    expect(code).toContain("Продолжай наблюдать за ответами мира");
  });

  it("uses stage labels: trace, hypothesis, discovered", () => {
    const code = readFileSync(resolve(PUBLIC, "discovery-view.js"), "utf-8");
    expect(code).toContain('case "trace": return "След"');
    expect(code).toContain('case "hypothesis": return "Гипотеза"');
    expect(code).toContain('case "discovered": return "Открытие"');
  });

  it("dispatches skald:navigate on evidence click", () => {
    const code = readFileSync(resolve(PUBLIC, "discovery-view.js"), "utf-8");
    expect(code).toContain("skald:navigate");
  });
});
