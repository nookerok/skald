/**
 * P3 production-path tests: Director decisions reach existing validation and
 * execution, or persist a zero-event response. No model-authored world facts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, buildMasterTurnSceneContext } from "@skald/world";
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
async function fresh(router: any) {
  vi.stubEnv("GM_DIRECTOR_LIVE", "1");
  vi.stubEnv("GM_DIRECTOR_SHADOW", "0");
  vi.stubEnv("SKALD_INTENT_LLM_MODE", "fallback");
  const path = join(mkdtempSync(join(tmpdir(), "skald-director-live-")), "events.sqlite");
  const store = createMultiWorldStore(path);
  store.createWorld({
    worldId: WORLD, idempotencyKey: "create", requestHash: "create", saveLabel: "Director live",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents("living_region"),
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
});
