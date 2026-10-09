/**
 * Scene engagement actions (ADR-0039 §3): «отойти» clears the engagement,
 * deterministically and through the full command path.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, rebuildProjection } from "@skald/world";
import { parseIntent } from "@skald/intent-parser";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

const deadRouter = () => ({ apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) }) as any;
const parse = (r: { statusCode: number; body: string }) => JSON.parse(r.body);

async function fresh(tag: string): Promise<{ store: ReturnType<typeof createMultiWorldStore>; runtime: WorldRuntime }> {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-sea-${tag}-`)), "events.sqlite"));
  const worldId = `sea-${tag}`;
  store.createWorld({
    worldId, idempotencyKey: `c-${worldId}`, requestHash: `h-${worldId}`, saveLabel: "SEA",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" }),
  });
  const runtime = await new WorldRuntimeManager(store, deadRouter()).get(worldId);
  return { store, runtime };
}

describe("scene engagement actions", () => {
  it("parses «отойти» as the withdraw operation", () => {
    for (const phrase of ["отойти", "отойду", "отхожу", "отступить"]) {
      const intent = parseIntent(phrase);
      expect(intent.type).toBe("ActionIntentCommand");
      if (intent.type === "ActionIntentCommand") expect(intent.operation).toBe("withdraw");
    }
    for (const phrase of ["прошептать", "шепнуть", "шепчу"]) {
      const intent = parseIntent(phrase);
      expect(intent.type).toBe("ActionIntentCommand");
      if (intent.type === "ActionIntentCommand") expect(intent.operation).toBe("whisper");
    }
  });

  it("blocks a whisper without engagement", async () => {
    const { store, runtime } = await fresh("whisper");
    try {
      const w = parse(await handleWorldCommand(runtime, { input: "прошептать", idempotencyKey: "sh1" }));
      expect(JSON.stringify(w)).toContain("Шёпот");
      expect(runtime.projection.getSnapshot().sceneEngagement).toBeNull();
    } finally {
      store.close();
    }
  });

  it("«отойти» clears the engagement and answers honestly, deterministically", async () => {
    const { store, runtime } = await fresh("withdraw");
    try {
      parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "a1" }));
      expect(runtime.projection.getSnapshot().sceneEngagement?.state).toBe("near");

      const before = runtime.projection.getSnapshot().time;
      const w1 = parse(await handleWorldCommand(runtime, { input: "отойти", idempotencyKey: "w1" }));
      expect(runtime.projection.getSnapshot().time).toBe(before + 1);
      expect(runtime.projection.getSnapshot().sceneEngagement).toBeNull();
      expect(JSON.stringify(w1)).toContain("отходишь");

      const w2 = parse(await handleWorldCommand(runtime, { input: "отойти", idempotencyKey: "w2" }));
      expect(runtime.projection.getSnapshot().sceneEngagement).toBeNull();
      expect(JSON.stringify(w2)).toContain("не стоишь");

      // Reload: cleared state persists, no stale engagement.
      const rebuilt = rebuildProjection(runtime.bus.query()).getSnapshot();
      expect(rebuilt.sceneEngagement).toBeNull();
    } finally {
      store.close();
    }
  });
});
