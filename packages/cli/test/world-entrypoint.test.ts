import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultiWorldStore } from "../src/persistence/index.js";
import { buildBootstrapEvents } from "@skald/world";

function dbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "skald-entrypoint-")), "events.sqlite");
}

function createLivingWorld(store: ReturnType<typeof createMultiWorldStore>, worldId = "riverwatch-main"): void {
  store.createWorld({
    worldId,
    idempotencyKey: `create:${worldId}`,
    requestHash: `hash:${worldId}`,
    saveLabel: "Бассейн Речного Стража",
    characterName: "Вася",
    characterPresetId: "wanderer",
    worldTemplateId: "living_region",
    characterWound: "wound",
    characterPromise: "promise",
    characterPrinciple: "principle",
    characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents("living_region"),
  });
}

describe("world entrypoint and succession", () => {
  it("keeps the legacy event log untouched while selecting a primary compiled world", () => {
    const store = createMultiWorldStore(dbPath());
    const legacyBefore = store.loadEvents("legacy-world");
    createLivingWorld(store);

    expect(store.getPrimaryWorldId()).toBeNull();
    store.recordWorldSuccession({
      fromWorldId: "legacy-world",
      toWorldId: "riverwatch-main",
      reason: "pilot cutover",
    });
    store.setPrimaryWorld("riverwatch-main");

    expect(store.getPrimaryWorldId()).toBe("riverwatch-main");
    expect(store.getWorldSuccessor("legacy-world")).toBe("riverwatch-main");
    expect(store.loadEvents("legacy-world")).toEqual(legacyBefore);
    expect(store.getWorldRecord("riverwatch-main")).toEqual(expect.objectContaining({
      isPrimary: true,
      successorWorldId: null,
      templateId: "living_region",
    }));
    expect(store.listWorlds()[0]!.worldId).toBe("riverwatch-main");
    store.close();
  });

  it("rejects a succession to an inactive successor", () => {
    const store = createMultiWorldStore(dbPath());
    createLivingWorld(store, "inactive-target");
    store.setWorldStatus("inactive-target", "archived");
    expect(() => store.recordWorldSuccession({
      fromWorldId: "legacy-world",
      toWorldId: "inactive-target",
      reason: "should fail",
    })).toThrow(/not active/);
    store.close();
  });
});
