import { describe, expect, it, vi } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { WorldProjector, buildMasterTurnSceneContext, createRules } from "@skald/world";
import { RuleEngine } from "@skald/rule-engine";
import { isGenericFallbackText } from "@skald/intent-parser";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import { interpretMasterTurn, type MasterTurnSnapshot } from "../src/runtime/master-turn-gateway.js";

function event(type: string, eventId: string, payload: unknown, timestamp = 0): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "bootstrap", causationId: null };
}

function bootstrap(): DomainEvent[] {
  return [
    event("PlayerSpawned", "boot-player", { x: 0, y: 0 }),
    event("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: ["fence"], connections: {},
    }),
    event("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }),
    event("WorldObjectPlaced", "boot-object-fence", {
      id: "fence", name: "Ограда", aliases: ["ограду", "оградой"], description: "Почерневшая ограда.",
      material: "wood", locationId: "camp", integrity: 100, temperature: 20, state: {},
    }),
    event("ObjectObserved", "boot-fence-noticed", {
      objectId: "fence", observerId: "player", description: "Почерневшая ограда.",
    }),
  ];
}

function snapshot(): MasterTurnSnapshot {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const log = bootstrap();
  for (const entry of log) {
    projection.apply(entry);
    bus.append(entry);
  }
  // Keep the engine import referenced: execution tests own the engine path.
  void RuleEngine;
  void createRules;
  const events = bus.query();
  const world = projection.getSnapshot();
  const scene = buildMasterTurnSceneContext(events, world);
  const conversation = buildMasterConversationContext([], "test-world");
  return { events, world, scene, conversation };
}

function routerReturning(text: string) {
  return { chat: vi.fn().mockResolvedValue({ text }) } as any;
}

