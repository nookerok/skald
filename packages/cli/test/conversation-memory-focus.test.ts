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
import { resolveQuestionPlanBindings } from "../src/runtime/question-plan-resolver.js";
import { bindTurnPronouns } from "../src/conversation/focus-stack.js";
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


it("persists shown identities through SQLite reload without events or DTO leakage", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "skald-shown-identity-")), "events.sqlite");
  const store = createMultiWorldStore(dbPath);
  const worldId = "shown-identity";
  try {
    store.createWorld({ worldId, idempotencyKey: "create-shown", requestHash: "hash-shown", saveLabel: "Shown", characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region", characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1, bootstrapEvents: buildBootstrapEvents("living_region") });
    const runtime = await new WorldRuntimeManager(store, { apiKey: "", chat: () => { throw new Error("offline"); } } as any).get(worldId);
    const before = runtime.bus.query();
    const reply = parse(await handleWorldCommand(runtime, { input: "Кто рядом?", idempotencyKey: "shown-list" }));
    expect(reply.status).toBe("inquiry");
    expect(reply.conversationTurn.narrationState).toBe("not_requested");
    expect(store.getTurnNarrations(worldId).size).toBe(0);
    expect(runtime.bus.query()).toEqual(before);
    expect(JSON.stringify(reply)).not.toContain("memberIdentities");
    const stored = store.getConversationTurn(worldId, "shown-list")?.contextMetadata?.shownLists?.[0];
    expect(stored?.memberIdentities?.[0]?.internalId).toBeTruthy();
    const reloaded = createMultiWorldStore(dbPath);
    try {
      const snapshot = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
      const context = buildMasterConversationContext(reloaded.listRecentConversationTurns(worldId, { limit: 30 }), worldId, { scene: snapshot.context });
      expect(context.rememberedLists[0]).toEqual(stored);
      const bindings = resolveQuestionPlanBindings({ subjects: [{ id: "first", surface: "первый", kind: "ordinal", listRef: "scene_people", position: 1 }], parts: [{ id: "p", subjectRefs: ["first"], aspect: "appearance", time: "current", purpose: "describe" }] }, snapshot.context, context, snapshot.references);
      expect(bindings).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: snapshot.context.knownPeople[0]!.observerRef }] });
    } finally { reloaded.close(); }
  } finally { store.close(); }
});


/**
 * T6 R2 focus trace: the reviewer-required end-to-end chain for an ordinal
 * continuation — the ordinal ANSWER's server identity → persisted metadata
 * → SQLite reload → rebuilt conversation focus → the next pronoun's
 * resolution. Every hop is asserted (the live run broke at hop 0: the
 * replica never reached a plan turn, so no identity was ever written —
 * classification, not the chain below).
 */
