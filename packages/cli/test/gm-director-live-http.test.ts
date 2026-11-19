/**
 * P3 production-path tests: Director decisions reach existing validation and
 * execution, or persist a zero-event response. No model-authored world facts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ANSWER_GAP_STATEMENT, buildBootstrapEvents, buildMasterTurnSceneContext, buildNarrativeAdapterContext, executeQuestionReadingRound, ProviderRequestError, ProviderUnavailableError, type AllowedNarrativeFacts } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager, type WorldRuntime } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand, handleWorldJournal } from "../src/http/world-handlers.js";
import {
  extractP3PlayerVisibleResponse, readP3RuinsQuestionSpec, verifyP3RuinsNarration,
  verifyP3RuinsPerception, verifyP3RuinsQuestionReading,
} from "../src/acceptance/gm-p3-live-gate.js";
import { actionOutcomeText } from "../src/conversation/builder.js";
import { buildGmContext } from "../src/conversation/gm-context.js";
import { EMPTY_MASTER_CONVERSATION } from "../src/conversation/context-builder.js";
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
  const manager = new WorldRuntimeManager(store, router);
  const runtime = await manager.get(WORLD);
  return { path, store, runtime, manager };
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
  it("keeps an unsupported action's validated question instead of dropping it into generic fallback", async () => {
    const question = "Такое действие здесь недоступно. Что ты хочешь попробовать вместо него?";
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "clarification", clarification: { question },
    }));
    const { store, runtime } = await fresh(router);
    const before = runtime.projection.getSnapshot().time;
    const events = store.loadEvents(WORLD);
    const request = { input: "Я взлетаю над рекой без крыльев и улетаю на Луну.", idempotencyKey: "unsupported-action-question" };
    try {
      const body = parse(await handleWorldCommand(runtime, request));
      expect(body).toMatchObject({ status: "clarification", masterTurn: { deterministicText: question } });
      expect(runtime.projection.getSnapshot().time).toBe(before);
      expect(store.loadEvents(WORLD)).toEqual(events);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat).toHaveBeenCalledTimes(1);
      const replay = parse(await handleWorldCommand(runtime, request));
      expect(replay.replayed).toBe(true);
      expect(replay.masterTurn).toEqual(body.masterTurn);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(store.loadEvents(WORLD)).toEqual(events);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
    } finally { store.close(); }
  });

  it("normalizes a model's plain clarification string through the real handler without changing the world", async () => {
    const question = "Такое действие здесь недоступно. Что ты хочешь попробовать вместо него?";
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "clarification", clarification: question,
    }));
    const { store, runtime } = await fresh(router);
    const beforeTime = runtime.projection.getSnapshot().time;
    const beforeEvents = store.loadEvents(WORLD);
    const request = { input: "Я взлетаю над рекой без крыльев и улетаю на Луну.", idempotencyKey: "string-clarification-alias" };
    try {
      const body = parse(await handleWorldCommand(runtime, request));
      expect(body).toMatchObject({ status: "clarification", masterTurn: { deterministicText: question } });
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(store.loadEvents(WORLD)).toEqual(beforeEvents);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat).toHaveBeenCalledTimes(1);
      const replay = parse(await handleWorldCommand(runtime, request));
      expect(replay.replayed).toBe(true);
      expect(replay.masterTurn).toEqual(body.masterTurn);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(store.loadEvents(WORLD)).toEqual(beforeEvents);
    } finally { store.close(); }
  });

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

  it("keeps a direct unsupported question with its explicitly addressed unknown NPC", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", "contact:riverwatch-gatekeeper");
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const gatekeeper = scene.context.knownPeople.find((person) => person.portrait?.addressForms.includes("смотритель"));
    expect(gatekeeper).toBeDefined();
    expect(gatekeeper).toMatchObject({ label: "Незнакомый человек", known: false });
    decision = {
      schemaVersion: 2,
      addressee: { kind: "npc", handle: stableActorHandle(gatekeeper!.observerRef) },
      kind: "conversation",
      response: { segments: [{ kind: "social", act: "no_knowledge" }] },
    };
    const beforeTime = runtime.projection.getSnapshot().time;
    const beforeEvents = store.loadEvents(WORLD).length;
    const input = "Смотритель, почему вы ведёте журнал проходов?";
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-question-no-knowledge" }));
      expect(body.status).toBe("conversation");
      expect(body.conversationTurn.responseKind).toBe("speech_reaction");
      expect(body.masterTurn.deterministicText).toContain("Незнакомый человек");
      expect(body.masterTurn.deterministicText).toContain("У меня нет подтверждённых сведений об этом.");
      expect(body.masterTurn.deterministicText).not.toContain("Смотритель речных ворот");
      expect(JSON.stringify(body)).not.toMatch(/person_|contact:|targetRef|internalId|Смотритель речных ворот/iu);
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(store.loadEvents(WORLD)).toHaveLength(beforeEvents);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);

      const replay = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-question-no-knowledge" }));
      expect(replay.replayed).toBe(true);
      expect(replay.masterTurn).toEqual(body.masterTurn);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(store.loadEvents(WORLD)).toHaveLength(beforeEvents);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it.each([true, false])("binds a speech-wrapped NPC question to the named person (correct speaker: %s)", async (correctSpeaker) => {
    let decision: unknown;
    const { router } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [], "keeper");
    const people = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot()).context.knownPeople;
    const keeper = people.find((person) => person.label.includes("Смотритель"));
    const archivist = people.find((person) => person.label.includes("Архивист"));
    expect(keeper).toBeDefined();
    expect(archivist).toBeDefined();
    const speaker = correctSpeaker ? keeper! : archivist!;
    decision = {
      schemaVersion: 2, addressee: { kind: "npc", handle: stableActorHandle(speaker.observerRef) },
      kind: "conversation", response: { segments: [{ kind: "social", act: "no_knowledge" }] },
    };
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Спросить у Смотрителя, кто последним ушёл по восточному тракту.",
        idempotencyKey: "speech-wrapped-person-" + String(correctSpeaker),
      }));
      if (correctSpeaker) {
        expect(body.conversationTurn.responseKind).toBe("speech_reaction");
        expect(body.masterTurn.deterministicText).toContain("Смотритель");
        expect(body.masterTurn.deterministicText).toContain("нет подтверждённых сведений");
      } else {
        expect(body.conversationTurn.responseKind).toBe("clarification");
        expect(body.masterTurn.deterministicText).not.toContain("Архивист Речного Стража:");
      }
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
    } finally { store.close(); }
  });

  it.each([
    "Смотритель, кто последним ушёл по восточному тракту?",
    "Спросить у Смотрителя, кто последним ушёл по восточному тракту.",
  ])("answers an unsupported NPC question honestly instead of disclosing an unrelated fact: %s", async (input) => {
    let decision: unknown;
    const { router } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [], "keeper");
    const world = runtime.projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), world);
    const keeper = scene.context.knownPeople.find((person) => person.label.includes("Смотритель"));
    expect(keeper).toBeDefined();
    const handle = stableActorHandle(keeper!.observerRef);
    const bundle = buildGmContext({ scene: scene.context, conversation: EMPTY_MASTER_CONVERSATION,
      sceneReferences: scene.references, npcDossiers: world.npcDossiers });
    const roleFact = bundle.context.npcFacts.find((fact) => fact.subjectHandle === handle && fact.text.includes("журнал проходов"));
    expect(roleFact).toBeDefined();
    decision = { schemaVersion: 2, addressee: { kind: "npc", handle }, kind: "conversation",
      response: { segments: [{ kind: "npc_fact", factId: roleFact!.factId }] } };
    const eventsBefore = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input, idempotencyKey: "npc-unrelated-role-fact",
      }));
      expect(body.conversationTurn.responseKind).toBe("speech_reaction");
      expect(body.masterTurn.deterministicText).toContain("нет подтверждённых сведений");
      expect(body.masterTurn.deterministicText).not.toContain("ведёт журнал проходов");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(eventsBefore);
    } finally { store.close(); }
  });

  it("renders only a disclosed dossier fact selected for the explicitly addressed NPC", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", "contact:riverwatch-gatekeeper");
    const world = runtime.projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), world);
    const gatekeeper = scene.context.knownPeople.find((person) => person.portrait?.addressForms.includes("смотритель"));
    expect(gatekeeper).toBeDefined();
    const handle = stableActorHandle(gatekeeper!.observerRef);
    const bundle = buildGmContext({
      scene: scene.context,
      conversation: EMPTY_MASTER_CONVERSATION,
      sceneReferences: scene.references,
      npcDossiers: world.npcDossiers,
    });
    const publicFact = bundle.context.npcFacts.find((fact) => fact.subjectHandle === handle && fact.text.includes("журнал проходов"));
    expect(publicFact).toBeDefined();
    expect(bundle.context.npcFacts.some((fact) => /contact:|person_|locationId/iu.test(fact.factId + fact.text))).toBe(false);
    decision = {
      schemaVersion: 2,
      addressee: { kind: "npc", handle },
      kind: "conversation",
      response: { segments: [{ kind: "npc_fact", factId: publicFact!.factId }] },
    };
    const beforeTime = world.time;
    const beforeEvents = store.loadEvents(WORLD).length;
    const input = "Смотритель, что вы ведёте у ворот?";
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-dossier-disclosure" }));
      expect(body.status, JSON.stringify(body)).toBe("conversation");
      expect(body.masterTurn.deterministicText).toContain(publicFact!.text);
      expect(body.masterTurn.deterministicText).toContain("Незнакомый человек");
      expect(body.masterTurn.deterministicText).not.toMatch(/person_|contact:|targetRef|internalId|locationId|observerRef/iu);
      expect(body.conversationTurn.worldTimeBefore).toBe(beforeTime);
      expect(body.conversationTurn.worldTimeAfter).toBe(beforeTime);
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(store.loadEvents(WORLD)).toHaveLength(beforeEvents);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);

      decision = {
        schemaVersion: 2,
        addressee: { kind: "npc", handle },
        kind: "conversation",
        response: { segments: [{ kind: "npc_fact", factId: "nf0000000000000000" }] },
      };
      const denied = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-dossier-fabricated-fact" }));
      expect(denied.status).not.toBe("conversation");
      expect(JSON.stringify(denied)).not.toContain(publicFact!.text);
      expect(JSON.stringify(denied)).not.toMatch(/contact:|person_|targetRef|internalId|locationId|observerRef/iu);
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(store.loadEvents(WORLD)).toHaveLength(beforeEvents);
      expect(store.listConversationTurns(WORLD)).toHaveLength(2);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(2);
    } finally { store.close(); }
  });

  it("answers a multi-part NPC question in one zero-event reply and fails closed on a dropped part", async () => {
    let decision: unknown;
    const { router, chat } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", "contact:riverwatch-gatekeeper");
    const world = runtime.projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), world);
    const gatekeeper = scene.context.knownPeople.find((person) => person.portrait?.addressForms.includes("смотритель"));
    expect(gatekeeper).toBeDefined();
    const handle = stableActorHandle(gatekeeper!.observerRef);
    const bundle = buildGmContext({
      scene: scene.context,
      conversation: EMPTY_MASTER_CONVERSATION,
      sceneReferences: scene.references,
      npcDossiers: world.npcDossiers,
    });
    const publicFact = bundle.context.npcFacts.find((fact) => fact.subjectHandle === handle && fact.text.includes("журнал проходов"));
    expect(publicFact).toBeDefined();
    const input = "Смотритель, расскажите про журнал проходов у ворот и кто ещё дежурит с вами?";
    const plan = {
      subjects: [{ id: "s", surface: "смотритель", kind: "entity" as const }],
      parts: [
        { id: "p1", subjectRefs: ["s"], aspect: "identity_role" as const, time: "current" as const, purpose: "describe" as const },
        { id: "p2", subjectRefs: ["s"], aspect: "current_activity" as const, time: "current" as const, purpose: "describe" as const },
      ],
      fragments: [
        { partId: "p1", text: "расскажите про журнал проходов у ворот" },
        { partId: "p2", text: "кто ещё дежурит с вами" },
      ],
    };
    decision = {
      schemaVersion: 2,
      addressee: { kind: "npc", handle },
      kind: "conversation",
      questionPlan: plan,
      response: { segments: [
        { kind: "npc_fact", factId: publicFact!.factId, partId: "p1" },
        { kind: "social", act: "no_knowledge", partId: "p2" },
      ] },
    };
    const beforeTime = world.time;
    const beforeEvents = store.loadEvents(WORLD).length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-multipart-question" }));
      expect(body.status, JSON.stringify(body)).toBe("conversation");
      // One composed reply: the answered part keeps its authored fact, the
      // unanswered part stays an explicit honest gap.
      expect(body.masterTurn.deterministicText).toContain(publicFact!.text);
      expect(body.masterTurn.deterministicText).toContain("Об этом я не могу сказать ничего определённого.");
      expect(body.masterTurn.deterministicText).not.toMatch(/person_|contact:|targetRef|internalId|locationId|observerRef/iu);
      expect(body.conversationTurn.worldTimeBefore).toBe(beforeTime);
      expect(body.conversationTurn.worldTimeAfter).toBe(beforeTime);
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(store.loadEvents(WORLD)).toHaveLength(beforeEvents);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);

      // Same key replays the persisted envelope without another model call.
      const replay = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-multipart-question" }));
      expect(replay.replayed).toBe(true);
      expect(replay.masterTurn.deterministicText).toContain(publicFact!.text);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);

      // A decision that drops the second question part must never render a
      // partial answer through the NPC.
      decision = {
        schemaVersion: 2,
        addressee: { kind: "npc", handle },
        kind: "conversation",
        questionPlan: plan,
        response: { segments: [{ kind: "npc_fact", factId: publicFact!.factId, partId: "p1" }] },
      };
      const dropped = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-multipart-dropped-part" }));
      expect(dropped.status).not.toBe("conversation");
      expect(JSON.stringify(dropped)).not.toContain("Об этом я не могу сказать ничего определённого.");
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(store.loadEvents(WORLD)).toHaveLength(beforeEvents);
      expect(store.listConversationTurns(WORLD)).toHaveLength(2);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(2);
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
      expect(body.status).toBe("clarification");
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(body.masterTurn.kind).not.toBe("speech_reaction");
      expect(body.masterTurn.kind).not.toBe("action_outcome");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(count);
      const replay = parse(await handleWorldCommand(runtime, { input: "Что именно известно о ночном следе?", idempotencyKey: "offline-question" }));
      expect(replay.replayed).toBe(true);
      expect(replay.masterTurn).toEqual(body.masterTurn);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
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

  it("does not answer an unregistered topic question with a generic visible-scene query", async () => {
    const input = "Что известно о ночном шуме?";
    const { router } = routerFor(() => ({
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "world_question",
      proposal: {
        schemaVersion: 2,
        kind: "inquiry",
        primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: input },
        supportingClauses: [],
        referents: [],
      },
    }));
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival");
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "unregistered-night-noise-question" }));
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(body.masterTurn.kind).toBe("contextual_clarification");
      expect(body.masterTurn.deterministicText).not.toContain("Город за стенами");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
    } finally { store.close(); }
  });

  it.each(["Кто рядом?", "Кто ещё рядом?", "Кто сейчас рядом?"])("answers people-list %j with safe DTO and retained server memory", async (input) => {
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "world_question",
      proposal: {
        schemaVersion: 2,
        kind: "inquiry",
        primaryIntent: { kind: "inquiry", queryId: "who_is_nearby", sourceText: input },
        supportingClauses: [],
        referents: [],
      },
    }));
    const { store, runtime } = await fresh(router);
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "model-nearby-dto" }));
      expect(body.status).toBe("inquiry");
      expect(body.inquiries).toHaveLength(1);
      expect(body.inquiry.shownLists[0]).toMatchObject({ listRef: "scene_people" });
      expect(body.inquiry.shownLists[0]).not.toHaveProperty("observerRefs");
      expect(JSON.stringify(body)).not.toMatch(/observerRefs|person_[0-9]+|internalId/u);
      const stored = store.getConversationTurn(WORLD, "model-nearby-dto")?.contextMetadata?.shownLists?.[0];
      expect(stored?.memberIdentities?.[0]?.internalId).toBeTruthy();
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("fails closed instead of letting a live world-question silently drop an unavailable observation target", async () => {
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "world_question",
      proposal: {
        schemaVersion: 2,
        kind: "inquiry",
        primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: "что я вижу?" },
        supportingClauses: [],
        referents: [],
      },
    }));
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival");
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Осматриваю двор, что я вижу?",
        idempotencyKey: "recognized-observation-question",
      }));
      expect(body.status).toBe("clarification");
      expect(body.masterTurn.kind).toBe("contextual_clarification");
      expect(body.question).toContain("двор");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("executes a recognized observation plus question through the bounded deterministic compound path", async () => {
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "world_question",
      proposal: {
        schemaVersion: 2,
        kind: "inquiry",
        primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: "что я вижу?" },
        supportingClauses: [],
        referents: [],
      },
    }));
    const { store, runtime } = await fresh(router);
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Осматриваю ограду, что я вижу?",
        idempotencyKey: "recognized-fence-observation-question",
      }));
      expect(body.masterTurn.kind).toBe("mixed_outcome");
      expect(body.masterTurn.deterministicText).toMatch(/оград|перед тобой|видишь/iu);
      expect(runtime.projection.getSnapshot().time).toBe(1);
      expect(runtime.bus.query().length).toBeGreaterThan(beforeEvents);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it.each([
    "Нет, передумал: осматриваюсь.",
    "Отменяю разговор и осматриваюсь.",
    "Я передумал: осмотрю знак поближе.",
  ])("preserves a recognized observation after corrective framing: %s", async (input) => {
    const { router, chat } = routerFor(() => ({
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "world_question",
      proposal: {
        schemaVersion: 2,
        kind: "inquiry",
        primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: "осматриваюсь" },
        supportingClauses: [],
        referents: [],
      },
    }));
    const signEvents: DomainEvent[] = input.includes("знак") ? [
      {
        eventId: "corrective-sign-placed", type: "WorldObjectPlaced", schemaVersion: 1,
        payload: {
          id: "sign", name: "Знак", aliases: ["знак", "знака", "знаком", "знаку"],
          description: "Потёртый знак у переправы.", material: "wood", locationId: "river_waystation",
          integrity: 100, temperature: 20, state: {},
        }, timestamp: 0, correlationId: "bootstrap", causationId: null,
      },
      {
        eventId: "corrective-sign-observed", type: "ObjectObserved", schemaVersion: 1,
        payload: { objectId: "sign", observerId: "player", description: "Потёртый знак у переправы." },
        timestamp: 0, correlationId: "bootstrap", causationId: "corrective-sign-placed",
      },
    ] : [];
    const { store, runtime } = await fresh(router, "river_waystation_arrival", undefined, signEvents, "wanderer");
    try {
      const beforeEvents = runtime.bus.query().length;
      const beforeTime = runtime.projection.getSnapshot().time;
      const body = parse(await handleWorldCommand(runtime, {
        input,
        idempotencyKey: "corrective-observation-" + input.length,
      }));
      expect(body.masterTurn.kind, JSON.stringify(body)).toBe("action_outcome");
      expect(body.conversationTurn.responseKind).toBe("action_outcome");
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime + 1);
      const emittedEvents = runtime.bus.query().slice(beforeEvents);
      expect(emittedEvents.length).toBeGreaterThan(0);
      if (input.includes("знак")) {
        const observedIds = emittedEvents
        .filter((event) => event.type === "ObjectObserved")
        .map((event) => (event.payload as { objectId?: string }).objectId);
        expect(observedIds).toContain("sign");
      }
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("executes a supported mixed action and question from the closed path when the provider is unavailable", async () => {
    const chat = vi.fn(async (category: string) => {
      if (category !== "interpret") return { text: "" };
      throw new Error("provider unavailable");
    });
    const { store, runtime } = await fresh({ apiKey: "", chat });
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Осматриваюсь, что я вижу?",
        idempotencyKey: "provider-down-supported-mixed",
      }));

      expect(body.masterTurn.kind).toBe("mixed_outcome");
      expect(body.masterTurn.deterministicText).toMatch(/оград|перед тобой|видишь/iu);
      expect(runtime.projection.getSnapshot().time).toBe(1);
      expect(runtime.bus.query().length).toBeGreaterThan(beforeEvents);
      expect(runtime.bus.query().slice(beforeEvents).some((event) => event.type === "InteractionRequested")).toBe(true);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
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

  it("returns a question-specific clarification when the live proposal drops a standalone question", async () => {
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
        input: "Что именно известно о ночном следе?", idempotencyKey: "dropped-standalone-question",
      }));
      expect(body.status).toBe("clarification");
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(body.question).toContain("задаёшь вопрос");
      expect(["clarification", "contextual_clarification"]).toContain(body.masterTurn.kind);
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(store.loadEvents(WORLD)).toHaveLength(count);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
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
      expect(body.status).toBe("clarification");
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(body.question).toContain("Подойти к Перевозчику");
      expect(body.question).toContain("кто рядом");
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
      const body = parse(await handleWorldCommand(runtime, { input: "Что можно узнать об одежде и поведении Перевозчика у переправы?", idempotencyKey: "parts-only" }));
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

  it.each(["grounded", "fabricated", "extra-prose"] as const)("combines exact ruins inspection and its question with %s narration", async (mode) => {
    const input = "Я внимательно осматриваю древние развалины и пытаюсь понять, что здесь произошло";
    const decision = {
      schemaVersion: 2,
      addressee: { kind: "gm" },
      kind: "mixed",
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: {
          kind: "interaction",
          verb: "observe",
          sourceText: "внимательно осматриваю древние развалины",
        },
        supportingClauses: [],
        referents: [],
        questionPlan: {
          subjects: [{ id: "here", surface: "здесь", kind: "place" }],
          parts: [{ id: "history", subjectRefs: ["here"], aspect: "known_event", time: "past", purpose: "explain" }],
        },
        readings: [{ partId: "history", source: "known_events" }],
      },
    };
    let supplied: AllowedNarrativeFacts | undefined;
    let generated: string | null = null;
    const chat = vi.fn(async (category: string, messages: readonly { content: string }[]) => {
      if (category === "interpret") return { text: JSON.stringify(decision), provider: "test", model: "director", usedFallback: false };
      const { allowed } = JSON.parse(messages[1]!.content) as { allowed: AllowedNarrativeFacts };
      supplied = allowed;
      expect(messages[0]!.content).toContain("только соединение claims[i].text");
      const text = mode !== "fabricated" ? JSON.stringify({
        narration: allowed.mandatory.join(" ") + (mode === "extra-prose" ? " Вокруг тихо." : ""),
        claims: allowed.facts.map((fact) => ({ text: fact.content, ref: fact.ref, assertion: fact.assertion })),
        coveredMandatory: allowed.mandatory,
      }) : JSON.stringify({
        narration: "Здесь стоял король.",
        claims: [{ text: "Здесь стоял король.", ref: "f99", assertion: "observed" }],
        coveredMandatory: allowed.mandatory,
      });
      generated = text;
      return { text, provider: "test", model: "narrator", usedFallback: false, latencyMs: 1 };
    });
    const router = { apiKey: "test-only", timeoutSeconds: 1, chat };
    const ruinsArrival: DomainEvent = {
      eventId: "test-setup-player-location-old-ruins",
      type: "PlayerLocationChanged",
      schemaVersion: 1,
      payload: { locationId: "old_ruins" },
      timestamp: 0,
      correlationId: "test-setup",
      causationId: null,
    };
    const { store, runtime } = await fresh(router, "river_waystation_arrival", undefined, [ruinsArrival]);
    const beforeTime = runtime.projection.getSnapshot().time;
    const beforeEvents = runtime.bus.query().length;

    try {
      expect(runtime.projection.getSnapshot().currentLocationId).toBe("old_ruins");
      const body = parse(await handleWorldCommand(runtime, {
        input,
        idempotencyKey: "exact-ruins-observation-with-question",
      }));

      expect(body.masterTurn.kind).toBe("mixed_outcome");
      expect(body.conversationTurn.responseKind).toBe("mixed_outcome");
      expect(body.conversationTurn.responseText).toContain(ANSWER_GAP_STATEMENT);
      expect(body.masterTurn.narration.status).toBe("pending");
      expect(store.listConversationTurns(WORLD)[0]?.responseText).toContain(ANSWER_GAP_STATEMENT);
      expect(body.questionReadings.coveredParts).not.toContain("history");
      expect(body.questionReadings.results).toHaveLength(1);
      expect(body.questionReadings.results[0]).toMatchObject({
        request: { partId: "history", source: "known_events" },
        status: "no_data",
        facts: [],
      });
      expect(body.questionReadings.results[0].gaps).toContainEqual(
        expect.objectContaining({ partId: "history", status: "no_data", aspect: "known_event" }),
      );
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime + 1);
      const emitted = runtime.bus.query().slice(beforeEvents);
      const world = runtime.projection.getSnapshot();
      const description = world.locations.get("old_ruins")!.description!;
      expect(verifyP3RuinsPerception("old_ruins", "old_ruins", beforeTime, world.time, description, emitted)).toBe(true);
      expect(verifyP3RuinsPerception("old_ruins", "riverwatch_city", beforeTime, world.time, description, emitted)).toBe(false);
      expect(verifyP3RuinsPerception("old_ruins", "old_ruins", beforeTime, world.time, description, emitted.filter((event) => event.type !== "TargetResolved"))).toBe(false);
      const locationLabel = world.locations.get("old_ruins")!.name!;
      const spec = readP3RuinsQuestionSpec(decision, locationLabel, { worldTime: beforeTime, eventNumber: beforeEvents });
      expect(spec).not.toBeNull();
      expect(readP3RuinsQuestionSpec({ ...decision, kind: "world_question" }, locationLabel, { worldTime: beforeTime, eventNumber: beforeEvents })).toBeNull();
      const round = executeQuestionReadingRound(spec!, {
        scene: buildMasterTurnSceneContext(runtime.bus.query(), world),
        revision: { worldTime: world.time, eventNumber: world.eventNumber }, transcript: null,
        narrative: buildNarrativeAdapterContext(runtime.bus.query(), world, {
          characterName: null, entrypoint: null, presentation: null, openingWindow: false,
          profile: store.getCharacterProfile(store.getWorldRecord(WORLD)!.characterId!),
        }),
      });
      const statements = verifyP3RuinsQuestionReading(round, body.questionReadings);
      expect(statements).toContain(ANSWER_GAP_STATEMENT);
      expect(verifyP3RuinsQuestionReading(round, { ...body.questionReadings, results: [] })).toBeNull();
      expect(JSON.stringify(body)).not.toMatch(/person_\d+|object_\d+|route_\d+|targetRef|locationId|contactRef|internalId/u);
      expect(chat.mock.calls.filter(([category]) => category === "interpret")).toHaveLength(1);
      await vi.waitFor(() => {
        const journal = parse(handleWorldJournal(runtime, new URL("http://127.0.0.1/journal?limit=10")));
        const turn = journal.turns.find((entry: any) => entry.narrationHandle === body.conversationTurn.narrationHandle);
        expect(turn?.narrationState).toBe(mode === "grounded" ? "ready" : "unavailable");
        expect(verifyP3RuinsNarration(
          actionOutcomeText(input, emitted, world).text, statements, supplied ?? null, generated,
          extractP3PlayerVisibleResponse({ ...body, journalTurn: turn }), true,
        )).toBe(mode === "grounded");
        if (mode === "grounded") expect(turn?.narrativeLLM?.text).toContain(ANSWER_GAP_STATEMENT);
        else expect(turn?.narrativeLLM).toBeFalsy();
      });
      expect(supplied?.mandatory).toContain(ANSWER_GAP_STATEMENT);
      expect(chat.mock.calls.filter(([category]) => category === "narrate")).toHaveLength(1);
      const replay = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "exact-ruins-observation-with-question" }));
      expect(replay.replayed).toBe(true);
      expect(replay.conversationTurn.responseText).toBe(body.conversationTurn.responseText);
      expect(replay.questionReadings).toEqual(body.questionReadings);
      expect(chat).toHaveBeenCalledTimes(2);
      expect(runtime.bus.query()).toHaveLength(beforeEvents + emitted.length);
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
      expect(body.masterTurn.deterministicText).toContain("Здравствуй.");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(count);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });

  it("acknowledges bare gratitude read-only when the live provider is unavailable", async () => {
    const chat = vi.fn(async () => { throw new Error("provider down"); });
    const { store, runtime } = await fresh({ apiKey: "", chat });
    const beforeTime = runtime.projection.getSnapshot().time;
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input: "Спасибо.", idempotencyKey: "offline-thanks" }));
      expect(body).toMatchObject({ status: "conversation", conversationTurn: { responseKind: "speech_reaction", worldTimeBefore: beforeTime, worldTimeAfter: beforeTime } });
      expect(body.masterTurn.deterministicText).toBe("Пожалуйста.");
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(chat).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });

  it("answers an explicitly addressed unsupported NPC question with no-knowledge on provider failure", async () => {
    const chat = vi.fn(async () => { throw new Error("provider down"); });
    const { store, runtime } = await fresh({ apiKey: "", chat }, "riverwatch_city_arrival");
    const beforeTime = runtime.projection.getSnapshot().time;
    const beforeEvents = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, {
        input: "Смотритель, кто последним ушёл по восточному тракту?",
        idempotencyKey: "offline-npc-unknown",
      }));
      expect(body.masterTurn.kind).toBe("speech_reaction");
      expect(body.masterTurn.deterministicText).toContain("нет подтверждённых сведений");
      expect(body.masterTurn.deterministicText).not.toContain("ведёт журнал проходов");
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
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

  it("records structured live provider failures only in trusted diagnostics", async () => {
    const transport = { provider: "opencode_server" as const, model: "opencode/free-model" };
    const traceId = "upstream-test-trace";
    const chat = vi.fn(async () => {
      throw new ProviderUnavailableError("PRIVATE_ROUTER_ERROR", {
        ...transport,
        configuredModel: transport.model,
        cause: new ProviderRequestError({
          ...transport, category: "interpret", phase: "response_status",
          httpStatus: 429, gatewayHttpStatus: 502, providerCode: "rate_limited", providerTraceId: traceId,
          retryAfterHeaderRaw: "75", retryAfterMsParsed: 75_000, retryAfterMsApplied: 75_000,
          retryable: false, cause: new Error("PRIVATE_UPSTREAM_BODY"),
        }),
      });
    });
    const { store, runtime, manager } = await fresh({ apiKey: "", chat }, "riverwatch_city_arrival");
    const before = runtime.projection.getSnapshot().time;
    const events = store.loadEvents(WORLD);
    const request = { input: "Привет, смотритель", idempotencyKey: "live-provider-diagnostics" };
    try {
      const body = parse(await handleWorldCommand(runtime, request));
      expect(body.conversationTurn).toMatchObject({ responseKind: "speech_reaction", worldTimeAfter: before });
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE_(?:ROUTER_ERROR|UPSTREAM_BODY)|upstream-test-trace/u);
      const diagnostics = manager.narrationDiagnostics().filter((entry) => entry.category === "gm_director");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        ...transport, phase: "live", outcome: "fallback", failureCategory: "provider_error",
        providerPhase: "response_status", httpStatus: 429, gatewayHttpStatus: 502,
        providerCode: "rate_limited", providerTraceId: traceId,
        retryAfterHeaderRaw: "75", retryAfterMsParsed: 75_000, retryAfterMsApplied: 75_000,
        providerRetryable: false, decisionAccepted: false,
        providerLatencyMs: expect.any(Number), totalLatencyMs: expect.any(Number),
      });
      expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_(?:ROUTER_ERROR|UPSTREAM_BODY)/u);

      const replay = parse(await handleWorldCommand(runtime, request));
      expect(replay.replayed).toBe(true);
      expect(manager.narrationDiagnostics().filter((entry) => entry.category === "gm_director")).toHaveLength(1);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(store.loadEvents(WORLD)).toEqual(events);
      expect(runtime.projection.getSnapshot().time).toBe(before);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
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

  it.each([
    "Спросить у Смотрителя, кто последним ушёл по восточному тракту.",
    "Спроси у Смотрителя, что случилось у переправы.",
    "Расспросить Смотрителя, где находится журнал.",
  ])("does not turn an explicitly asked NPC question %j into a generic speak action", async (input) => {
    let decision: unknown;
    const { router } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [], "keeper");
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const keeper = scene.context.knownPeople.find((person) => person.label.includes("Смотритель"));
    expect(keeper).toBeDefined();
    const handle = stableActorHandle(keeper!.observerRef);
    const addressee = { role: "addressee", surface: keeper!.label, observerRef: handle };
    decision = {
      schemaVersion: 2, addressee: { kind: "npc", handle }, kind: "action",
      proposal: {
        schemaVersion: 2, kind: "action",
        primaryIntent: { kind: "legacy", operation: "speak", sourceText: input },
        addressedEntity: addressee, referents: [addressee], supportingClauses: [],
      },
    };
    const eventsBefore = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "npc-question-no-question-mark" }));
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(eventsBefore);
    } finally { store.close(); }
  });

  it("does not replace an explicitly named gate target with the nearby gatekeeper", async () => {
    let decision: unknown;
    const { router } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [], "keeper");
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const keeper = scene.context.knownPeople.find((person) => person.label.includes("Смотритель"));
    expect(keeper).toBeDefined();
    const handle = stableActorHandle(keeper!.observerRef);
    const input = "Оглянусь на городские ворота и прислушаюсь к торговому шуму.";
    const target = { role: "target", surface: keeper!.label, observerRef: handle };
    decision = {
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "mixed",
      proposal: {
        schemaVersion: 2, kind: "mixed",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Оглянусь на городские ворота" },
        target, referents: [target], supportingClauses: [{ kind: "deferred_action", summary: "прислушаюсь к торговому шуму" }],
      },
    };
    const eventsBefore = runtime.bus.query().length;
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "explicit-gates-not-gatekeeper" }));
      expect(body.conversationTurn.responseKind).toBe("clarification");
      expect(runtime.projection.getSnapshot().time).toBe(0);
      expect(runtime.bus.query()).toHaveLength(eventsBefore);
    } finally { store.close(); }
  });

  it("still allows a model proposal for the person explicitly named in an inflected form", async () => {
    let decision: unknown;
    const { router } = routerFor(() => decision);
    const { store, runtime } = await fresh(router, "riverwatch_city_arrival", undefined, [], "keeper");
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), runtime.projection.getSnapshot());
    const keeper = scene.context.knownPeople.find((person) => person.label.includes("Смотритель"));
    expect(keeper).toBeDefined();
    const handle = stableActorHandle(keeper!.observerRef);
    const input = "Оглянусь на смотрителя и прислушаюсь к торговому шуму.";
    const target = { role: "target", surface: keeper!.label, observerRef: handle };
    decision = {
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "mixed",
      proposal: {
        schemaVersion: 2, kind: "mixed",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Оглянусь на смотрителя" },
        target, referents: [target], supportingClauses: [{ kind: "deferred_action", summary: "прислушаюсь к торговому шуму" }],
      },
    };
    try {
      const body = parse(await handleWorldCommand(runtime, { input, idempotencyKey: "explicit-gatekeeper-not-blocked" }));
      expect(body.conversationTurn.responseKind).toBe("mixed_outcome");
      expect(body.masterTurn.deterministicText).toContain("Смотритель");
      expect(runtime.projection.getSnapshot().time).toBe(1);
    } finally { store.close(); }
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

  it("does not turn thanks after an NPC topic prompt into a topic fragment", async () => {
    let targetHandle = "";
    const { router, chat } = routerFor(() => ({
      ...social("gratitude_acknowledgement"),
      addressee: { kind: "npc", handle: targetHandle },
    }));
    const { store, runtime } = await fresh(router);
    const target = ferry(runtime);
    targetHandle = target.handle;
    try {
      await handleWorldCommand(runtime, { input: "Подойти к перевозчику", idempotencyKey: "thanks-approach" });
      const topicPrompt = parse(await handleWorldCommand(runtime, {
        input: "Хочу поговорить с ним",
        idempotencyKey: "thanks-topic-prompt",
      }));
      expect(topicPrompt.masterTurn.deterministicText).toContain("О чём ты хочешь поговорить?");

      const beforeTime = runtime.projection.getSnapshot().time;
      const beforeEvents = runtime.bus.query().length;
      const thanks = parse(await handleWorldCommand(runtime, {
        input: "Спасибо.",
        idempotencyKey: "thanks-after-topic-prompt",
      }));
      expect(chat).toHaveBeenCalledTimes(1);
      expect(thanks).toMatchObject({
        status: "conversation",
        conversationTurn: { responseKind: "speech_reaction", worldTimeBefore: beforeTime, worldTimeAfter: beforeTime },
      });
      expect(thanks.masterTurn.deterministicText).toBe(target.label + ": «Пожалуйста.»");
      expect(thanks.masterTurn.deterministicText).not.toContain("речь о");
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
      expect(runtime.bus.query()).toHaveLength(beforeEvents);
    } finally { store.close(); }
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
