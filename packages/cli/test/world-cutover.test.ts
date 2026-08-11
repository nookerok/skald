import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultiWorldStore } from "../src/persistence/index.js";
import { buildCutoverPlan, runCutover, type CutoverOptions } from "../src/admin/world-cutover.js";

function options(dbPath: string, apply: boolean): CutoverOptions {
  return {
    dbPath,
    fromWorldId: "legacy-world",
    toWorldId: "riverwatch-main",
    saveLabel: "Бассейн Речного Стража",
    characterName: "Вася",
    characterPresetId: "wanderer",
    reason: "test cutover",
    apply,
  };
}

describe("Pilot Region world cutover", () => {
  it("has a safe dry-run with a deterministic bootstrap plan", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-cutover-test-")), "events.sqlite");
    const result = runCutover(options(dbPath, false));
    expect(result.applied).toBe(false);
    expect(result.plan.targetRegionId).toBe("riverwatch-basin");
    expect(result.plan.bootstrapEventCount).toBeGreaterThan(30);
    expect(result.primaryWorldId).toBeNull();
  });

  it("applies idempotently and verifies observer geometry", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-cutover-test-")), "events.sqlite");
    const first = runCutover(options(dbPath, true));
    const second = runCutover(options(dbPath, true));
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    expect(second.primaryWorldId).toBe("riverwatch-main");

    const store = createMultiWorldStore(dbPath);
    expect(store.getPrimaryWorldId()).toBe("riverwatch-main");
    expect(store.getWorldSuccessor("legacy-world")).toBe("riverwatch-main");
    expect(store.loadEvents("riverwatch-main").length).toBe(first.plan.bootstrapEventCount);
    store.close();
  });

  it("does not silently accept a wrong region binding", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-cutover-test-")), "events.sqlite");
    const plan = buildCutoverPlan(options(dbPath, false));
    expect(plan.targetTemplateId).toBe("living_region");
    expect(plan.targetRegionId).toBe("riverwatch-basin");
  });
});
