/**
 * Contact approach over HTTP (npc-close-approach phase 1).
 *
 * The six exact acceptance replicas plus the review matrix: local approach
 * outcomes for present contacts, absence refusal for another-location
 * contact, pronoun continuation, the model-authored mixed entry, a
 * read-only question, the journey path, two same-name contacts, one tick
 * per command, one outcome per action, unchanged relations/knowledge,
 * replay purity and idempotency.
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

const APPROACH_TEXT = "Ты подходишь ближе. Перед тобой — Перевозчик у переправы.";
const WARDEN_TEXT = "Ты подходишь ближе. Перед тобой — Староста южного посада.";

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

function deadRouter() {
  return { apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) } as any;
}

function scriptedRouter(proposals: readonly unknown[]) {
  const queue = [...proposals];
  const last = proposals[proposals.length - 1];
  return {
    apiKey: "",
    chat: vi.fn(async (category: string) => {
      if (category === "interpret") {
        const next = queue.length > 0 ? queue.shift()! : last;
        return { text: typeof next === "string" ? next : JSON.stringify(next) };
      }
      return { text: "" };
    }),
  } as any;
}

async function freshRuntime(
  dbTag: string,
  worldId: string,
  router: any,
  bootstrapEvents = buildBootstrapEvents("living_region"),
): Promise<{ store: ReturnType<typeof createMultiWorldStore>; runtime: WorldRuntime }> {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-ca-${dbTag}-`)), "events.sqlite"));
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: "Contact approach",
    characterName: "Tester",
    characterPresetId: "wanderer",
    worldTemplateId: "living_region",
    characterWound: "none",
    characterPromise: "observe",
    characterPrinciple: "care",
    characterProfileVersion: 1,
    bootstrapEvents,
  });
  const runtime: WorldRuntime = await new WorldRuntimeManager(store, router).get(worldId);
  return { store, runtime };
}

function approachOutcomes(runtime: WorldRuntime, fromIndex: number): any[] {
  return runtime.bus.query()
    .slice(fromIndex)
    .filter((event) => event.type === "ActionResolved" && (event.payload as any).result === "approach");
}

describe("T6/npc-close-approach — HTTP acceptance", () => {
  it("«Подойти к перевозчику» — one outcome, one tick, no location change, no side effects", async () => {
    const router = deadRouter();
    const { store, runtime } = await freshRuntime("ferry", "ca-ferry", router);
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "ca-1" }));

      // The deterministic fast path owns the turn — no model call.
      expect(router.chat).not.toHaveBeenCalled();
      expect(JSON.stringify(response)).toContain(APPROACH_TEXT);

      const after = runtime.projection.getSnapshot();
      const delta = runtime.bus.query().slice(eventsBefore);
      expect(approachOutcomes(runtime, eventsBefore)).toHaveLength(1);
      expect(delta.some((event) => event.type === "PlayerLocationChanged")).toBe(false);
      expect(delta.some((event) => event.type === "MovementSucceeded")).toBe(false);
      // Exactly one command tick — no second tick inside the new rule.
      expect(after.time).toBe(before.time + 1);
      expect(after.eventNumber).toBeGreaterThan(before.eventNumber);
      // No new relations, knowledge or invented reaction.
      expect(delta.some((event) => ["RelationChanged", "KnowledgeAcquired", "TestimonyReceived", "RumorHeard"].includes(event.type))).toBe(false);
      expect(after.relations.size).toBe(before.relations.size);

      // The confirmed target reaches focus metadata (conversation wiring).
      const mentions = store.getConversationTurn("ca-ferry", "ca-1")?.contextMetadata?.mentions ?? [];
      expect(mentions.some((entry) => entry.label === "Перевозчик у переправы")).toBe(true);

      // Replay purity: the Event Log rebuilds the same revision.
      const rebuilt = rebuildProjection(runtime.bus.query()).getSnapshot();
      expect(rebuilt.time).toBe(after.time);
      expect(rebuilt.eventNumber).toBe(after.eventNumber);

      // Idempotency: the same key replays without a second outcome.
      const eventsBeforeReplay = runtime.bus.query().length;
      const replay = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "ca-1" }));
      expect(replay.replayed).toBe(true);
      expect(runtime.bus.query().length).toBe(eventsBeforeReplay);
      expect(runtime.projection.getSnapshot().time).toBe(after.time);
    } finally {
      store.close();
    }
  });

  it("«Я подхожу к старосте» — the warden, across the coordinate gap", async () => {
    const { store, runtime } = await freshRuntime("south", "ca-south", deadRouter(),
      buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Я подхожу к старосте", idempotencyKey: "ca-2" }));

      expect(JSON.stringify(response)).toContain(WARDEN_TEXT);
      const after = runtime.projection.getSnapshot();
      expect(runtime.bus.query().slice(eventsBefore).some((event) => event.type === "PlayerLocationChanged")).toBe(false);
      expect(after.time).toBe(before.time + 1);
      expect(approachOutcomes(runtime, eventsBefore)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("scripted model-plan path parity: an absent contact is rejected the same way", async () => {
    const proposal = {
      schemaVersion: 2,
      kind: "mixed",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к перевозчику" },
      supportingClauses: [],
      question: { queryId: "visible_scene" },
      target: { role: "target", surface: "перевозчику" },
      referents: [{ role: "target", surface: "перевозчику" }],
    };
    const router = scriptedRouter([proposal]);
    const { store, runtime } = await freshRuntime("absent-model", "ca-absent-model", router,
      buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику, что здесь происходит?", idempotencyKey: "ca-3m" }));
      console.log(`CA-ABSENT-MODEL: status=${response.status} reason=${response.reason} calls=${router.chat.mock.calls.length} q=${response.question} text=${response.masterTurn?.deterministicText}`);
      // ADR-0039 §2 parity: the model path runs the SAME preflight, so an
      // absent contact is an action rejection with no time cost and no Event.
      expect(router.chat).toHaveBeenCalled();
      expect(response.status).toBe("action_rejection");
      expect(response.reason).toBe("target_not_present");
      expect(runtime.projection.getSnapshot().time).toBe(before.time);
      expect(runtime.bus.query().length).toBe(eventsBefore);
    } finally {
      store.close();
    }
  });

  it("repaired model plan reaches the same rejection (one turn, no time)", async () => {
    const invalid = { kind: "mixed" };
    const valid = {
      schemaVersion: 2,
      kind: "mixed",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к перевозчику" },
      supportingClauses: [],
      question: { queryId: "visible_scene" },
      target: { role: "target", surface: "перевозчику" },
      referents: [{ role: "target", surface: "перевозчику" }],
    };
    const router = scriptedRouter([invalid, valid]);
    const { store, runtime } = await freshRuntime("repaired", "ca-repaired", router,
      buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику, что здесь происходит?", idempotencyKey: "ca-repaired" }));
      console.log(`CA-REPAIRED: status=${response.status} reason=${response.reason} calls=${router.chat.mock.calls.length}`);
      expect(router.chat.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(response.status).toBe("action_rejection");
      expect(response.reason).toBe("target_not_present");
      expect(runtime.projection.getSnapshot().time).toBe(before.time);
      expect(runtime.bus.query().length).toBe(eventsBefore);
      expect(store.listConversationTurns(runtime.worldId)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("an action rejection survives reload and idempotent replay", async () => {
    const { store, runtime } = await freshRuntime("rej-reload", "ca-rej-reload", deadRouter(),
      buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
    try {
      const first = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "ca-rej" }));
      expect(first.status).toBe("action_rejection");
      const turnsAfterFirst = store.listConversationTurns(runtime.worldId);
      expect(turnsAfterFirst).toHaveLength(1);
      expect(turnsAfterFirst[0]!.responseKind).toBe("action_rejection");
      expect(turnsAfterFirst[0]!.inputClass).toBe("action");
      expect(turnsAfterFirst[0]!.worldTimeBefore).toBe(turnsAfterFirst[0]!.worldTimeAfter);

      const eventsAfterFirst = runtime.bus.query().length;
      const timeAfterFirst = runtime.projection.getSnapshot().time;
      const replay = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "ca-rej" }));
      expect(replay.replayed).toBe(true);
      expect(store.listConversationTurns(runtime.worldId)).toHaveLength(1);
      expect(runtime.bus.query().length).toBe(eventsAfterFirst);
      expect(runtime.projection.getSnapshot().time).toBe(timeAfterFirst);
    } finally {
      store.close();
    }
  });

  it("«Подойти к перевозчику» from another location refuses before execution", async () => {
    const { store, runtime } = await freshRuntime("absent", "ca-absent", deadRouter(),
      buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "ca-3" }));

      // ADR-0039 §2: a known-but-absent contact is an action rejection, not a
      // clarification — the player named a real person, nothing to rephrase.
      expect(response.status).toBe("action_rejection");
      expect(response.reason).toBe("target_not_present");
      const after = runtime.projection.getSnapshot();
      expect(after.time).toBe(before.time);
      expect(runtime.bus.query().length).toBe(eventsBefore);
      expect(approachOutcomes(runtime, 0)).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("«Подойду к нему» after a confirmed mention — pronoun entry, model failed, same result", async () => {
    // This replica also covers the THIRD entry (fallback after model error):
    // the pronoun rewrite skips the fast path, the model is attempted, the
    // deterministic approach still produces the same outcome.
    const router = deadRouter();
    const { store, runtime } = await freshRuntime("pronoun", "ca-pronoun", router);
    try {
      const first = parse(await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "ca-4a" }));
      expect(JSON.stringify(first)).toContain(APPROACH_TEXT);

      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const second = parse(await handleWorldCommand(runtime, { input: "Подойду к нему", idempotencyKey: "ca-4b" }));

      expect(router.chat).toHaveBeenCalled();
      expect(JSON.stringify(second)).toContain(APPROACH_TEXT);
      const after = runtime.projection.getSnapshot();
      expect(after.time).toBe(before.time + 1);
      expect(approachOutcomes(runtime, eventsBefore)).toHaveLength(1);
      expect(runtime.bus.query().slice(eventsBefore).some((event) => event.type === "PlayerLocationChanged")).toBe(false);
    } finally {
      store.close();
    }
  });

  it("«Подойду к старосте, как он выглядит?» — model entry, one outcome, question answered", async () => {
    const mixedProposal = {
      schemaVersion: 2,
      kind: "mixed",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойду к старосте" },
      supportingClauses: [],
      question: { queryId: "visible_scene" },
      target: { role: "target", observerRef: "person_1", surface: "Староста южного посада" },
      referents: [{ role: "target", observerRef: "person_1", surface: "Староста южного посада" }],
    };
    const router = scriptedRouter([mixedProposal]);
    const { store, runtime } = await freshRuntime("model", "ca-model", router,
      buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
    try {
      // Prime the focus exactly like the live sequence: a deterministic
      // approach records the confirmed target, so «он» continues it instead
      // of clarifying between person and objects (turn 1 consumes no model
      // call — the scripted proposal stays queued for the mixed turn).
      const prime = parse(await handleWorldCommand(runtime, { input: "Я подхожу к старосте", idempotencyKey: "ca-5a" }));
      expect(JSON.stringify(prime)).toContain(WARDEN_TEXT);
      expect(router.chat).not.toHaveBeenCalled();

      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Подойду к старосте, как он выглядит?", idempotencyKey: "ca-5" }));

      expect(router.chat).toHaveBeenCalled();
      const dump = JSON.stringify(response);
      expect(dump).toContain(WARDEN_TEXT);
      expect(dump).toContain("Староста южного посада");
      const after = runtime.projection.getSnapshot();
      expect(approachOutcomes(runtime, eventsBefore)).toHaveLength(1);
      expect(runtime.bus.query().slice(eventsBefore).some((event) => event.type === "PlayerLocationChanged")).toBe(false);
      expect(after.time).toBe(before.time + 1);
    } finally {
      store.close();
    }
  });

  it("a speech reply that drops the embedded question is corrected before execution (question-safety)", async () => {
    // Live variance (browser QA replica 4): the model answered this mixed
    // replica as speech and the appearance question died. Round 1 now gets
    // the question_dropped correction; round 2 must carry the question.
    const speechReply = {
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "привет", sourceText: "Подойду к старосте" },
      supportingClauses: [],
      addressedEntity: { role: "addressee", observerRef: "person_1", surface: "Староста южного посада" },
      referents: [{ role: "addressee", observerRef: "person_1", surface: "Староста южного посада" }],
    };
    const mixedProposal = {
      schemaVersion: 2,
      kind: "mixed",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойду к старосте" },
      supportingClauses: [],
      question: { queryId: "visible_scene" },
      target: { role: "target", observerRef: "person_1", surface: "Староста южного посада" },
      referents: [{ role: "target", observerRef: "person_1", surface: "Староста южного посада" }],
    };
    const router = scriptedRouter([speechReply, mixedProposal]);
    const { store, runtime } = await freshRuntime("qsafety", "ca-qsafety", router,
      buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
    try {
      // Prime the focus («он» is dual: without the confirmed mention the
      // pronoun step clarifies before the model ever runs). The turn is
      // deterministic — the scripted queue stays for the mixed replica.
      const prime = parse(await handleWorldCommand(runtime, { input: "Я подхожу к старосте", idempotencyKey: "ca-qs-a" }));
      expect(JSON.stringify(prime)).toContain(WARDEN_TEXT);
      expect(router.chat).not.toHaveBeenCalled();

      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Подойду к старосте, как он выглядит?", idempotencyKey: "ca-qs-1" }));

      expect(router.chat).toHaveBeenCalledTimes(2);
      const dump = JSON.stringify(response);
      // The corrected reply executes BOTH parts: approach outcome present,
      // the speech reply never executed.
      expect(dump).toContain(WARDEN_TEXT);
      expect(dump).not.toContain("Ты обращаешься");
      const after = runtime.projection.getSnapshot();
      expect(approachOutcomes(runtime, eventsBefore)).toHaveLength(1);
      expect(runtime.bus.query().slice(eventsBefore).some((event) => event.type === "PlayerLocationChanged")).toBe(false);
      expect(after.time).toBe(before.time + 1);
    } finally {
      store.close();
    }
  });

  it("«Где староста?» — a question stays read-only", async () => {
    const inquiryProposal = {
      schemaVersion: 2,
      kind: "inquiry",
      primaryIntent: { kind: "inquiry", queryId: "current_location", sourceText: "Где староста?" },
      supportingClauses: [],
      referents: [],
    };
    const { store, runtime } = await freshRuntime("where", "ca-where", scriptedRouter([inquiryProposal]));
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Где староста?", idempotencyKey: "ca-6" }));

      expect(response.status).toBe("inquiry");
      expect(runtime.projection.getSnapshot().time).toBe(before.time);
      expect(runtime.bus.query().length).toBe(eventsBefore);
    } finally {
      store.close();
    }
  });

  it("«Иду к Речному Стражу» — the journey path is untouched", async () => {
    const { store, runtime } = await freshRuntime("journey", "ca-journey", deadRouter());
    try {
      const locationBefore = runtime.projection.getSnapshot().currentLocationId;
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Иду к Речному Стражу", idempotencyKey: "ca-7" }));

      expect(response.ok).toBe(true);
      const delta = runtime.bus.query().slice(eventsBefore);
      expect(delta.some((event) => ["JourneyRequested", "JourneyStarted", "JourneyValidated"].includes(event.type))).toBe(true);
      expect(approachOutcomes(runtime, eventsBefore)).toHaveLength(0);
      expect(runtime.projection.getSnapshot().currentLocationId).toBe(locationBefore);
    } finally {
      store.close();
    }
  });

  it("two same-name contacts clarify without execution", async () => {
    const traders = [
      { eventId: "ca-t1", type: "ObjectPlaced", schemaVersion: 1, payload: {
        entityId: "ca-t1", x: 1, y: 1, name: "Мельник", aliases: [], description: "Мельник с лотком.",
        components: { contact: { locationId: "river_waystation", profile: { visibleAppearance: ["x"], distinguishingFeatures: [], publicRole: "Мельник", knownAs: ["Мельник"], addressForms: ["Мельник"] } } },
      }, timestamp: 0, correlationId: "bootstrap", causationId: null },
      { eventId: "ca-t2", type: "ObjectPlaced", schemaVersion: 1, payload: {
        entityId: "ca-t2", x: 3, y: 1, name: "Мельник", aliases: [], description: "Мельник с лотком.",
        components: { contact: { locationId: "river_waystation", profile: { visibleAppearance: ["x"], distinguishingFeatures: [], publicRole: "Мельник", knownAs: ["Мельник"], addressForms: ["Мельник"] } } },
      }, timestamp: 0, correlationId: "bootstrap", causationId: null },
    ];
    const { store, runtime } = await freshRuntime("twins", "ca-twins", deadRouter(),
      [...buildBootstrapEvents("living_region"), ...traders as any]);
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, { input: "Подойти к мельнику", idempotencyKey: "ca-8" }));

      expect(response.status).toBe("clarification");
      expect((response.options ?? []).length).toBeGreaterThanOrEqual(2);
      const after = runtime.projection.getSnapshot();
      expect(after.time).toBe(before.time);
      expect(runtime.bus.query().length).toBe(eventsBefore);
      expect(approachOutcomes(runtime, 0)).toHaveLength(0);
    } finally {
      store.close();
    }
  });
});
