/**
 * Journey continuation over HTTP (plan_9 §4).
 *
 * A started journey must be finishable with natural continuation phrases:
 * each one advances the active journey by exactly one online tick with no
 * LLM call and no new journey, until JourneyCompleted moves the player.
 * Repeating a key never advances twice; reload preserves the outcome.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

function createLivingWorld(store: ReturnType<typeof createMultiWorldStore>, worldId: string): void {
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: "Journey continuation",
    characterName: "Tester",
    characterPresetId: "wanderer",
    worldTemplateId: "living_region",
    characterWound: "none",
    characterPromise: "observe",
    characterPrinciple: "care",
    characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents("living_region"),
  });
}

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

describe("journey continuation over HTTP (plan_9 §4)", () => {
  it("finishes a started journey with continuation phrases and no model calls", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-journey-continue-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "journey-continue";
      createLivingWorld(store, worldId);
      const throwing = { apiKey: "", chat: vi.fn(() => { throw new Error("LLM must not be called"); }) } as any;
      const manager = new WorldRuntimeManager(store, throwing);
      const runtime: WorldRuntime = await manager.get(worldId);
      const command = async (input: string, key: string): Promise<any> =>
        parse(await handleWorldCommand(runtime, { input, idempotencyKey: key }));

      const started = await command("иду к Кромке Чёрного леса", "jc-start");
      expect(started.ok).toBe(true);
      const journeyId = runtime.projection.getSnapshot().activeJourneyId;
      expect(journeyId).not.toBeNull();
      const timeAfterStart = runtime.projection.getSnapshot().time;

      const first = await command("продолжаю путь", "jc-1");
      expect(first.ok).toBe(true);
      expect(first.conversationTurn).toBeDefined();
      expect(runtime.projection.getSnapshot().time).toBe(timeAfterStart + 1);
      expect(runtime.projection.getSnapshot().activeJourneyId).toBe(journeyId);
      expect(runtime.bus.query().filter((e) => e.type === "JourneyStarted")).toHaveLength(1);
      expect(runtime.bus.query().some((e) => e.type === "JourneyCompleted")).toBe(false);

      const second = await command("иду дальше", "jc-2");
      expect(second.ok).toBe(true);
      expect(JSON.stringify(second)).toContain("добрался");
      expect(runtime.projection.getSnapshot().currentLocationId).toBe("blackwood_edge");
      expect(runtime.projection.getSnapshot().activeJourneyId).toBeNull();
      expect(runtime.projection.getSnapshot().spatialKnowledge?.locations.get("blackwood_edge")?.knowledge).toBe("traversed");

      // The whole flow — start, continuations, arrival — never called the model.
      expect(throwing.chat).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it("never advances twice for one key and survives reload", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-journey-idem-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "journey-idem";
      createLivingWorld(store, worldId);
      const manager = new WorldRuntimeManager(store, null);
      const runtime: WorldRuntime = await manager.get(worldId);
      const command = async (input: string, key: string) =>
        handleWorldCommand(runtime, { input, idempotencyKey: key });

      await command("иду к Кромке Чёрного леса", "ji-start");
      await command("продолжаю путь", "ji-1");
      const before = {
        time: runtime.projection.getSnapshot().time,
        events: runtime.bus.query().length,
      };
      const replay = await command("продолжаю путь", "ji-1");
      expect(replay.statusCode).toBe(200);
      const replayed = JSON.parse(replay.body);
      expect(replayed.replayed).toBe(true);
      expect(runtime.projection.getSnapshot().time).toBe(before.time);
      expect(runtime.bus.query().length).toBe(before.events);

      await command("иду дальше", "ji-2");
      const completedLocation = runtime.projection.getSnapshot().currentLocationId;
      expect(completedLocation).toBe("blackwood_edge");

      const reopened = createMultiWorldStore(dbPath);
      try {
        const reloaded = await new WorldRuntimeManager(reopened, null).get(worldId);
        expect(reloaded.projection.getSnapshot().currentLocationId).toBe("blackwood_edge");
        expect(reloaded.projection.getSnapshot().activeJourneyId).toBeNull();
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  });

  it("does not consume a tick without an active journey", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-journey-noop-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "journey-noop";
      createLivingWorld(store, worldId);
      const manager = new WorldRuntimeManager(store, null);
      const runtime: WorldRuntime = await manager.get(worldId);
      const timeBefore = runtime.projection.getSnapshot().time;
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "продолжаю путь", idempotencyKey: "jn-1" }));
      expect(response.status).toBe("clarification");
      expect(runtime.projection.getSnapshot().time).toBe(timeBefore);
      expect(runtime.bus.query().length).toBe(eventsBefore);
    } finally {
      store.close();
    }
  });
});
