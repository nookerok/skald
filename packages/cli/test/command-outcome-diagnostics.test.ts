/**
 * Command outcome diagnostics coverage (ADR-0039, T6.1): every user turn emits
 * exactly one sanitized `command_outcome`, including rejection, clarification,
 * read-only inquiry and idempotent replay.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";

const deadRouter = () => ({ apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) }) as any;
const parse = (r: { statusCode: number; body: string }) => JSON.parse(r.body);

async function fresh(tag: string, entrypointId: string, sink: (e: any) => void) {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-t61-${tag}-`)), "events.sqlite"));
  const worldId = `t61-${tag}`;
  store.createWorld({
    worldId, idempotencyKey: `c-${worldId}`, requestHash: `h-${worldId}`, saveLabel: "T6.1",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents({ templateId: "living_region", entrypointId, backgroundId: "wanderer" }),
  });
  const runtime = await new WorldRuntimeManager(store, deadRouter(), sink).get(worldId);
  return { store, runtime };
}

describe("command_outcome coverage (T6.1)", () => {
  it("emits a rejected outcome for an absent-contact preflight rejection", async () => {
    const seen: any[] = [];
    const { store, runtime } = await fresh("reject", "southern_borough_arrival", (e) => seen.push(e));
    try {
      const r = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "k1" }));
      expect(r.status).toBe("action_rejection");
      const outcomes = seen.filter((e) => e.category === "command_outcome");
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ movementOutcome: "rejected", temporalCost: 0, tickPassedCount: 0, timePolicy: "preflight_rejection" });
    } finally {
      store.close();
    }
  });

  it("emits cost-0 read-only and clarification outcomes", async () => {
    const seen: any[] = [];
    const { store, runtime } = await fresh("read", "river_waystation_arrival", (e) => seen.push(e));
    try {
      parse(await handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "k1" }));
      parse(await handleWorldCommand(runtime, { input: "Подойду к нему", idempotencyKey: "k2" }));
      parse(await handleWorldCommand(runtime, { input: "осматриваюсь", idempotencyKey: "k3" }));
      const outcomes = seen.filter((e) => e.category === "command_outcome");
      expect(outcomes).toHaveLength(3);
      expect(outcomes[0]).toMatchObject({ movementOutcome: "none", temporalCost: 0, tickPassedCount: 0 });
      expect(outcomes[1]).toMatchObject({ movementOutcome: "clarification", temporalCost: 0 });
      expect(outcomes[2]).toMatchObject({ temporalCost: 1, tickPassedCount: 1 });
    } finally {
      store.close();
    }
  });

  it("emits a replayed outcome for an idempotent retry", async () => {
    const seen: any[] = [];
    const { store, runtime } = await fresh("replay", "river_waystation_arrival", (e) => seen.push(e));
    try {
      parse(await handleWorldCommand(runtime, { input: "осматриваюсь", idempotencyKey: "k1" }));
      seen.length = 0;
      const retry = parse(await handleWorldCommand(runtime, { input: "осматриваюсь", idempotencyKey: "k1" }));
      expect(retry.replayed).toBe(true);
      const outcomes = seen.filter((e) => e.category === "command_outcome");
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ replayed: true, temporalCost: 0 });
    } finally {
      store.close();
    }
  });
});