it("traces the ordinal answer focus through metadata, reload and the next pronoun (T6 R2)", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "skald-focus-trace-")), "events.sqlite");
  const store = createMultiWorldStore(dbPath);
  const worldId = "focus-trace";
  const inquiryPlan = (questionPlan: unknown, readings: unknown) => ({
    schemaVersion: 2,
    kind: "inquiry",
    primaryIntent: { kind: "inquiry", queryId: "current_location", sourceText: "trace" },
    supportingClauses: [],
    referents: [],
    questionPlan,
    readings,
  });
  const ordinalPlan = inquiryPlan(
    { subjects: [{ id: "first", surface: "первый перевозчик", kind: "ordinal", listRef: "scene_people", position: 1 }],
      // Fixture mirrors the replica («Что делает…» = activity question): the
      // test certifies the MEMORY chain, but the aspect matches the text so
      // a served fact is semantically right (T6 review §2).
      parts: [{ id: "p-look", subjectRefs: ["first"], aspect: "current_activity", time: "current", purpose: "describe" }] },
    [{ partId: "p-look", source: "scene" }],
  );
  const acqPlan = inquiryPlan(
    { subjects: [{ id: "he", surface: "он", kind: "entity" }],
      parts: [{ id: "p-know", subjectRefs: ["he"], aspect: "acquaintance_link", time: "current", purpose: "describe" }] },
    [{ partId: "p-know", source: "relations" }],
  );
  const scripted = (plans: unknown[]) => {
    const queue = [...plans];
    return { chat: async (category: string) => {
      if (category !== "interpret") return { text: "" };
      return { text: JSON.stringify(queue.shift() ?? queue[0]) };
    } } as any;
  };
  try {
    store.createWorld({ worldId, idempotencyKey: "create-trace", requestHash: "hash-trace", saveLabel: "Focus trace", characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region", characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1, bootstrapEvents: buildBootstrapEvents("living_region") });
    const runtime = await new WorldRuntimeManager(store, scripted([ordinalPlan])).get(worldId);
    const ask = async (input: string, key: string): Promise<any> =>
      parse(await handleWorldCommand(runtime, { input, idempotencyKey: key }));

    // The shown list: the position the ordinal will point at.
    const nearby = await ask("Кто рядом?", "ft-1");
    expect(nearby.status).toBe("inquiry");
    const firstMember = nearby.inquiry.shownLists[0].members[0];

    // The ordinal answer through the real gateway + scripted plan.
    const first = await ask("Что делает первый перевозчик?", "ft-2");
    expect(first.status).toBe("inquiry");
    expect(first.questionReadings.coveredParts).toContain("p-look");

    // HOP 1 — persisted metadata carries the answer-source server identity.
    const meta = store.getConversationTurn(worldId, "ft-2")?.contextMetadata;
    const answerMentions = (meta?.mentions ?? []).filter((entry) => entry.source === "answer" && entry.identity);
    expect(answerMentions.length).toBeGreaterThan(0);
    expect(answerMentions[0]!.identity!.kind).toBe("person");
    const storedId = answerMentions[0]!.identity!.internalId;
    expect(storedId.length).toBeGreaterThan(0);
    // The list the ordinal pointed into was shown by ft-1; its member
    // identities carry the same server id as the ordinal's answer mention.
    const listMeta = store.getConversationTurn(worldId, "ft-1")?.contextMetadata;
    expect(listMeta?.shownLists?.[0]?.memberIdentities?.[0]?.internalId).toBe(storedId);

    // HOP 2 — after SQLite reload the rebuilt focus still carries it.
    const reloaded = createMultiWorldStore(dbPath);
    try {
      const rt2 = await new WorldRuntimeManager(reloaded, scripted([acqPlan])).get(worldId);
      const scene = buildMasterTurnSceneContext(rt2.bus.query(), rt2.projection.getSnapshot());
      const context = buildMasterConversationContext(reloaded.listRecentConversationTurns(worldId, { limit: 30 }), worldId, { scene: scene.context });
      const focus = context.recentFocus.find((entry) => entry.identity !== undefined);
      expect(focus?.identity?.internalId).toBe(storedId);

      // HOP 3 — the next singular pronoun pins exactly that person.
      const pronouns = bindTurnPronouns("А он меня знает?", context, scene.context, scene.references);
      const him = pronouns.find((binding) => binding.pronoun === "он");
      expect(him).toMatchObject({ resolution: "single" });
      const ferrymanRef = him!.candidates[0]!;
      const person = scene.context.knownPeople.find((entry) => entry.observerRef === ferrymanRef)!;
      expect(scene.references.get(ferrymanRef)?.internalId).toBe(storedId);
      // The pronoun continues the ordinal's first shown member, label for label.
      expect(person.label).toBe(firstMember);

      // HOP 4 — the plan-level binding settles the same handle.
      const bindings = resolveQuestionPlanBindings(
        { subjects: [{ id: "he", surface: "он", kind: "entity" }],
          parts: [{ id: "p-know", subjectRefs: ["he"], aspect: "acquaintance_link", time: "current", purpose: "describe" }] },
        scene.context, context, scene.references,
      );
      expect(bindings).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: ferrymanRef }] });

      // HOP 5 — the gateway turn answers with only the available link.
      const second = parse(await handleWorldCommand(rt2, { input: "А он меня знает?", idempotencyKey: "ft-3" }));
      expect(second.status).toBe("inquiry");
      expect(second.questionReadings.coveredParts).toContain("p-know");
      expect(second.masterTurn.deterministicText).toMatch(/знаком/i);
      expect(second.masterTurn.deterministicText).toContain(person.label);

      console.log(`T6R2-TRACE metadata=identity(${answerMentions[0]!.identity!.kind}) focus=${focus?.identity?.internalId === storedId ? "restored" : "LOST"} pronoun=${him!.resolution}->${person.label} answer=${second.masterTurn.deterministicText.slice(0, 80)}`);
    } finally { reloaded.close(); }
  } finally { store.close(); }
});
