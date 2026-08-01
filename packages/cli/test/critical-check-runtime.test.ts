import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore, LEGACY_WORLD_ID } from "../src/persistence.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { runCommandCycleForRuntime } from "../src/http/world-handlers.js";
import { createPersistentApp, runCommandCycle } from "../src/index.js";

const enterInput = String.fromCharCode(1074,1086,1081,1090,1080,32,1074,32,1072,1096,1085,1102,1102);
const forceInput = String.fromCharCode(1085,1072,1074,1072,1083,1080,1090,1100,1089,1103,32,1085,1072,32,1087,1077,1090,1083,1080);

describe("production critical-check command cycle", () => {
  it("commits request, roll and resolution in one durable batch and replays after reload", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-critical-runtime-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    store.createWorld({
      worldId: "critical-test",
      idempotencyKey: "create-critical-test",
      requestHash: "critical-test-hash",
      saveLabel: "Critical test",
      characterName: "Tester",
      characterPresetId: "wanderer",
      worldTemplateId: "old_tower",
      characterWound: "none",
      characterPromise: "observe",
      characterPrinciple: "care",
      characterProfileVersion: 1,
      bootstrapEvents: buildBootstrapEvents("old_tower"),
    });

    const originalCommit = store.commitBatch.bind(store);
    let commitCalls = 0;
    store.commitBatch = ((worldId, events, options) => {
      commitCalls++;
      originalCommit(worldId, events, options);
    }) as typeof store.commitBatch;

    try {
      const manager = new WorldRuntimeManager(store);
      const runtime = await manager.get("critical-test");
      const enter = await runCommandCycleForRuntime(runtime, enterInput, "enter-key");
      expect("statusCode" in enter).toBe(false);

      const beforeForceCommits = commitCalls;
      const force = await runCommandCycleForRuntime(runtime, forceInput, "force-key");
      expect("statusCode" in force).toBe(false);
      const forceResult = force as { events: Array<{ type: string }> };
      const forceTypes = forceResult.events.map((event) => event.type);
      expect(forceTypes).toContain("CriticalCheckRequested");
      expect(forceTypes).toContain("CriticalCheckRolled");
      expect(forceTypes).toContain("CriticalCheckResolved");
      expect(commitCalls - beforeForceCommits).toBe(1);
      expect(runtime.projection.getSnapshot().pendingChecks.size).toBe(0);

      const beforeReplay = store.loadEvents("critical-test");
      manager.evict("critical-test");
      const replayed = await manager.get("critical-test");
      expect(replayed.bus.query()).toEqual(beforeReplay);
      expect(replayed.projection.getSnapshot().pendingChecks.size).toBe(0);
    } finally {
      store.close();
    }
  });

  it("persistent CLI command cycle commits critical-check continuation atomically", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-critical-cli-")), "events.sqlite");
    const app = createPersistentApp({ dbPath });
    const setupEvents = buildBootstrapEvents("old_tower");
    app.store!.commitBatch(LEGACY_WORLD_ID, setupEvents);
    for (const event of setupEvents) {
      app.bus.append(event);
      app.projection.apply(event);
    }
    const store = app.store!;
    const originalCommit = store.commitBatch.bind(store);
    let commitCalls = 0;
    store.commitBatch = ((worldId, events, options) => {
      commitCalls++;
      originalCommit(worldId, events, options);
    }) as typeof store.commitBatch;

    try {
      const enter = runCommandCycle(app, enterInput, "enter-key");
      expect("type" in enter).toBe(false);
      const beforeForceCommits = commitCalls;
      const force = runCommandCycle(app, forceInput, "force-key");
      expect("type" in force).toBe(false);
      const forceTypes = (force as { events: Array<{ type: string }> }).events.map((event) => event.type);
            expect(forceTypes).toContain("CriticalCheckRequested");
      expect(forceTypes).toContain("CriticalCheckRolled");
      expect(forceTypes).toContain("CriticalCheckResolved");
      expect(commitCalls - beforeForceCommits).toBe(1);
    } finally {
      store.close();
    }
  });
});
