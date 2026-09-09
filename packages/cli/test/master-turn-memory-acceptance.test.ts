import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, buildMasterTurnSceneContext } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

function campEvent(type: string, eventId: string, payload: unknown): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 0, correlationId: "bootstrap", causationId: null };
}

function campBootstrap(): DomainEvent[] {
  return [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: ["fence"], connections: {},
    }),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }),
    campEvent("WorldObjectPlaced", "boot-object-fence", {
      id: "fence", name: "Ограда", aliases: ["ограду", "оградой"], description: "Почерневшая ограда.",
      material: "wood", locationId: "camp", integrity: 100, temperature: 20, state: {},
    }),
    campEvent("ObjectObserved", "boot-fence-noticed", {
      objectId: "fence", observerId: "player", description: "Почерневшая ограда.",
    }),
  ];
}

describe("plan_7 transcript memory acceptance", () => {
  it("replica, clarification, reload, continuation, inquiry, return", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-memory-accept-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    const worldId = "memory-accept";
    store.createWorld({
      worldId,
      idempotencyKey: `create-${worldId}`,
      requestHash: `hash-${worldId}`,
      saveLabel: "Memory acceptance",
      characterName: "Tester",
      characterPresetId: "wanderer",
      worldTemplateId: "old_tower",
      characterWound: "none",
      characterPromise: "observe",
      characterPrinciple: "care",
      characterProfileVersion: 1,
      bootstrapEvents: [...buildBootstrapEvents("old_tower"), ...campBootstrap()],
    });
    const manager = new WorldRuntimeManager(store, null);
    const runtime: WorldRuntime = await manager.get(worldId);

    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const fence = scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    const target = { role: "target", observerRef: fence!.observerRef, surface: fence!.label };

    const queue: unknown[] = [
      {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваю её." },
        supportingClauses: [],
        target: { ...target },
        goal: "Осмотреть двор и разузнать о переправе",
        referents: [{ ...target }],
      },
      {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ней." },
        supportingClauses: [],
        target: { ...target },
        referents: [{ ...target }],
        ambiguity: { kind: "referent", question: "К ограде или ко двору?", candidates: ["Ограда", "Двор"] },
      },
      {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваю её." },
        supportingClauses: [],
        target: { ...target },
        referents: [{ ...target }],
        conversationRelation: "continuation",
      },
      {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваю её." },
        supportingClauses: [],
        target: { ...target },
        referents: [{ ...target }],
      },
    ];
    const seenPrompts: string[] = [];
    const router = {
      apiKey: "",
      chat: vi.fn(async (category: string, messages: { content: string }[]) => {
        if (category !== "interpret") return { text: "" };
        seenPrompts.push(messages[1]!.content);
        const next = queue.shift();
        if (!next) throw new Error("unexpected model call");
        return { text: JSON.stringify(next) };
      }),
    } as any;
    (runtime as { router: unknown }).router = router;

    const command = async (input: string, key: string): Promise<any> => {
      const response = await handleWorldCommand(runtime, { input, idempotencyKey: key });
      if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
      return JSON.parse(response.body);
    };
    const contextOf = (): ReturnType<typeof buildMasterConversationContext> =>
      buildMasterConversationContext(store.listRecentConversationTurns(worldId, { limit: 30 }), worldId);

    // 1. Inspect: action executes, goal persists.
    const t0 = runtime.projection.getSnapshot().time;
    const first = await command("Осмотрю её внимательно.", "mem-1");
    expect(first.ok).toBe(true);
    expect(first.conversationTurn).toMatchObject({ inputClass: "action" });
    expect(runtime.projection.getSnapshot().time).toBe(t0 + 1);
    expect(store.getConversationTurn(worldId, "mem-1")?.contextMetadata?.goal).toEqual({
      summary: "Осмотреть двор и разузнать о переправе",
    });
    expect(store.getConversationTurn(worldId, "mem-1")?.contextMetadata?.mentions).toEqual([
      { kind: "object", role: "target", label: "Ограда" },
    ]);

    // 2. Ask about it: the deterministic inquiry path answers read-only, no tick.
    // (Genuine questions stay deterministic; V2 inquiry plans are covered at
    // the validator/executor level and share the same metadata writer.)
    const second = await command("Что за ней скрывается?", "mem-2");
    expect(second.ok).toBe(true);
    expect(second.status).toBe("inquiry");
    expect(runtime.projection.getSnapshot().time).toBe(t0 + 1);

    // 3. Ambiguous move: clarification with persisted options.
    const third = await command("Подойду к ней.", "mem-3");
    expect(third.status).toBe("clarification");
    expect(third.question).toBe("К ограде или ко двору?");
    expect(third.conversationTurn).toMatchObject({ responseKind: "clarification" });
    expect(runtime.projection.getSnapshot().time).toBe(t0 + 1);
    const clarificationMeta = store.getConversationTurn(worldId, "mem-3")?.contextMetadata?.clarification;
    expect(clarificationMeta?.options).toEqual([
      { optionId: "option-1", label: "Ограда" },
      { optionId: "option-2", label: "Двор" },
    ]);

    // 4. Reload: a fresh store handle restores the pending question with options.
    const reloadedStore = createMultiWorldStore(dbPath);
    try {
      const reloaded = buildMasterConversationContext(
        reloadedStore.listRecentConversationTurns(worldId, { limit: 30 }),
        worldId,
      );
      expect(reloaded.pendingClarification).toEqual({
        question: "К ограде или ко двору?",
        options: [
          { optionId: "option-1", label: "Ограда" },
          { optionId: "option-2", label: "Двор" },
        ],
        turnSeq: 3,
      });
    } finally {
      reloadedStore.close();
    }

    // 5. Foreign inquiry: no tick, question stays open.
    const fourth = await command("Где я?", "mem-4");
    expect(fourth.status).toBe("inquiry");
    expect(runtime.projection.getSnapshot().time).toBe(t0 + 1);
    expect(contextOf().pendingClarification?.turnSeq).toBe(3);

    // 6. Short reply continues the same thought: executes, resolves, links.
    const fifth = await command("Осмотрю её внимательно.", "mem-5");
    expect(fifth.ok).toBe(true);
    expect(runtime.projection.getSnapshot().time).toBe(t0 + 2);
    expect(contextOf().pendingClarification).toBeNull();
    expect(store.getConversationTurn(worldId, "mem-5")?.contextMetadata?.continuation).toEqual({
      relation: "continues",
      clarificationTurnSeq: 3,
    });

    // 7. Return to the same referent: pronoun resolves, action executes.
    const sixth = await command("Осмотрю её ещё раз.", "mem-6");
    expect(sixth.ok).toBe(true);
    expect(runtime.projection.getSnapshot().time).toBe(t0 + 3);
    expect(store.getConversationTurn(worldId, "mem-6")?.contextMetadata?.mentions).toEqual([
      { kind: "object", role: "target", label: "Ограда" },
    ]);

    // 8. Transcript integrity: contiguous turns, unique keys, idempotent replay.
    const rows = store.listConversationTurns(worldId);
    expect(rows.map((row) => row.turnSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(6);
    expect(rows[2]).toMatchObject({ worldTimeBefore: t0 + 1, worldTimeAfter: t0 + 1 });
    const replay = JSON.parse((await handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "mem-4" })).body);
    expect(replay.replayed).toBe(true);
    const conflict = await handleWorldCommand(runtime, { input: "Другой текст.", idempotencyKey: "mem-4" });
    expect(conflict.statusCode).toBe(409);

    // 9. Observer safety: prompts carry no ids, coordinates or confidence.
    // Four model calls: steps 1, 3, 6, 7 (both genuine questions stay deterministic).
    expect(seenPrompts).toHaveLength(4);
    const promptText = seenPrompts.join("\n");
    expect(promptText).not.toMatch(/worldId|entityId|eventId|sourceEventIds|coordinates|confidence/);
    expect(promptText).toContain('"kind":"master_turn"');
    const refs = [...promptText.matchAll(/"(?:observerRef)":"([^"]+)"/g)].map((match) => match[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^(person|object|route|topic)_\d+$/);

    // 10. The last prompt binds the pronoun to the mentioned referent first.
    const lastBlock = JSON.parse(seenPrompts[seenPrompts.length - 1]!) as {
      pronounBindings: { pronoun: string; candidates: string[] }[];
    };
    const binding = lastBlock.pronounBindings.find((entry) => entry.pronoun === "ее");
    expect(binding?.candidates[0]).toBe(fence!.observerRef);

    store.close();
  });
});
