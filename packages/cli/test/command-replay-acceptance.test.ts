/**
 * Idempotent replay acceptance (plan_9 §5): one contract for every
 * world-scoped mutating handler.
 *
 * - identical key+payload → HTTP 200 with the SAVED envelope, replayed:true;
 * - Event Log, world time and transcript never move on replay;
 * - conflicting payload → HTTP 409 with no changes;
 * - replay survives a server restart (durable envelope, not memory);
 * - action, inquiry, clarification and speech share the contract;
 * - replays never touch the gateway, the rules or narration scheduling.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, buildMasterTurnSceneContext } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
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
    campEvent("ObjectPlaced", "boot-object-carrier", {
      entityId: "carrier", x: 0, y: 0, name: "Перевозчик", aliases: ["перевозчика", "перевозчику"],
      description: "Перевозчик у переправы.", components: { contact: { locationId: "camp", backgroundId: "wanderer" } },
    }),
    campEvent("RelationChanged", "boot-relation-carrier", {
      from: "player", to: "carrier", kind: "help", delta: 1,
    }),
  ];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

describe("idempotent replay acceptance (plan_9 §5)", () => {
  it("one contract for action, inquiry, clarification and speech", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-replay-accept-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "replay-accept";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Replay acceptance",
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
      const command = async (input: string, key: string) =>
        handleWorldCommand(runtime, { input, idempotencyKey: key });

      // Action + inquiry + clarification need no model at all.
      const action = parse(await command("Осматриваю ограду.", "rk-action"));
      expect(action.ok).toBe(true);
      expect(action.conversationTurn).toMatchObject({ inputClass: "action" });
      expect(action.replayed).toBeUndefined();

      const inquiry = parse(await command("где я?", "rk-inquiry"));
      expect(inquiry.status).toBe("inquiry");
      expect(inquiry.conversationTurn).toMatchObject({ inputClass: "inquiry" });

      const clarification = parse(await command("абракадабра", "rk-clarify"));
      expect(clarification.status).toBe("clarification");
      expect(clarification.conversationTurn).toMatchObject({ inputClass: "clarification" });

      // Speech executes through one validated plan; the scene must resolve
      // the addressee as a known person for it.
      const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
      const carrier = scene.context.knownPeople.find((person) => person.label === "Перевозчик");
      expect(carrier).toBeDefined();
      const target = { role: "addressee", observerRef: carrier!.observerRef, surface: carrier!.label };
      const interpretCalls: string[] = [];
      const narrateCalls: string[] = [];
      (runtime as { router: unknown }).router = {
        apiKey: "",
        chat: vi.fn(async (category: string) => {
          if (category === "interpret") {
            interpretCalls.push(category);
            return {
              text: JSON.stringify({
                schemaVersion: 2,
                kind: "speech",
                primaryIntent: { kind: "speech", utterance: "Нам нужен проводник.", sourceText: "Говорю: нам нужен проводник." },
                supportingClauses: [],
                addressedEntity: { ...target },
                referents: [{ ...target }],
              }),
            };
          }
          narrateCalls.push(category);
          return { text: "" };
        }),
      } as any;
      const speech = parse(await command("Говорю: нам нужен проводник.", "rk-speech"));
      expect(speech.ok).toBe(true);
      expect(speech.conversationTurn).toMatchObject({ inputClass: "speech" });
      expect(interpretCalls).toHaveLength(1);

      // From here on nothing may reach the model, the rules or narration.
      (runtime as { router: unknown }).router = {
        apiKey: "",
        chat: vi.fn(() => { throw new Error("no model calls on replay"); }),
      } as any;
      await sleep(50);
      const narrationsScheduled = narrateCalls.length;

      const firsts: Record<string, any> = { action, inquiry, clarification, speech };
      const keys: Record<string, { input: string; key: string }> = {
        action: { input: "Осматриваю ограду.", key: "rk-action" },
        inquiry: { input: "где я?", key: "rk-inquiry" },
        clarification: { input: "абракадабра", key: "rk-clarify" },
        speech: { input: "Говорю: нам нужен проводник.", key: "rk-speech" },
      };
      for (let round = 0; round < 10; round += 1) {
        for (const kind of Object.keys(keys)) {
          const { input, key } = keys[kind]!;
          const timeBefore = runtime.projection.getSnapshot().time;
          const eventsBefore = runtime.bus.query().length;
          const turnsBefore = store.listConversationTurns(worldId).length;
          const replayed = parse(await command(input, key));
          expect(replayed.replayed).toBe(true);
          expect(replayed).toEqual({ ...firsts[kind], replayed: true });
          expect(runtime.projection.getSnapshot().time).toBe(timeBefore);
          expect(runtime.bus.query().length).toBe(eventsBefore);
          expect(store.listConversationTurns(worldId)).toHaveLength(turnsBefore);
        }
      }
      expect(interpretCalls).toHaveLength(1);
      await sleep(50);
      expect(narrateCalls).toHaveLength(narrationsScheduled);

      // A reused key with a different payload is always a conflict.
      for (const kind of Object.keys(keys)) {
        const { key } = keys[kind]!;
        const conflict = await command(`другой текст ${kind}`, key);
        expect(conflict.statusCode).toBe(409);
      }
      expect(store.listConversationTurns(worldId)).toHaveLength(4);

      // Replay survives a server restart: durable envelope, not memory.
      const reopened = createMultiWorldStore(dbPath);
      try {
        const reloaded = await new WorldRuntimeManager(reopened, null).get(worldId);
        for (const kind of Object.keys(keys)) {
          const { input, key } = keys[kind]!;
          const replayed = parse(await handleWorldCommand(reloaded, { input, idempotencyKey: key }));
          expect(replayed.replayed).toBe(true);
          expect(replayed).toEqual({ ...firsts[kind], replayed: true });
        }
        expect(reopened.listConversationTurns(worldId)).toHaveLength(4);
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  });

  it("replays wait and advance envelopes without new ticks", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-replay-wait-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "replay-wait";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Replay wait",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents("old_tower"),
      });
      const manager = new WorldRuntimeManager(store, null);
      const runtime: WorldRuntime = await manager.get(worldId);

      const first = parse(await handleWorldCommand(runtime, { input: "wait", idempotencyKey: "rw-1" }));
      expect(first.ok).toBe(true);
      const timeAfter = runtime.projection.getSnapshot().time;
      const eventsAfter = runtime.bus.query().length;
      for (let round = 0; round < 5; round += 1) {
        const replayed = parse(await handleWorldCommand(runtime, { input: "wait", idempotencyKey: "rw-1" }));
        expect(replayed.replayed).toBe(true);
        expect(replayed).toEqual({ ...first, replayed: true });
      }
      expect(runtime.projection.getSnapshot().time).toBe(timeAfter);
      expect(runtime.bus.query().length).toBe(eventsAfter);

      const restarted = createMultiWorldStore(dbPath);
      try {
        const reloaded = await new WorldRuntimeManager(restarted, null).get(worldId);
        const replayed = parse(await handleWorldCommand(reloaded, { input: "wait", idempotencyKey: "rw-1" }));
        expect(replayed.replayed).toBe(true);
        expect(reloaded.projection.getSnapshot().time).toBe(timeAfter);
      } finally {
        restarted.close();
      }
    } finally {
      store.close();
    }
  });
});
