/**
 * P3 production-path tests: Director decisions reach existing validation and
 * execution, or persist a zero-event response. No model-authored world facts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, buildMasterTurnSceneContext } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager, type WorldRuntime } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { stableActorHandle } from "../src/conversation/gm-context.js";

const WORLD = "director-live";
afterEach(() => { vi.unstubAllEnvs(); });
function parse(result: { statusCode: number; body: string }) {
  expect(result.statusCode, result.body).toBe(200);
  return JSON.parse(result.body);
}
function routerFor(getDecision: () => unknown) {
  const chat = vi.fn(async (category: string) => {
    if (category !== "interpret") return { text: "" };
    return { text: JSON.stringify(getDecision()), provider: "test", model: "director", usedFallback: false };
  });
  return { router: { apiKey: "", chat } as any, chat };
}
async function fresh(
  router: any,
  entrypointId?: string,
  unfamiliarContactRef?: string,
  additionalEvents: readonly DomainEvent[] = [],
  backgroundId?: string,
) {
  vi.stubEnv("GM_DIRECTOR_LIVE", "1");
  vi.stubEnv("GM_DIRECTOR_SHADOW", "0");
  vi.stubEnv("SKALD_INTENT_LLM_MODE", "fallback");
  const path = join(mkdtempSync(join(tmpdir(), "skald-director-live-")), "events.sqlite");
  const store = createMultiWorldStore(path);
  const bootstrapEvents = [
    ...(entrypointId
      ? buildBootstrapEvents({ templateId: "living_region", entrypointId, ...(backgroundId ? { backgroundId } : {}) })
      : buildBootstrapEvents("living_region")),
    ...additionalEvents,
  ];
  const worldBootstrapEvents = unfamiliarContactRef
    ? bootstrapEvents.filter((event) =>
        event.type !== "RelationChanged"
        || (event.payload as { to?: string }).to !== unfamiliarContactRef)
    : bootstrapEvents;
  store.createWorld({
    worldId: WORLD, idempotencyKey: "create", requestHash: "create", saveLabel: "Director live",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: worldBootstrapEvents,
  });
  const runtime = await new WorldRuntimeManager(store, router).get(WORLD);
  return { path, store, runtime };
}
function ferry(runtime: WorldRuntime) {
  const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
  const person = scene.context.knownPeople.find((entry) => entry.label.includes("Перевозчик"))!;
  expect(person).toBeDefined();
  return { handle: stableActorHandle(person.observerRef), label: person.label };
}
const social = (act = "greeting") => ({
  schemaVersion: 2, addressee: { kind: "gm" }, kind: "conversation",
  response: { segments: [{ kind: "social", act }] },
});

describe("P3 Director production path", () => {
  it("persists NPC conversation with one model call, zero events/time, and replay after restart", async () => {
    let decision: unknown = social();
    const { router, chat } = routerFor(() => decision);
    const { path, store, runtime } = await fresh(router);
    const person = ferry(runtime);
    decision = { ...social(), addressee: { kind: "npc", handle: person.handle } };
    const count = store.loadEvents(WORLD).length;
    const before = runtime.projection.getSnapshot().time;
    const input = "Привет, перевозчик";
    const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "conversation" }));
    expect(body).toMatchObject({ status: "conversation", conversationTurn: { inputClass: "speech", responseKind: "speech_reaction", worldTimeBefore: before, worldTimeAfter: before } });
    expect(body.masterTurn.deterministicText).toContain("Здравствуй.");
    expect(body.masterTurn.deterministicText).toContain(person.label);
    expect(chat).toHaveBeenCalledTimes(1); // interpretation + draft; no second narration
    expect(store.loadEvents(WORLD)).toHaveLength(count);
    expect(store.listConversationTurns(WORLD)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/person_|targetRef|internalId|\be[0-9a-f]{12}\b/);
    const saved = store.getConversationTurn(WORLD, "conversation")!;
    expect(saved.contextMetadata?.mentions?.[0]?.identity?.kind).toBe("person");
    store.close();

    const reopened = createMultiWorldStore(path);
    const offline = { apiKey: "", chat: vi.fn(() => { throw new Error("provider down"); }) } as any;
    const restarted = await new WorldRuntimeManager(reopened, offline).get(WORLD);
    try {
      const replay = parse(await handleWorldCommand(restarted, { input, idempotencyKey: "conversation" }));
      expect(replay.replayed).toBe(true);
      expect(replay.masterTurn).toEqual(body.masterTurn);
      expect(offline.chat).not.toHaveBeenCalled();
      expect(reopened.listConversationTurns(WORLD)).toHaveLength(1);
      expect(reopened.loadEvents(WORLD)).toHaveLength(count);
      expect((await handleWorldCommand(restarted, { input: "другая реплика", idempotencyKey: "conversation" })).statusCode).toBe(409);
    } finally { reopened.close(); }
  });

  it("binds an unknown NPC's authored address form for a greeting without revealing their name", async () => {
    const { router, chat } = routerFor(() => social());
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", "contact:riverwatch-gatekeeper");
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const gatekeeper = scene.context.knownPeople.find((person) => person.portrait?.addressForms.includes("смотритель"));
    expect(gatekeeper).toBeDefined();
    expect(gatekeeper).toMatchObject({ label: "Незнакомый человек", known: false });
    const eventCount = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Привет, смотритель", idempotencyKey: "unknown-address-form" }));
      expect(body.status).toBe("conversation");
      expect(body.masterTurn.deterministicText).toContain("Незнакомый человек");
      expect(body.masterTurn.deterministicText).toContain("Здравствуй.");
      expect(body.masterTurn.deterministicText).not.toContain("Смотритель речных ворот");
      expect(JSON.stringify(body)).not.toMatch(/person_|contact:|targetRef|internalId|Смотритель речных ворот/iu);
      expect(JSON.stringify(chat.mock.calls)).toContain("смотритель");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(eventCount);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
    } finally { store.close(); }
  });

  it("recovers a pure speech turn without its envelope, without another provider call", async () => {
    const { router } = routerFor(() => social());
    const { store, runtime } = await fresh(router);
    const worldTime = runtime.projection.getSnapshot().time;
    store.recordConversationTurn({
      worldId: WORLD, idempotencyKey: "lost", correlationId: "conversation:lost",
      requestHash: (await import("../src/conversation/builder.js")).conversationRequestHash("Приятно побеседовать."),
      playerText: "Приятно побеседовать.", inputClass: "speech", responseKind: "speech_reaction",
      responseText: "Я тебя слышу.", worldTimeBefore: worldTime, worldTimeAfter: worldTime,
    });
    const count = runtime.bus.query().length;
    try {
      const replay = parse(await handleWorldCommand(runtime, { input: "Приятно побеседовать.", idempotencyKey: "lost" }));
      expect(replay).toMatchObject({ replayed: true, masterTurn: { kind: "speech_reaction", deterministicText: "Я тебя слышу." } });
      expect(router.chat).not.toHaveBeenCalled();
      expect(runtime.bus.query()).toHaveLength(count);
    } finally { store.close(); }
  });

  it("runs a model-authored single action through existing preflight/engine exactly once", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router);
    const person = ferry(runtime);
    decision = {
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "action",
      proposal: {
        schemaVersion: 2, kind: "action",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к перевозчику" },
        target: { role: "target", surface: "перевозчику", observerRef: person.handle },
        supportingClauses: [], referents: [{ role: "target", surface: "перевозчику", observerRef: person.handle }],
      },
    };
    const before = runtime.projection.getSnapshot().time, start = runtime.bus.query().length;
    try {
      const request = { input: "Сделаю несколько осторожных шагов поближе к перевозчику.", idempotencyKey: "action" };
      const replies = (await Promise.all([handleWorldCommand(runtime, request), handleWorldCommand(runtime, request)])).map(parse);
      expect(replies.filter((reply) => reply.replayed)).toHaveLength(1);
      const body = replies[0];
      expect(body.masterTurn.kind).toBe("action_outcome");
      expect(runtime.projection.getSnapshot().time).toBe(before + 1);
      expect(runtime.bus.query().slice(start).filter((event) => event.type === "ActionResolved")).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
    } finally { store.close(); }
  });

  it("keeps a bare greeting read-side when the Director mislabels it as speak action", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router);
    const person = ferry(runtime);
    decision = {
      schemaVersion: 2, addressee: { kind: "npc", handle: person.handle }, kind: "action",
      proposal: {
        schemaVersion: 2, kind: "action",
        primaryIntent: { kind: "legacy", operation: "speak", sourceText: "Привет, перевозчик" },
        addressedEntity: { role: "addressee", surface: "перевозчику", observerRef: person.handle },
        supportingClauses: [], referents: [{ role: "addressee", surface: "перевозчику", observerRef: person.handle }],
      },
    };
    const count = store.loadEvents(WORLD).length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Привет, перевозчик", idempotencyKey: "bare-greeting" }));
      expect(body).toMatchObject({ status: "conversation", conversationTurn: { inputClass: "speech", responseKind: "speech_reaction", worldTimeBefore: 0, worldTimeAfter: 0 } });
      expect(body.masterTurn.deterministicText).toContain(person.label);
      expect(body.masterTurn.deterministicText).toContain("Здравствуй.");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(count);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("does not turn an unsupported factual question into a speech apology when the provider is down", async () => {
    const chat = vi.fn(async () => { throw new Error("provider down"); });
    const { store, runtime } = await fresh({ apiKey: "", chat });
    const count = store.loadEvents(WORLD).length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Что именно известно о ночном следе?", idempotencyKey: "offline-question" }));
      expect(body.masterTurn.kind).not.toBe("speech_reaction");
      expect(body.masterTurn.kind).not.toBe("action_outcome");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(count);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });

  it("does not answer an unregistered factual question with an unrelated registered knowledge query", async () => {
    const input = "Кто перевозит людей через реку?";
    const { router } = routerFor(() => ({
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "world_question",
    }));
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival");
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "unregistered-who-question" }));
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(["clarification", "contextual_clarification"]).toContain(body.masterTurn.kind);
      expect(body.masterTurn.deterministicText).not.toContain("Перед пожаром из архива");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
    } finally { store.close(); }
  });

  it("resolves a persisted approached-person focus after restart and answers a clothing question read-only", async () => {
    let decision: unknown = social();
    const { router, chat } = routerFor(() => decision);
    const { path, store, runtime } = await fresh(router);
    const person = ferry(runtime);

    try {
      const approached = parse(await handleWorldCommand(runtime, {
        input: "Подойти к перевозчику",
        idempotencyKey: "approach-ferry-focus",
      }));
      expect(approached.masterTurn.deterministicText).toContain(person.label);
      expect(runtime.projection.getSnapshot().time).toBe(1);
    } finally { store.close(); }

    const reopened = createMultiWorldStore(path);
    const restarted = await new WorldRuntimeManager(reopened, router).get(WORLD);
    const afterApproachEvents = restarted.bus.query().length;
    try {
      const conversation = parse(await handleWorldCommand(restarted, {
        input: "Хочу поговорить с ним",
        idempotencyKey: "talk-to-focused-ferry",
      }));
      expect(conversation.conversationTurn.responseKind).toBe("speech_reaction");
      expect(conversation.masterTurn.deterministicText).not.toMatch(/Кого или что именно|К кому именно/u);
      expect(conversation.masterTurn.deterministicText).toContain(person.label);
      expect(restarted.projection.getSnapshot().time).toBe(1);
      expect(restarted.bus.query()).toHaveLength(afterApproachEvents);

      const afterConversationEvents = restarted.bus.query().length;
      decision = {
        schemaVersion: 2,
        addressee: { kind: "gm" },
        kind: "world_question",
        proposal: {
          schemaVersion: 2,
          kind: "inquiry",
          primaryIntent: null,
          supportingClauses: [],
          referents: [],
          questionPlan: {
            subjects: [{ id: "person", surface: "нём", kind: "entity" }],
            parts: [{ id: "clothes", subjectRefs: ["person"], aspect: "appearance", time: "current", purpose: "describe" }],
          },
          readings: [{ partId: "clothes", source: "person" }],
        },
      };
      const appearance = parse(await handleWorldCommand(restarted, {
        input: "Что на нём надето?",
        idempotencyKey: "focused-archivist-clothing",
      }));
      expect(appearance.conversationTurn.responseKind).toBe("inquiry_answer");
      expect(appearance.masterTurn.kind).toBe("inquiry_answer");
      expect(appearance.masterTurn.deterministicText).not.toMatch(/Кого или что именно|К кому именно/u);
      expect(restarted.projection.getSnapshot().time).toBe(1);
      expect(restarted.bus.query()).toHaveLength(afterConversationEvents);
      expect(chat).not.toHaveBeenCalled();
    } finally { reopened.close(); }
  });
  it("does not execute a speak proposal that drops a corrective topic question", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router);
    const person = ferry(runtime);
    const input = "Не об этом — лучше расскажи, кто ходит через реку ночью.";
    decision = {
      schemaVersion: 2, addressee: { kind: "npc", handle: person.handle }, kind: "action",
      proposal: {
        schemaVersion: 2, kind: "action",
        primaryIntent: { kind: "legacy", operation: "speak", sourceText: input },
        addressedEntity: { role: "addressee", surface: person.label, observerRef: person.handle },
        supportingClauses: [], referents: [{ role: "addressee", surface: person.label, observerRef: person.handle }],
      },
    };
    const count = store.loadEvents(WORLD).length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "topic-shift-question" }));
      expect(["clarification", "contextual_clarification"]).toContain(body.masterTurn.kind);
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(count);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("allows only a closed no-knowledge answer to an unresolved non-explicit question", async () => {
    const { router } = routerFor(() => ({
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "conversation",
      response: { segments: [{ kind: "social", act: "no_knowledge" }] },
    }));
    const { store, runtime } = await fresh(router);
    const count = store.loadEvents(WORLD).length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Не об этом — лучше расскажи, кто ходит через реку ночью.", idempotencyKey: "topic-shift-no-knowledge",
      }));
      expect(body).toMatchObject({ status: "conversation", conversationTurn: { worldTimeBefore: 0, worldTimeAfter: 0 } });
      expect(body.masterTurn.deterministicText).toBe("У меня нет подтверждённых сведений об этом.");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(count);
    } finally { store.close(); }
  });

  it("fails closed when the live proposal drops the question after an action", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router);
    const person = ferry(runtime);
    decision = {
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "action",
      proposal: {
        schemaVersion: 2, kind: "action",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к Перевозчику у переправы" },
        target: { role: "target", surface: person.label, observerRef: person.handle },
        supportingClauses: [], referents: [{ role: "target", surface: person.label, observerRef: person.handle }],
      },
    };
    const count = store.loadEvents(WORLD).length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Подойти к Перевозчику у переправы и спроси: кто рядом?", idempotencyKey: "dropped-question",
      }));
      expect(["clarification", "contextual_clarification"]).toContain(body.masterTurn.kind);
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(count);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("answers both QuestionPlan-only parts through the real handler with no invented queryId", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router);
    const person = ferry(runtime);
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const appearance = scene.context.knownPeople.find((entry) => stableActorHandle(entry.observerRef) === person.handle)?.portrait?.visibleAppearance[0];
    expect(appearance).toBeTruthy();
    decision = {
      schemaVersion: 2, kind: "world_question", addressee: { kind: "gm" }, subjectHandle: person.handle,
      proposal: {
        schemaVersion: 2, kind: "inquiry", primaryIntent: null, supportingClauses: [], referents: [],
        questionPlan: {
          subjects: [{ id: "person", kind: "entity", surface: person.label, observerRef: person.handle }],
          parts: [
            { id: "clothes", subjectRefs: ["person"], aspect: "appearance", time: "current", purpose: "describe" },
            { id: "reaction", subjectRefs: ["person"], aspect: "observed_reaction", time: "current", purpose: "describe" },
          ],
        },
        readings: [{ partId: "clothes", source: "person" }, { partId: "reaction", source: "scene" }],
      },
    };
    const count = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Что на нём одето и как он себя ведёт?", idempotencyKey: "parts-only" }));
      expect(body.masterTurn.kind).toBe("inquiry_answer");
      expect(body.inquiries).toEqual([]);
      expect(body.masterTurn.deterministicText).toContain(appearance);
      expect(body.masterTurn.deterministicText).toContain("По доступным наблюдениям");
      expect(body.questionReadings.results.map((result: any) => result.request.partId)).toEqual(["clothes", "reaction"]);
      expect(body.masterTurn.deterministicText).not.toMatch(/доволен|радост|сердит|одобряет/iu);
      expect(runtime.bus.query()).toHaveLength(count);
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });

  it("keeps the mixed question and answers from the post-action snapshot", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router);
    const person = ferry(runtime);
    decision = {
      schemaVersion: 2, addressee: { kind: "npc", handle: person.handle }, kind: "mixed",
      proposal: {
        schemaVersion: 2, kind: "mixed",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к перевозчику" },
        target: { role: "target", surface: "перевозчику", observerRef: person.handle },
        question: { queryId: "who_is_nearby" }, supportingClauses: [], referents: [{ role: "target", surface: "перевозчику", observerRef: person.handle }],
      },
    };
    const before = runtime.projection.getSnapshot().time;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Сделаю несколько шагов к перевозчику, кто рядом?", idempotencyKey: "mixed" }));
      expect(body.masterTurn.kind).toBe("mixed_outcome");
      expect(body.masterTurn.deterministicText).toContain(person.label);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(store.listConversationTurns(WORLD)[0]?.inputClass).toBe("mixed");
      expect(runtime.projection.getSnapshot().time).toBe(before + 1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("shares concurrent pure conversations and commits only one turn", async () => {
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const chat = vi.fn(async () => {
      entered();
      await barrier;
      return { text: JSON.stringify(social()), provider: "test", model: "director", usedFallback: false };
    });
    const { store, runtime } = await fresh({ apiKey: "", chat });
    const count = runtime.bus.query().length;
    try {
      const first = handleWorldCommand(runtime, { input: "Рад побеседовать.", idempotencyKey: "parallel" });
      await started;
      expect((await handleWorldCommand(runtime, { input: "Другой текст.", idempotencyKey: "parallel" })).statusCode).toBe(409);
      const second = handleWorldCommand(runtime, { input: "Рад побеседовать.", idempotencyKey: "parallel" });
      await runtime.queue.enqueue(async () => {});
      release();
      const replies = (await Promise.all([first, second])).map(parse);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(replies.map((body) => body.masterTurn.deterministicText)).toEqual(["Здравствуй.", "Здравствуй."]);
      expect(replies.filter((body) => body.replayed)).toHaveLength(1);
      expect(runtime.gmLiveRequests.size).toBe(0);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(runtime.bus.query()).toHaveLength(count);
    } finally { release(); store.close(); }
  });

  it("does not show stale speech after the scene advances during a model call", async () => {
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const chat = vi.fn(async (category: string) => {
      if (category !== "interpret") return { text: "" };
      entered(); await barrier;
      return { text: JSON.stringify(social()), provider: "test", model: "director", usedFallback: false };
    });
    const { store, runtime } = await fresh({ apiKey: "", chat });
    try {
      const first = handleWorldCommand(runtime, { input: "Рад побеседовать.", idempotencyKey: "stale" });
      await started;
      parse(await handleWorldCommand(runtime, { input: "wait", idempotencyKey: "tick" }));
      const count = runtime.bus.query().length;
      release();
      const body = parse(await first);
      expect(body.masterTurn.kind).toBe("contextual_clarification");
      expect(body.masterTurn.deterministicText).toContain("Сцена изменилась");
      expect(runtime.bus.query()).toHaveLength(count);
      expect(runtime.projection.getSnapshot().time).toBe(1);
    } finally { release(); store.close(); }
  });

  it("preserves the existing absent-contact refusal instead of narrating success", async () => {
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "action",
      proposal: {
        schemaVersion: 2, kind: "action",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к старосте" },
        target: { role: "target", surface: "старосте" },
        supportingClauses: [], referents: [{ role: "target", surface: "старосте" }],
      },
    }));
    const { store, runtime } = await fresh(router);
    const count = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Сделаю несколько осторожных шагов поближе к старосте.", idempotencyKey: "absent" }));
      expect(body.masterTurn.kind).toBe("action_rejection");
      expect(body.masterTurn.deterministicText).toContain("не рядом");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(count);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });

  it.each(["Привет, перевозчик", "Привет перевозчик"])("keeps %s cost-zero when the model is unavailable", async (input) => {
    const chat = vi.fn(async () => { throw new Error("provider down"); });
    const { store, runtime } = await fresh({ apiKey: "", chat });
    const count = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "down-speech" }));
      expect(body.masterTurn.kind).toBe("speech_reaction");
      expect(body.masterTurn.deterministicText).toContain("не удаётся продолжить");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(count);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });

  it("does not start a journey from a negated travel cancellation", async () => {
    const { router, chat } = routerFor(() => social());
    const { store, runtime } = await fresh(router);
    try {
      const start = parse(await handleWorldCommand(runtime, {
        input: "Иду к Речному Стражу", idempotencyKey: "cancel-test-start",
      }));
      expect(start.masterTurn.kind).toBe("action_outcome");
      expect(runtime.bus.query().some((event) => event.type === "JourneyStarted")).toBe(true);

      const timeBeforeCancel = runtime.projection.getSnapshot().time;
      const eventCountBeforeCancel = runtime.bus.query().length;
      const interpretationCallsBefore = chat.mock.calls.filter(([category]) => category === "interpret").length;
      const result = parse(await handleWorldCommand(runtime, {
        input: "Подожди, я передумал — не хочу идти внутрь.", idempotencyKey: "cancel-test",
      }));
      const cancellationEvents = runtime.bus.query().slice(eventCountBeforeCancel);

      expect(result.masterTurn.kind).toBe("action_outcome");
      expect(cancellationEvents.map((event) => event.type)).toContain("JourneyInterrupted");
      expect(cancellationEvents.some((event) => event.type === "JourneyRequested" || event.type === "JourneyStarted" || event.type === "TickPassed")).toBe(false);
      expect(runtime.projection.getSnapshot().time).toBe(timeBeforeCancel);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(interpretationCallsBefore);
    } finally { store.close(); }
  });

  it("keeps provider unavailability read-only without a second call to the dead model", async () => {
    const router = { apiKey: "", chat: vi.fn(async () => { throw new Error("provider down"); }) } as any;
    const { store, runtime } = await fresh(router);
    const before = runtime.projection.getSnapshot().time, count = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "offline" }));
      expect(body.masterTurn.kind).toBe("inquiry_answer");
      expect(runtime.projection.getSnapshot().time).toBe(before);
      expect(runtime.bus.query()).toHaveLength(count);
      expect(router.chat.mock.calls.filter(([category]: [string]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });
  it("continues a persisted person focus for a pronominal talk request after SQLite reopen", async () => {
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "clarification",
      clarification: {
        question: "«Незнакомый человек» сейчас не удаётся связать с тем, что видно. Назови это иначе или осмотрись.",
        candidateHandles: [],
      },
    }));
    const { path, store, runtime } = await fresh(router, "riverwatch_city_arrival", "contact:riverwatch-gatekeeper");
    const source = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const person = source.context.knownPeople.find((entry) => entry.label === "Незнакомый человек" && !entry.known);
    expect(person).toBeDefined();
    const reference = person && source.references.get(person.observerRef);
    expect(reference?.kind).toBe("person");
    const { conversationRequestHash } = await import("../src/conversation/builder.js");
    store.recordConversationTurn({
      worldId: WORLD,
      idempotencyKey: "prior-focus",
      correlationId: "conversation:prior-focus",
      requestHash: conversationRequestHash("Кто рядом?"),
      playerText: "Кто рядом?",
      inputClass: "inquiry",
      responseKind: "inquiry_answer",
      responseText: "Незнакомый человек ведёт журнал проходов.",
      worldTimeBefore: 0,
      worldTimeAfter: 0,
      contextMetadata: {
        schemaVersion: 1,
        mentions: [{
          kind: "person",
          role: "topic",
          label: person!.label,
          source: "answer",
          identity: { kind: "person", internalId: reference!.internalId },
        }],
      },
    } as any);
    store.close();

    const reopened = createMultiWorldStore(path);
    const restarted = await new WorldRuntimeManager(reopened, router).get(WORLD);
    const eventCount = restarted.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(restarted, { input: "Хочу поговорить с ним", idempotencyKey: "pronoun-topic" }));
      expect(body.status).toBe("conversation");
      expect(body.masterTurn.deterministicText).toContain("Незнакомый человек");
      expect(body.masterTurn.deterministicText).toContain("О чём ты хочешь поговорить?");
      expect(JSON.stringify(body)).not.toMatch(/person_|object_|route_|locationId|internalId/iu);
      expect(chat).not.toHaveBeenCalled();
      expect(restarted.projection.getSnapshot().time).toBe(0);
      expect(restarted.bus.query()).toHaveLength(eventCount);
      expect(reopened.listConversationTurns(WORLD)).toHaveLength(2);
    } finally { reopened.close(); }
  });

  it("uses a unique recent target focus for pronominal talk without asking again among multiple people", async () => {
    const { router, chat } = routerFor(() => social());
    const bystander: DomainEvent = {
      eventId: "test#ObjectPlaced#bystander",
      type: "ObjectPlaced",
      schemaVersion: 1,
      payload: {
        entityId: "contact:test-bystander",
        x: 13500, y: 7500, name: "Незнакомый свидетель", aliases: [],
        description: "Человек ждёт у стены.",
        components: {
          contact: {
            locationId: "riverwatch_city",
            profile: {
              identityRef: "contact:test-bystander",
              visibleAppearance: [], distinguishingFeatures: [],
              publicRole: "ждёт у стены", knownAs: [], addressForms: [],
            },
          },
        },
      },
      timestamp: 0, correlationId: "test-bootstrap", causationId: null,
    };
    const { path, store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [bystander]);
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const people = scene.context.knownPeople;
    const gatekeeper = people.find((person) => person.label.includes("Смотритель"));
    expect(people.length).toBeGreaterThan(1);
    expect(gatekeeper).toBeDefined();

    try {
      const approached = parse(await handleWorldCommand(runtime, {
        input: "Подойти к смотрителю",
        idempotencyKey: "approach-gatekeeper-focus",
      }));
      expect(approached.masterTurn.deterministicText).toContain(gatekeeper!.label);
      expect(runtime.projection.getSnapshot().time).toBe(1);
    } finally { store.close(); }

    const reopened = createMultiWorldStore(path);
    const restarted = await new WorldRuntimeManager(reopened, router).get(WORLD);
    const eventsBeforeTalk = restarted.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(restarted, {
        input: "Хочу поговорить с ним",
        idempotencyKey: "talk-to-focused-gatekeeper",
      }));
      expect(body.conversationTurn.responseKind).toBe("speech_reaction");
      expect(body.masterTurn.deterministicText).toContain(gatekeeper!.label);
      expect(body.masterTurn.deterministicText).toContain("О чём ты хочешь поговорить?");
      expect(body.masterTurn.deterministicText).not.toMatch(/Кого или что именно|К кому именно/u);
      expect(restarted.projection.getSnapshot().time).toBe(1);
      expect(restarted.bus.query()).toHaveLength(eventsBeforeTalk);
      expect(chat).not.toHaveBeenCalled();
      expect(JSON.stringify(body)).not.toMatch(/person_|object_|route_|locationId|internalId/iu);
    } finally { reopened.close(); }
  });

  it("does not accept a social-only acknowledgement that drops a speech-wrapped question", async () => {
    const { router, chat } = routerFor(() => social("acknowledge"));
    const { store, runtime } = await fresh(router);
    const count = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "спрашиваю, что записано в журнале проходов",
        idempotencyKey: "speech-question-ack",
      }));
      expect(body.masterTurn.kind).not.toBe("speech_reaction");
      expect(body.masterTurn.deterministicText).not.toBe("Я тебя слышу.");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(count);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });

  it("fails closed when addressed speech text contains a question but the proposal drops it", async () => {
    const input = "Спрашиваю смотрителя, что записано в журнале проходов?";
    let keeperRef = "";
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "Здравствуйте.", sourceText: input },
      addressedEntity: { role: "addressee", surface: "смотрителя", observerRef: keeperRef },
      supportingClauses: [],
      referents: [{ role: "addressee", surface: "смотрителя", observerRef: keeperRef }],
    }));
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival");
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const keeper = scene.context.knownPeople.find((person) => person.portrait?.addressForms.includes("смотритель"));
    expect(keeper).toBeDefined();
    if (!keeper) { store.close(); throw new Error("expected gatekeeper address form in riverwatch scene"); }
    keeperRef = keeper.observerRef;
    vi.stubEnv("GM_DIRECTOR_LIVE", "0");
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "addressed-question-dropped" }));
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(["clarification", "contextual_clarification"]).toContain(body.masterTurn.kind);
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
      expect(chat).toHaveBeenCalledTimes(2);
    } finally { store.close(); }
  });
  it("does not execute a partial action when the Director drops a speech-wrapped question", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router);
    const person = ferry(runtime);
    decision = {
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "action",
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к перевозчику" },
        target: { role: "target", surface: "перевозчику", observerRef: person.handle },
        supportingClauses: [],
        referents: [{ role: "target", surface: "перевозчику", observerRef: person.handle }],
      },
    };
    const count = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "спрашиваю, что записано в журнале проходов",
        idempotencyKey: "speech-question-action",
      }));
      expect(body.masterTurn.kind).not.toBe("action_outcome");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(count);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });
  it("clarifies two named approach targets before executing and resumes the chosen target after restart", async () => {
    const { router, chat } = routerFor(() => social());
    const { path, store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [], "keeper");
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const archivist = scene.context.knownPeople.find((person) => person.label.includes("Архивист"));
    const gatekeeper = scene.context.knownPeople.find((person) => person.portrait?.publicRole?.includes("журнал проходов"));
    expect(archivist).toBeDefined();
    expect(gatekeeper).toBeDefined();
    const startEvents = store.loadEvents(WORLD).length;
    let answerSurface = "";
    try {
      const clarification = parse(await handleWorldCommand(runtime, {
        input: "Подойду к архивисту и смотрителю.",
        idempotencyKey: "two-approach-targets",
      }));
      expect(clarification.conversationTurn.responseKind).toBe("clarification");
      expect(clarification.question).toBe("К кому подойти первым?");
      expect(clarification.options.some((option: any) => option.label.includes("Архивист"))).toBe(true);
      expect(clarification.options.some((option: any) => option.label.includes("Смотритель"))).toBe(true);
      answerSurface = clarification.options.find((option: any) => option.label.includes("Архивист"))!.label;
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(startEvents);
      expect(chat).not.toHaveBeenCalled();
    } finally { store.close(); }

    const reopened = createMultiWorldStore(path);
    const restarted = await new WorldRuntimeManager(reopened, router).get(WORLD);
    try {
      const selected = reopened.listConversationTurns(WORLD)[0]!;
      expect(selected.contextMetadata?.clarification?.framed?.intent).toBeDefined();
      const answer = parse(await handleWorldCommand(restarted, {
        input: answerSurface,
        idempotencyKey: "choose-archivist",
      }));
      expect(answer.masterTurn.kind).toBe("action_outcome");
      expect(answer.conversationTurn.responseKind).toBe("action_outcome");
      expect(restarted.projection.getSnapshot().time).toBe(1);
      expect(restarted.bus.query().slice(startEvents).filter((event) => event.type === "ActionResolved")).toHaveLength(1);
      expect(chat).not.toHaveBeenCalled();
    } finally { reopened.close(); }
  });

  it.each([
    "Кто ведёт журнал проходов у ворот?",
    "Кто ведёт журнал проходов?",
  ])("answers a unique visible public-role question from observer-safe read facts without spending time: %s", async (input) => {
    const { router, chat } = routerFor(() => social());
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", "contact:riverwatch-gatekeeper");
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input,
        idempotencyKey: `visible-role-question-${input}`,
      }));
      expect(body.status).toBe("inquiry");
      expect(body.conversationTurn.responseKind).toBe("inquiry_answer");
      expect(body.conversationTurn.responseText).toContain("журнал проходов");
      expect(body.conversationTurn.responseText).toContain("Незнакомый человек");
      expect(body.conversationTurn.responseText).not.toContain("Смотритель речных ворот");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
      expect(chat).not.toHaveBeenCalled();
      expect(JSON.stringify(body)).not.toMatch(/person_|object_|route_|locationId|internalId/iu);
    } finally { store.close(); }
  });

  it("continues a topic after the NPC's topic prompt and survives reload without repeating it", async () => {
    const { router, chat } = routerFor(() => social());
    const { path, store, runtime } = await fresh(router);
    const target = ferry(runtime);
    const beforeEvents = runtime.bus.query().length;
    try {
      const approached = parse(await handleWorldCommand(runtime, {
        input: "Подойти к перевозчику",
        idempotencyKey: "topic-approach",
      }));
      expect(approached.masterTurn.deterministicText).toContain(target.label);
      const prompt = parse(await handleWorldCommand(runtime, {
        input: "Хочу поговорить с ним",
        idempotencyKey: "topic-prompt",
      }));
      expect(prompt.masterTurn.deterministicText).toContain("О чём ты хочешь поговорить?");
      expect(runtime.projection.getSnapshot().time).toBe(1);
    } finally { store.close(); }

    const reopened = createMultiWorldStore(path);
    const restarted = await new WorldRuntimeManager(reopened, router).get(WORLD);
    const eventsBeforeAnswer = restarted.bus.query().length;
    try {
      const answer = parse(await handleWorldCommand(restarted, {
        input: "О пропавшей записи.",
        idempotencyKey: "topic-answer",
      }));
      expect(answer.status).toBe("conversation");
      expect(answer.conversationTurn.responseText).toContain("пропавшей записи");
      expect(answer.conversationTurn.responseText).not.toContain("О чём ты хочешь поговорить?");
      expect(restarted.projection.getSnapshot().time).toBe(1);
      expect(restarted.bus.query()).toHaveLength(eventsBeforeAnswer);
      expect(reopened.listConversationTurns(WORLD)).toHaveLength(3);
      expect(chat).not.toHaveBeenCalled();
      expect(beforeEvents).toBeGreaterThan(0);
    } finally { reopened.close(); }
  });

  it("persists an ambiguous appearance-and-reaction question across restart without events or invented mood", async () => {
    const { router, chat } = routerFor(() => social());
    const { path, store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [], "keeper");
    const people = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot()).context.knownPeople;
    expect(people.some((person) => person.label.includes("Архивист"))).toBe(true);
    expect(people.some((person) => person.label.includes("Смотритель"))).toBe(true);
    const beforeEvents = store.loadEvents(WORLD).length;
    let selectedLabel = "";
    try {
      const clarification = parse(await handleWorldCommand(runtime, {
        input: "Что на нём надето и как он себя ведёт?",
        idempotencyKey: "ambiguous-appearance-question",
      }));
      expect(clarification.conversationTurn.responseKind).toBe("clarification");
      expect(clarification.question).toContain("О ком");
      selectedLabel = clarification.options.find((option: any) => option.label.includes("Архивист"))?.label ?? "";
      expect(selectedLabel).not.toBe("");
      expect(store.listConversationTurns(WORLD)[0]!.contextMetadata?.clarification?.framed?.slot).toBe("question_subject");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(beforeEvents);
      expect(chat).not.toHaveBeenCalled();
    } finally { store.close(); }

    const reopened = createMultiWorldStore(path);
    const restarted = await new WorldRuntimeManager(reopened, router).get(WORLD);
    try {
      const answer = parse(await handleWorldCommand(restarted, {
        input: "Я имею в виду Архивиста",
        idempotencyKey: "answer-appearance-subject",
      }));
      expect(answer.status).toBe("inquiry");
      expect(answer.conversationTurn.responseKind).toBe("inquiry_answer");
      expect(answer.conversationTurn.responseText).toContain("рабочем платье");
      expect(answer.conversationTurn.responseText).toMatch(/нет (?:доступных |проверенных )?сведений|не удалось наблюдать|не видно данных|пока нельзя понять/iu);
      expect(answer.conversationTurn.responseText).not.toMatch(/спокоен|сердит|тревож|испуган|радостн|злится/iu);
      expect(restarted.projection.getSnapshot().time).toBe(0);
      expect(restarted.bus.query()).toHaveLength(beforeEvents);
      expect(chat).not.toHaveBeenCalled();
      expect(JSON.stringify(answer)).not.toMatch(/person_|object_|route_|locationId|internalId/iu);
    } finally { reopened.close(); }
  });
  it("answers an addressed historical perception question with honest no-knowledge", async () => {
    const { router, chat } = routerFor(() => social());
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", "contact:riverwatch-gatekeeper");
    const eventsBefore = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Смотритель, что ты видел перед пожаром?",
        idempotencyKey: "addressed-historical-no-knowledge",
      }));
      expect(body.status).toBe("conversation");
      expect(body.conversationTurn.responseKind).toBe("speech_reaction");
      expect(body.conversationTurn.responseText).toContain("нет подтверждённого ответа");
      expect(body.conversationTurn.responseText).toContain("Незнакомый человек");
      expect(body.conversationTurn.responseText).not.toContain("Смотритель речных ворот");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(eventsBefore);
      expect(chat).not.toHaveBeenCalled();
      expect(JSON.stringify(body)).not.toMatch(/person_|object_|route_|locationId|internalId/iu);
    } finally { store.close(); }
  });
});