describe("master turn gateway V2", () => {
  it("takes the deterministic fast path without calling the model", async () => {
    const router = routerReturning("{}");
    const result = await interpretMasterTurn("осмотреться", snapshot(), router);

    expect(result.status).toBe("deterministic");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("answers deterministic inquiries without a model call", async () => {
    const router = routerReturning("{}");
    const result = await interpretMasterTurn("где я?", snapshot(), router);

    expect(result.status).toBe("inquiry");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("falls back honestly when the model is unavailable", async () => {
    const result = await interpretMasterTurn("сделай нечто странное", snapshot(), null);

    // UnsupportedButUnderstood stays unsupported; the HTTP layer renders it
    // as a natural clarification, never as a technical error.
    expect(["clarification", "unsupported", "unavailable"]).toContain(result.status);
  });

  it("maps a valid TurnProposalV2 to a validated plan", async () => {
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ограде." },
      supportingClauses: [],
      target: { role: "target", observerRef: fence!.observerRef, surface: fence!.label },
      referents: [{ role: "target", observerRef: fence!.observerRef, surface: fence!.label }],
    }));

    const result = await interpretMasterTurn("Подхожу к ограде.", snap, router);

    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.execution?.intent).toMatchObject({ type: "ActionIntentCommand" });
    expect(router.chat).toHaveBeenCalledTimes(1);
    const [category, messages] = router.chat.mock.calls[0] as any[];
    expect(category).toBe("interpret");
    expect(messages[0].content).not.toContain("Подхожу к ограде.");
  });

  it("sends the master_turn envelope with bindings bound to the snapshot scene", async () => {
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ней." },
      supportingClauses: [],
      target: { role: "target", observerRef: fence!.observerRef, surface: fence!.label },
      referents: [{ role: "target", observerRef: fence!.observerRef, surface: fence!.label }],
      ambiguity: { kind: "referent", question: "К чему именно подойти?", candidates: ["Ограда", "Двор"] },
    }));

    await interpretMasterTurn("Подхожу к ней.", snap, router);

    const [, messages] = router.chat.mock.calls[0] as any[];
    const block = JSON.parse(messages[1].content) as Record<string, any>;
    expect(block.kind).toBe("master_turn");
    expect(block.currentInput).toBe("Подхожу к ней.");
    expect(block.conversationContext.currentScene).toMatchObject({ schemaVersion: 1 });
    expect(block.pronounBindings).toEqual(
      expect.arrayContaining([expect.objectContaining({ pronoun: "ней" })]),
    );
    expect(JSON.stringify(block)).not.toMatch(/worldId|entityId|eventId/);
  });

  it("returns model-reported ambiguity as clarification", async () => {
    // Pronoun-bearing input skips the deterministic fast path by design,
    // so the model ambiguity reaches the player instead of a structural gate.
    // Static validation requires a valid primary alongside the ambiguity.
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ней." },
      supportingClauses: [],
      target: { role: "target", observerRef: fence!.observerRef, surface: fence!.label },
      referents: [{ role: "target", observerRef: fence!.observerRef, surface: fence!.label }],
      ambiguity: { kind: "referent", question: "К чему именно подойти?", candidates: ["Ограда", "Двор"] },
    }));

    const result = await interpretMasterTurn("Подхожу к ней.", snap, router);

    expect(result).toMatchObject({ status: "clarification", question: "К чему именно подойти?" });
  });

  it("carries the model relation on ambiguity clarifications", async () => {
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ней." },
      supportingClauses: [],
      target: { role: "target", observerRef: fence!.observerRef, surface: fence!.label },
      referents: [{ role: "target", observerRef: fence!.observerRef, surface: fence!.label }],
      ambiguity: { kind: "referent", question: "К чему именно подойти?", candidates: ["Ограда", "Двор"] },
      conversationRelation: "continuation",
    }));

    const result = await interpretMasterTurn("Подхожу к ней.", snap, router);

    expect(result).toMatchObject({ status: "clarification", relation: "continuation" });
  });

  it("repairs one statically invalid reply with the rejection reason", async () => {
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    // Live shape observed on Ollama Cloud: valid JSON in an invented envelope.
    const enveloped = JSON.stringify({
      schemaVersion: 2,
      proposal: { action: { type: "interaction", verb: "observe", target: "object_1" } },
    });
    const fixed = JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ограде." },
      supportingClauses: [],
      target: { role: "target", observerRef: fence!.observerRef, surface: fence!.label },
      referents: [{ role: "target", observerRef: fence!.observerRef, surface: fence!.label }],
    });
    const events: any[] = [];
    const router = {
      chat: vi.fn()
        .mockResolvedValueOnce({ text: enveloped })
        .mockResolvedValueOnce({ text: fixed }),
    } as any;

    const result = await interpretMasterTurn("Подхожу к ограде.", snap, router, {
      diagnostics: (event) => events.push(event),
    });

    expect(result.status).toBe("plan");
    expect(router.chat).toHaveBeenCalledTimes(2);
    const [, secondMessages] = router.chat.mock.calls[1] as any[];
    expect(secondMessages.map((message: any) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(secondMessages[2].content).toBe(enveloped);
    expect(secondMessages[3].content).toContain("rejected");
    expect(secondMessages[3].content).not.toContain("Подхожу к ограде.");
    expect(events.map((event) => event.category)).toContain("proposal_repair_requested");
  });

  it("clarifies after a still-invalid repair without a third call", async () => {
    const router = {
      chat: vi.fn()
        .mockResolvedValueOnce({ text: "{\"schemaVersion\":2,\"nope\":true}" })
        .mockResolvedValueOnce({ text: "still not json {{{" }),
    } as any;

    const result = await interpretMasterTurn("сделай нечто странное", snapshot(), router, { timeoutMs: 500 });

    expect(result.status).toBe("clarification");
    expect(router.chat).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toMatch(/schema|observerRef|TurnProposal/i);
  });

  it("never repairs usable replies", async () => {
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    const ambiguous = {
      chat: vi.fn(async () => ({
        text: JSON.stringify({
          schemaVersion: 2,
          kind: "action",
          primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ней." },
          supportingClauses: [],
          target: { role: "target", observerRef: fence!.observerRef, surface: fence!.label },
          referents: [{ role: "target", observerRef: fence!.observerRef, surface: fence!.label }],
          ambiguity: { kind: "referent", question: "К чему именно подойти?", candidates: ["Ограда", "Двор"] },
        }),
      })),
    } as any;
    const clarification = await interpretMasterTurn("Подхожу к ней.", snap, ambiguous);

    expect(clarification.status).toBe("clarification");
    expect(ambiguous.chat).toHaveBeenCalledTimes(1);
  });

  it("turns invalid model JSON into clarification without leaking internals", async () => {
    const result = await interpretMasterTurn("сделай нечто странное", snapshot(), routerReturning("not json"), { timeoutMs: 100 });

    expect(result.status).toBe("clarification");
    expect(JSON.stringify(result)).not.toMatch(/schema|observerRef|TurnProposal/i);
  });

  it("rejects authority fields instead of executing them", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу." },
      supportingClauses: [],
      referents: [],
      entityId: "fence",
    }));

    const result = await interpretMasterTurn("Подхожу.", snapshot(), router);

    expect(result.status).toBe("clarification");
  });

  it("turns a provider timeout into clarification with no events", async () => {
    const snap = snapshot();
    const timeBefore = snap.world.time;
    const slow = { chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const result = await interpretMasterTurn("сделай нечто странное", snap, slow, { timeoutMs: 5 });

    expect(result.status).toBe("clarification");
    expect(snap.world.time).toBe(timeBefore);
  });

  it("keeps operational diagnostics free of player text", async () => {
    const events: any[] = [];
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ограде." },
      supportingClauses: [],
      target: { role: "target", observerRef: fence!.observerRef, surface: fence!.label },
      referents: [{ role: "target", observerRef: fence!.observerRef, surface: fence!.label }],
    }));

    const result = await interpretMasterTurn("Подхожу к ограде.", snap, router, {
      diagnostics: (event) => events.push(event),
      correlationId: "master-turn-test-1",
      worldTime: 3,
    });

    expect(result.status).toBe("plan");
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((event) => event.category)).toEqual(expect.arrayContaining([
      "context_required",
      "conversation_context",
      "turn_proposal_requested",
      "turn_proposal_received",
    ]));
    const contextEvent = events.find((event) => event.category === "conversation_context");
    expect(contextEvent).toMatchObject({ outcome: expect.any(String) });
    expect(contextEvent).toEqual(expect.objectContaining({
      messageCount: expect.any(Number),
      mentionCount: expect.any(Number),
      truncated: expect.any(Boolean),
    }));
    expect(JSON.stringify(events)).not.toContain("Подхожу к ограде.");
  });

  it("asks a specific question for a pronoun with no scene candidates without calling the model", async () => {
    const snap = snapshot();
    const empty: MasterTurnSnapshot = {
      ...snap,
      scene: {
        context: {
          ...snap.scene.context,
          visibleObjects: [],
          knownPeople: [],
          knownRoutes: [],
          knownTopics: [],
        },
        references: snap.scene.references,
      },
    };
    const slow = { chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const result = await interpretMasterTurn("Подойду к ней.", empty, slow, { timeoutMs: 50 });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(slow.chat).not.toHaveBeenCalled();
    expect(result.question).toMatch(/Кого или что/);
    expect(result.question).not.toContain("чего ты хочешь добиться");
  });

  it("falls back to a specific pronoun question on timeout instead of executing", async () => {
    const snap = snapshot();
    const slow = { chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const result = await interpretMasterTurn("Подойду к ней.", snap, slow, { timeoutMs: 5 });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toMatch(/Кого или что/);
    expect(result.question).not.toContain("чего ты хочешь добиться");
  });

  it("names the mentioned referent instead of quoting topics", async () => {
    // "Сделаю это" with a settled mention means the discussed referent, not
    // one of the knowledge sentences: ask about it directly, no model call.
    const snap = snapshot();
    const conversation = buildMasterConversationContext([{
      turnSeq: 1,
      worldId: "test-world",
      correlationId: "cmd-1",
      idempotencyKey: "prior-1",
      playerText: "Осматриваю ограду.",
      inputClass: "action",
      worldTimeBefore: 0,
      worldTimeAfter: 1,
      responseKind: "action_outcome",
      responseText: "Ты осматриваешь ограду.",
      createdAt: 1,
      contextMetadata: {
        schemaVersion: 1,
        mentions: [{ kind: "object", role: "target", label: "Ограда" }],
      },
    } as unknown as import("../src/conversation/types.js").ConversationTurn], "test-world", { scene: snap.scene.context });
    const topical: MasterTurnSnapshot = {
      ...snap,
      conversation,
      scene: {
        context: {
          ...snap.scene.context,
          knownTopics: [
            { observerRef: "topic_1", category: "told", text: "Старое русло открывает путь через лес.", status: "current" },
            { observerRef: "topic_2", category: "told", text: "Перевозчик знает все тропы у реки.", status: "current" },
          ],
        },
        references: snap.scene.references,
      },
    };
    const router = { chat: vi.fn() } as any;
    const result = await interpretMasterTurn("Сделаю это.", topical, router, { timeoutMs: 50 });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toBe("«Ограда» — что именно ты хочешь сделать?");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("names the mentioned referent for a speech topic pronoun", async () => {
    const snap = snapshot();
    const conversation = buildMasterConversationContext([{
      turnSeq: 1,
      worldId: "test-world",
      correlationId: "cmd-1",
      idempotencyKey: "prior-1",
      playerText: "Осматриваю ограду.",
      inputClass: "action",
      worldTimeBefore: 0,
      worldTimeAfter: 1,
      responseKind: "action_outcome",
      responseText: "Ты осматриваешь ограду.",
      createdAt: 1,
      contextMetadata: {
        schemaVersion: 1,
        mentions: [{ kind: "object", role: "target", label: "Ограда" }],
      },
    } as unknown as import("../src/conversation/types.js").ConversationTurn], "test-world", { scene: snap.scene.context });
    const topical: MasterTurnSnapshot = {
      ...snap,
      conversation,
      scene: {
        context: {
          ...snap.scene.context,
          knownTopics: [
            { observerRef: "topic_1", category: "told", text: "Старое русло открывает путь через лес.", status: "current" },
            { observerRef: "topic_2", category: "told", text: "Перевозчик знает все тропы у реки.", status: "current" },
          ],
        },
        references: snap.scene.references,
      },
    };
    const router = { chat: vi.fn() } as any;
    const result = await interpretMasterTurn("Спрошу об этом.", topical, router, { timeoutMs: 50 });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toBe("У кого спросить про «Ограда»? Назови, к кому обратиться.");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("answers a pronoun-rewritten follow-up question without a model call", async () => {    // "А что за ней?" is only a candidate until the focus stack binds "ней".
    // With a settled mention the rewrite is a direct inquiry, which must take
    // the read-only inquiry path — never action validation with a null intent.
    const snap = snapshot();
    const prior = {
      turnSeq: 1,
      worldId: "test-world",
      correlationId: "cmd-1",
      idempotencyKey: "prior-1",
      playerText: "Осматриваю ограду.",
      inputClass: "action",
      worldTimeBefore: 0,
      worldTimeAfter: 1,
      responseKind: "action_outcome",
      responseText: "Ты осматриваешь ограду.",
      createdAt: 1,
      contextMetadata: {
        schemaVersion: 1,
        mentions: [{ kind: "object", role: "target", label: "Ограда" }],
      },
    } as unknown as import("../src/conversation/types.js").ConversationTurn;
    const conversation = buildMasterConversationContext([prior], "test-world", { scene: snap.scene.context });
    const mentioned: MasterTurnSnapshot = { ...snap, conversation };
    const router = { chat: vi.fn() } as any;
    const result = await interpretMasterTurn("А что за ней?", mentioned, router, { timeoutMs: 50 });

    expect(result.status).toBe("inquiry");
    if (result.status !== "inquiry") return;
    expect(result.inquiry.queryId).toBe("visible_scene");
    expect(result.inquiry.focus?.surface).toMatch(/оград/iu);
    expect(router.chat).not.toHaveBeenCalled();
  });
});

describe("mixed-corpus generic-fallback gate (plan_9 §1-2)", () => {
  function mentionSnapshot(): MasterTurnSnapshot {
    const snap = snapshot();
    const prior = {
      turnSeq: 1,
      worldId: "test-world",
      correlationId: "cmd-1",
      idempotencyKey: "prior-1",
      playerText: "Осматриваю ограду.",
      inputClass: "action",
      worldTimeBefore: 0,
      worldTimeAfter: 1,
      responseKind: "action_outcome",
      responseText: "Ты осматриваешь ограду.",
      createdAt: 1,
      contextMetadata: {
        schemaVersion: 1,
        mentions: [{ kind: "object", role: "target", label: "Ограда" }],
      },
    } as unknown as import("../src/conversation/types.js").ConversationTurn;
    return { ...snap, conversation: buildMasterConversationContext([prior], "test-world", { scene: snap.scene.context }) };
  }

  /** Failing model: every replica must resolve without it (degraded-AI path). */
  function deadRouter() {
    return { chat: vi.fn(() => { throw new Error("model down"); }) } as any;
  }

  interface CorpusEntry {
    readonly input: string;
    readonly snap: "empty" | "mention";
    /** Only genuine garbage may use the generic last resort (≤2% budget). */
    readonly allowGeneric?: boolean;
  }

  const CORPUS: readonly CorpusEntry[] = [
    // Compounds: specific clarification, options name the parts.
    { input: "осматриваюсь и иду к реке", snap: "empty" },
    { input: "Подойду к ограде и осмотрюсь", snap: "empty" },
    { input: "Иду к реке и осматриваюсь", snap: "empty" },
    { input: "слушаю перевозчика, потом перехожу мост", snap: "empty" },
    { input: "сначала смотрю на воду, затем зову лодочника", snap: "empty" },
    { input: "открою дверь и возьму ключ", snap: "empty" },
    { input: "осмотреть дверь и взять пепел", snap: "empty" },
    { input: "Подойду к ней и осмотрюсь", snap: "empty" },
    // Pronouns: settled mentions rewrite or ask specifically.
    { input: "Подойду к ней.", snap: "empty" },
    { input: "Осмотрю её внимательно.", snap: "empty" },
    { input: "А что за ней?", snap: "mention" },
    { input: "Сделаю это.", snap: "mention" },
    { input: "Спрошу об этом.", snap: "mention" },
    { input: "Подойду к нему.", snap: "mention" },
    { input: "Осмотрю её ещё раз.", snap: "mention" },
    // Journeys: executable or specific destination questions.
    { input: "Иду к Речному Стражу", snap: "empty" },
    { input: "Иду к башне", snap: "empty" },
    { input: "Иду.", snap: "empty" },
    // Inquiries: read-only answers, no model needed.
    { input: "Куда можно пойти?", snap: "empty" },
    { input: "Что я вижу?", snap: "empty" },
    { input: "Кто рядом?", snap: "empty" },
    { input: "что подсказывает вода?", snap: "empty" },
    { input: "где я?", snap: "empty" },
    { input: "Кто я?", snap: "empty" },
    { input: "Что у меня есть?", snap: "empty" },
    { input: "Что произошло?", snap: "empty" },
    { input: "Почему карта показывает это место?", snap: "empty" },
    // Plain actions: deterministic or specific world answers.
    { input: "Осматриваюсь.", snap: "empty" },
    { input: "прислушайся", snap: "empty" },
    { input: "Прислушайся к воде", snap: "empty" },
    { input: "Осмотреть переправу", snap: "empty" },
    { input: "возьми факел", snap: "empty" },
    { input: "открой дверь", snap: "empty" },
    { input: "подойди к ограде", snap: "empty" },
    { input: "иди на север", snap: "empty" },
    { input: "ждать", snap: "empty" },
    { input: "остановиться", snap: "empty" },
    { input: "Смотрю на реку.", snap: "empty" },
    { input: "Слушаю перевозчика.", snap: "empty" },
    { input: "Изучи петли.", snap: "empty" },
    { input: "Положи камень в сумку.", snap: "empty" },
    { input: "Отдай пепел торговцу.", snap: "empty" },
    { input: "Ждать дверь.", snap: "empty" },
    { input: "Смотрю на карася.", snap: "empty" },
    { input: "посмотрю на старую кладку", snap: "empty" },
    { input: "прислушиваюсь к шуму воды", snap: "empty" },
    { input: "слушаю перевозчика", snap: "empty" },
    { input: "Осматриваю двор.", snap: "empty" },
    { input: "иду за лосем", snap: "empty" },
    // Genuine garbage: the only allowed generic fallback (2% budget).
    { input: "абракадабра", snap: "empty", allowGeneric: true },
  ];

  it("holds fifty replicas with at most one generic fallback", async () => {
    expect(CORPUS).toHaveLength(50);
    const diagnostics: any[] = [];
    let generic = 0;
    for (const entry of CORPUS) {
      const snap = entry.snap === "mention" ? mentionSnapshot() : snapshot();
      const result = await interpretMasterTurn(entry.input, snap, deadRouter(), {
        timeoutMs: 50,
        diagnostics: (event: any) => diagnostics.push(event),
      });
      if (result.status === "clarification" && isGenericFallbackText(result.question)) {
        generic += 1;
        expect(entry.allowGeneric, `unexpected generic fallback for ${JSON.stringify(entry.input)}`).toBe(true);
      }
      if (result.status === "clarification") {
        // No silent loss: every clarification carries options.
        expect(result.options.length, entry.input).toBeGreaterThan(0);
      }
    }
    expect(generic).toBeLessThanOrEqual(1);
    expect(diagnostics.filter((event) => event.category === "generic_clarification_fallback").length).toBe(generic);
  });
});
