/**
 * Command time & scene movement integration acceptance (ADR-0039, T7).
 *
 * One full session through the command path, then replay purity: world time,
 * current location, active journey, engagement and transcript survive a
 * rebuild, and idempotent retries create nothing.
 *
 * Deferred (not implemented, so not asserted here): proximity-GATED acts
 * (close inspection requires being near) and a withdraw/«отойти» operation —
 * both need their own slice.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, rebuildProjection } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

const deadRouter = () => ({ apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) }) as any;
const parse = (r: { statusCode: number; body: string }) => JSON.parse(r.body);

async function fresh(tag: string): Promise<{ store: ReturnType<typeof createMultiWorldStore>; runtime: WorldRuntime }> {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-t7-${tag}-`)), "events.sqlite"));
  const worldId = `t7-${tag}`;
  store.createWorld({
    worldId, idempotencyKey: `c-${worldId}`, requestHash: `h-${worldId}`, saveLabel: "T7",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" }),
  });
  const runtime = await new WorldRuntimeManager(store, deadRouter()).get(worldId);
  return { store, runtime };
}

describe("command time & movement integration acceptance (T7)", () => {
  it("runs the session and survives replay", async () => {
    const { store, runtime } = await fresh("session");
    const step = async (input: string, key: string) => {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const reply = parse(await handleWorldCommand(runtime, { input, idempotencyKey: key }));
      const after = runtime.projection.getSnapshot();
      const delta = runtime.bus.query().slice(eventsBefore);
      return { before, after, delta, reply };
    };
    try {
      // 1. read-only inquiry — no time, no events
      const q1 = await step("Где я?", "t7-1");
      expect(q1.reply.status).toBe("inquiry");
      expect(q1.after.time).toBe(q1.before.time);
      expect(q1.delta).toHaveLength(0);

      // 2. read-only inquiry
      const q2 = await step("Кто рядом?", "t7-2");
      expect(q2.after.time).toBe(q2.before.time);
      expect(q2.delta).toHaveLength(0);

      // 3. approach → +1, engagement near
      const a = await step("Подойти к перевозчику", "t7-3");
      expect(a.after.time).toBe(a.before.time + 1);
      expect(a.delta.filter((e) => e.type === "TickPassed")).toHaveLength(1);
      expect(a.after.sceneEngagement?.state).toBe("near");
      expect(a.delta.filter((e) => e.type === "ActionResolved" && (e.payload as any).result === "approach")).toHaveLength(1);

      // 4. reload (rebuild) preserves engagement, time, location
      const replayed = rebuildProjection(runtime.bus.query()).getSnapshot();
      expect(replayed.time).toBe(a.after.time);
      expect(replayed.eventNumber).toBe(a.after.eventNumber);
      expect(replayed.currentLocationId).toBe(a.after.currentLocationId);
      expect(replayed.sceneEngagement).toEqual(a.after.sceneEngagement);

      // 5. journey start → +1, engagement cleared
      const j = await step("Иду к Речному Стражу", "t7-5");
      expect(j.after.time).toBe(j.before.time + 1);
      expect(j.after.activeJourneyId).not.toBeNull();
      expect(j.after.sceneEngagement).toBeNull();

      // 6. unrelated command while traveling → 0, no pulse
      const blocked = await step("осматриваюсь", "t7-6");
      expect(blocked.reply.status).not.toBe("inquiry");
      expect(blocked.delta.some((e) => e.type === "ActionRejected")).toBe(true);
      expect(blocked.after.time).toBe(blocked.before.time);
      expect(blocked.delta.filter((e) => e.type === "TickPassed")).toHaveLength(0);

      // 7. interrupt → 0, journey cleared, still at origin
      const stop = await step("остановиться", "t7-7");
      expect(stop.delta.some((e) => e.type === "JourneyInterrupted")).toBe(true);
      expect(stop.after.time).toBe(stop.before.time);
      expect(stop.after.activeJourneyId).toBeNull();
      expect(stop.after.currentLocationId).toBe("river_waystation");

      // 8. restart journey → +1
      const j2 = await step("Иду к Речному Стражу", "t7-8");
      expect(j2.after.time).toBe(j2.before.time + 1);

      // 9. wait → +1, arrival
      const w = await step("ждать", "t7-9");
      expect(w.after.time).toBe(w.before.time + 1);
      expect(w.delta.filter((e) => e.type === "TickPassed")).toHaveLength(1);

      // 10. idempotent retry of an earlier turn → nothing new
      const timeBeforeRetry = runtime.projection.getSnapshot().time;
      const eventsBeforeRetry = runtime.bus.query().length;
      const retry = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "t7-3" }));
      expect(retry.replayed).toBe(true);
      expect(runtime.projection.getSnapshot().time).toBe(timeBeforeRetry);
      expect(runtime.bus.query().length).toBe(eventsBeforeRetry);

      // 11. replay purity after the whole session
      const live = runtime.projection.getSnapshot();
      const rebuilt = rebuildProjection(runtime.bus.query()).getSnapshot();
      expect(rebuilt.time).toBe(live.time);
      expect(rebuilt.eventNumber).toBe(live.eventNumber);
      expect(rebuilt.currentLocationId).toBe(live.currentLocationId);
      expect(rebuilt.activeJourneyId).toBe(live.activeJourneyId);
      expect(rebuilt.sceneEngagement).toEqual(live.sceneEngagement);
    } finally {
      store.close();
    }
  });
});
