/**
 * Conversational memory (full-master Stage 4).
 *
 * A focused deterministic question leaves the same semantic hook an accepted
 * plan does, and a mention never becomes a local referent once the player has
 * left the scene where it was confirmed.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
} from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import type { ConversationTurn } from "../src/conversation/types.js";

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

function moveEvent(locationId: string, timestamp = 5): DomainEvent {
  return { eventId: "move-city", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId }, timestamp, correlationId: "move", causationId: null };
}

describe("conversation memory — focused questions", () => {
  it("records the referent a deterministic focused question names", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-memory-focus-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "memory-focus";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Memory focus",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "living_region",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents("living_region"),
      });
      const throwing = { apiKey: "", chat: () => { throw new Error("model down"); } } as any;
      const runtime = await new WorldRuntimeManager(store, throwing).get(worldId);

      // Observe the fence so it is a confirmed visible object.
      expect(parse(await handleWorldCommand(runtime, { input: "осматриваю ограду", idempotencyKey: "mf-1" })).ok).toBe(true);

      const inquiry = parse(await handleWorldCommand(runtime, { input: "что я знаю об ограде?", idempotencyKey: "mf-2" }));
      expect(inquiry.status).toBe("inquiry");
      const turn = store.getConversationTurn(worldId, "mf-2");
      expect(turn?.contextMetadata?.mentions).toEqual([
        { kind: "object", role: "target", label: "Ограда переправы" },
      ]);
    } finally {
      store.close();
    }
  });

  it("keeps a mention as a label but never re-binds it once the scene changes", () => {
    const projection = new WorldProjector();
    const bus = new EventBus();
    for (const entry of [...buildBootstrapEvents("living_region"), moveEvent("riverwatch_city")]) {
      projection.apply(entry);
      bus.append(entry);
    }
    const scene = buildMasterTurnSceneContext(bus.query(), projection.getSnapshot()).context;
    expect(scene.knownPeople).toHaveLength(0);

    const stored = {
      worldId: "memory-provenance",
      turnSeq: 1,
      correlationId: "conversation:p-1",
      idempotencyKey: "p-1",
      playerText: "спрашиваю перевозчика о реке",
      inputClass: "speech",
      worldTimeBefore: 0,
      worldTimeAfter: 1,
      responseKind: "speech_reaction",
      responseText: "Ты обращаешься к «Перевозчик у переправы».",
      contextMetadata: {
        schemaVersion: 1,
        mentions: [{ kind: "person", role: "addressee", label: "Перевозчик у переправы" }],
      },
    } as unknown as ConversationTurn;

    const context = buildMasterConversationContext([stored], "memory-provenance", { scene });
    const mention = context.recentlyMentionedEntities.find((entry) => entry.label === "Перевозчик у переправы");
    // The memory keeps the confirmed name...
    expect(mention).toBeDefined();
    // ...but it is not re-bound to a local referent in the new scene.
    expect(mention?.observerRef).toBeUndefined();
  });

  it("keeps the confirmed referent across reload and continues it with a pronoun", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-memory-scenario-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "memory-scenario";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Memory scenario",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "living_region",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents("living_region"),
      });
      const throwing = { apiKey: "", chat: () => { throw new Error("model down"); } } as any;
      const runtime = await new WorldRuntimeManager(store, throwing).get(worldId);

      // 1. Confirm the referent with a deterministic speech turn.
      parse(await handleWorldCommand(runtime, { input: "спрашиваю перевозчика о старом русле", idempotencyKey: "sc-1" }));
      expect(store.getConversationTurn(worldId, "sc-1")?.contextMetadata?.mentions).toEqual([
        { kind: "person", role: "target", label: "Перевозчик у переправы" },
      ]);

      // 2. Reload: a fresh store handle rebuilds the same context.
      const reloaded = createMultiWorldStore(dbPath);
      try {
        const turns = reloaded.listRecentConversationTurns(worldId, { limit: 30 });
        const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot()).context;
        const context = buildMasterConversationContext(turns, worldId, { scene });
        const mention = context.recentlyMentionedEntities.find((entry) => entry.label === "Перевозчик у переправы");
        expect(mention?.observerRef).toBe("person_1");
      } finally {
        reloaded.close();
      }

      // 3. A pronoun continues the confirmed referent, not a new one.
      const ask = parse(await handleWorldCommand(runtime, { input: "а что за ним?", idempotencyKey: "sc-2" }));
      expect(ask.status).toBe("inquiry");
      expect(ask.inquiry.answer).toMatch(/перевозчик/i);
    } finally {
      store.close();
    }
  });

  it("records a stated goal as an interpretation, never a world fact", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-memory-goal-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "memory-goal";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Memory goal",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "living_region",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents("living_region"),
      });
      const throwing = { apiKey: "", chat: () => { throw new Error("model down"); } } as any;
      const runtime = await new WorldRuntimeManager(store, throwing).get(worldId);

      parse(await handleWorldCommand(runtime, { input: "хочу осмотреть ограду", idempotencyKey: "mg-1" }));
      const meta = store.getConversationTurn(worldId, "mg-1")?.contextMetadata;
      expect(meta?.goal).toEqual({ summary: "хочу осмотреть ограду" });

      const turns = store.listRecentConversationTurns(worldId, { limit: 30 });
      const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot()).context;
      const context = buildMasterConversationContext(turns, worldId, { scene });
      expect(context.activePlayerGoal?.summary).toBe("хочу осмотреть ограду");
      // A goal is an interpretation, never a world fact.
      expect(context.knownFacts.map((fact) => fact.text)).not.toContain("хочу осмотреть ограду");
      expect(context.knownUncertainties.map((fact) => fact.text)).not.toContain("хочу осмотреть ограду");
    } finally {
      store.close();
    }
  });
});
