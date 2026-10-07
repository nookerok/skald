/**
 * Destination scene continuity (ADR-0039 follow-up / P0).
 *
 * After a journey the destination contact is materialized (present at its own
 * location) without duplicating contacts and without granting acquaintance:
 * «кто рядом?» shows the destination NPC and «подойти к смотрителю» resolves
 * as a fresh approach, while the old engagement is already cleared.
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

const deadRouter = () => ({ apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) }) as any;
const parse = (r: { statusCode: number; body: string }) => JSON.parse(r.body);

async function fresh(tag: string): Promise<{ store: ReturnType<typeof createMultiWorldStore>; runtime: WorldRuntime }> {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-dc-${tag}-`)), "events.sqlite"));
  const worldId = `dc-${tag}`;
  store.createWorld({
    worldId, idempotencyKey: `c-${worldId}`, requestHash: `h-${worldId}`, saveLabel: "DC",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" }),
  });
  const runtime = await new WorldRuntimeManager(store, deadRouter()).get(worldId);
  return { store, runtime };
}

describe("destination scene continuity", () => {
  it("materializes the destination contact and keeps acquaintance scoped", async () => {
    const { store, runtime } = await fresh("cont");
    try {
      const contacts = () => [...runtime.projection.getSnapshot().entities.values()]
        .filter((e) => e.components.contact)
        .map((e) => e.id);

      // All destination contacts exist in the world from the start, but only
      // the starting contact is KNOWN (no duplicate entity ids).
      const ids = contacts();
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("contact:riverwatch-gatekeeper");
      expect(ids).toContain("contact:waystation-keeper");

      // A destination contact is not present (nor resolvable) before travel.
      const early = parse(await handleWorldCommand(runtime, { input: "Подойти к смотрителю", idempotencyKey: "d1" }));
      expect(early.status).not.toBe("exec");

      // Approach the starting contact, then travel.
      parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "d2" }));
      expect(runtime.projection.getSnapshot().sceneEngagement?.state).toBe("near");
      parse(await handleWorldCommand(runtime, { input: "Иду к Речному Стражу", idempotencyKey: "d3" }));
      expect(runtime.projection.getSnapshot().sceneEngagement).toBeNull();
      for (let i = 0; i < 4 && runtime.projection.getSnapshot().activeJourneyId; i++) {
        parse(await handleWorldCommand(runtime, { input: "ждать", idempotencyKey: `w${i}` }));
      }
      expect(runtime.projection.getSnapshot().currentLocationId).toBe("riverwatch_city");

      // «кто рядом?» now shows the destination NPC.
      // «кто рядом?» now shows the destination NPC (name gated until known:
      // the observer-safe description carries the distinguishing feature).
      const nearby = parse(await handleWorldCommand(runtime, { input: "Кто рядом?", idempotencyKey: "d4" }));
      expect(String(nearby.inquiry?.answer ?? "")).toContain("ключей от ворот");

      // A fresh approach to the destination contact resolves and sets engagement.
      const approach = parse(await handleWorldCommand(runtime, { input: "Подойти к смотрителю", idempotencyKey: "d5" }));
      expect(JSON.stringify(approach)).toContain("Смотритель речных ворот");
      expect(runtime.projection.getSnapshot().sceneEngagement?.state).toBe("near");

      // No duplicate contact entities after all of this.
      const after = contacts();
      expect(new Set(after).size).toBe(after.length);
    } finally {
      store.close();
    }
  });
});
