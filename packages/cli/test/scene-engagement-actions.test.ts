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


  it("whispers through the command path after giving an item deepens engagement", async () => {
    const { store, runtime } = await fresh("whisper-engaged");
    try {
      await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "approach" });
      expect(runtime.projection.getSnapshot().sceneEngagement?.state).toBe("near");

      const given = parse(await handleWorldCommand(runtime, { input: "отдать обломок перевозчику", idempotencyKey: "give" }));
      expect(runtime.projection.getSnapshot().sceneEngagement?.state).toBe("engaged");
      expect(given.presentation.primary?.text).toContain("передаёшь");
      expect(given.conversationTurn.responseText).toContain("передаёшь");

      const eventCount = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "прошептать", idempotencyKey: "whisper" }));
      const committed = runtime.bus.query().slice(eventCount);
      expect(committed).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "ActionResolved", payload: expect.objectContaining({ result: "whisper" }) }),
      ]));
      expect(response.ok).toBe(true);
      expect(JSON.stringify(response)).toContain("Ты говоришь тихо");
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

  it("binds a named withdraw to the engaged contact without leaking its reference", async () => {
    const { store, runtime } = await fresh("withdraw-named");
    try {
      await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "approach" });
      const beforeTime = runtime.projection.getSnapshot().time;
      const beforeEventCount = runtime.bus.query().length;

      const wrongTarget = parse(await handleWorldCommand(runtime, {
        input: "Отхожу от смотрителя.",
        idempotencyKey: "withdraw-wrong-target",
      }));
      expect(wrongTarget.conversationTurn.responseKind).toBe("clarification");
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(runtime.projection.getSnapshot().sceneEngagement?.state).toBe("near");
      expect(runtime.bus.query()).toHaveLength(beforeEventCount);

      const response = parse(await handleWorldCommand(runtime, {
        input: "Отхожу от перевозчика.",
        idempotencyKey: "withdraw-named",
      }));
      const committed = runtime.bus.query().slice(beforeEventCount);

      expect(runtime.projection.getSnapshot().time).toBe(beforeTime + 1);
      expect(runtime.projection.getSnapshot().sceneEngagement).toBeNull();
      expect(committed).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "ActionResolved", payload: expect.objectContaining({ result: "withdraw" }) }),
        expect.objectContaining({ type: "TickPassed" }),
      ]));
      expect(committed.filter((event) => event.type === "TickPassed")).toHaveLength(1);
      expect(response.conversationTurn.responseText).toContain("отходишь");
      expect(JSON.stringify(response)).not.toMatch(/targetRef|contactRef|establishedAt|internalId|person_/iu);
    } finally {
      store.close();
    }
  });

  it("does not spend a turn when a named withdraw has no current engagement", async () => {
    const { store, runtime } = await fresh("withdraw-unengaged");
    try {
      const beforeTime = runtime.projection.getSnapshot().time;
      const beforeEvents = runtime.bus.query();
      const response = parse(await handleWorldCommand(runtime, {
        input: "Отхожу от перевозчика.",
        idempotencyKey: "withdraw-unengaged",
      }));

      expect(response.conversationTurn.responseKind).toBe("clarification");
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(runtime.bus.query()).toEqual(beforeEvents);
      expect(runtime.projection.getSnapshot().sceneEngagement).toBeNull();
    } finally {
      store.close();
    }
  });
});
