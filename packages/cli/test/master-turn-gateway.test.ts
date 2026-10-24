import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { WorldProjector, buildMasterTurnSceneContext, createRules } from "@skald/world";
import { RuleEngine } from "@skald/rule-engine";
import { isGenericFallbackText } from "@skald/intent-parser";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import { buildReadSideConversationTurn, buildTurnMemoryMetadata } from "../src/conversation/builder.js";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";
import { interpretMasterTurn, matchFrameOption, sharedSinglePronounSurface, type MasterTurnSnapshot } from "../src/runtime/master-turn-gateway.js";

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


/**
 * A city scene with two visible people: the archivist and the gatekeeper.
 * Both live in the WORLD (so a target resolves) and in the scene (so the
 * model can name them).
 */
function citySnapshot(): MasterTurnSnapshot {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const log = [
    ...bootstrap(),
    event("ObjectPlaced", "boot-contact-archivist", {
      entityId: "contact:archivist", x: 0, y: 0, name: "Архивист Речного Стража",
      aliases: ["архивист", "архивиста", "архивисту"], description: "Хранитель городских записей.",
      components: { contact: { locationId: "camp", backgroundId: "wanderer" } },
    }),
    event("ObjectPlaced", "boot-contact-gatekeeper", {
      entityId: "contact:gatekeeper", x: 0, y: 0, name: "Смотритель речных ворот",
      aliases: ["смотритель", "смотрителя"], description: "Ведёт журнал проходов у ворот.",
      components: { contact: { locationId: "camp", backgroundId: "wanderer" } },
    }),
  ];
  for (const entry of log) {
    projection.apply(entry);
    bus.append(entry);
  }
  const events = bus.query();
  const world = projection.getSnapshot();
  const scene = buildMasterTurnSceneContext(events, world);
  const references = new Map(scene.references);
  references.set("person_1", { kind: "person", internalId: "contact:archivist", label: "Архивист Речного Стража" });
  references.set("person_2", { kind: "person", internalId: "contact:gatekeeper", label: "Смотритель речных ворот" });
  const people = [
    { observerRef: "person_1", kind: "person" as const, label: "Архивист Речного Стража", knownAs: ["Архивист Речного Стража"], known: true },
    { observerRef: "person_2", kind: "person" as const, label: "Смотритель речных ворот", knownAs: ["Смотритель речных ворот"], known: true },
  ];
  return {
    events,
    world,
    scene: {
      ...scene,
      references,
      context: { ...scene.context, knownPeople: people },
    },
    conversation: buildMasterConversationContext([], "test-world"),
  };
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

    const result = await interpretMasterTurn("Подхожу к ограде и осматриваю двор.", snap, router);

    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.execution?.intent).toMatchObject({ type: "ActionIntentCommand" });
    expect(router.chat).toHaveBeenCalledTimes(1);
    const [category, messages] = router.chat.mock.calls[0] as any[];
    expect(category).toBe("interpret");
    expect(messages[0].content).not.toContain("Подхожу к ограде и осматриваю двор.");
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

  it("keeps a meaningful clarification when the server patch cannot be executed", async () => {
    // The server resolved the referent, but the patched proposal carried no
    // executable intent. Falling through to the generic "rephrase" fallback
    // would be worse than the question the player can actually answer.
    const snap = citySnapshot();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: null,
      supportingClauses: [],
      target: { role: "target", surface: "архивисту" },
      referents: [],
      ambiguity: { kind: "referent", question: "К кому именно подойти?", candidates: ["Архивист Речного Стража", "Смотритель речных ворот"] },
    }));

    // The replica has no known verb, so the model is consulted.
    const result = await interpretMasterTurn("хочу поговорить с архивистом", snap, router);

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toBe("К кому именно подойти?");
  });

  it("treats several pronouns that name one referent as a single group", () => {
    // "что на нём одето, в каком он насстроении?" carries two pronouns and
    // one addressee. Treating them as several groups left the turn without
    // a binding at all; one shared referent is one group.
    const binding = (pronoun: string, surface: string) => ({
      pronoun,
      classes: ["person" as const],
      preposition: null,
      candidates: ["person_1"],
      mention: { surface, turnSeq: 1 },
      resolution: "single" as const,
    });

    expect(sharedSinglePronounSurface([
      binding("нём", "Архивист Речного Стража"),
      binding("он", "Архивист Речного Стража"),
    ])).toBe("Архивист Речного Стража");

    // Two different addressees stay two groups: the server must not pick.
    expect(sharedSinglePronounSurface([
      binding("нём", "Архивист Речного Стража"),
      binding("он", "Смотритель речных ворот"),
    ])).toBeNull();

    // An unresolved pronoun is no group either.
    expect(sharedSinglePronounSurface([
      { ...binding("нём", "Архивист Речного Стража"), resolution: "ambiguous" as const },
      binding("он", "Архивист Речного Стража"),
    ])).toBeNull();

    // Two DIFFERENT people can share one display label: the identity decides.
    const sameLabel = (pronoun: string, candidate: string) => ({
      ...binding(pronoun, "Незнакомый человек"),
      candidates: [candidate],
    });
    expect(sharedSinglePronounSurface([
      sameLabel("нём", "person_1"),
      sameLabel("он", "person_2"),
    ])).toBeNull();
    expect(sharedSinglePronounSurface([
      sameLabel("нём", "person_1"),
      sameLabel("он", "person_1"),
    ])).toBe("Незнакомый человек");
  });

  it("asks which action was meant instead of pretending a person was ambiguous", async () => {
    // "подхожу к архивисту и приветствую его" is two actions. The pronoun
    // inside the second clause must not be bound as a referent of the whole
    // turn: that produced "Архивист или Смотритель?" about a person the
    // player never mentioned.
    const snap = citySnapshot();
    const router = routerReturning("не разбираем");

    const result = await interpretMasterTurn("подхожу к архивисту и приветствую его", snap, router);

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toBe(
      "Что именно ты хочешь сделать: «подхожу к архивисту» или «приветствую его»?",
    );
    expect(result.options.map((option) => option.label)).toEqual([
      "подхожу к архивисту",
      "приветствую его",
    ]);
    // The model may still plan the compound ("подойду к ней и осмотрюсь"),
    // so it is consulted; when it cannot, the honest fallback is the
    // compound question — never a question about a person.
    expect(router.chat).toHaveBeenCalled();
  });

  it("resolves a model-declared ambiguity when the scene names exactly one candidate", async () => {
    // The model hedged ("Архивист или Смотритель?"), but the server owns
    // referent binding: the surface names ONE visible person, so the turn
    // executes instead of asking the player to pick again.
    const snap = citySnapshot();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ней." },
      supportingClauses: [],
      target: { role: "target", surface: "архивисту" },
      referents: [],
      ambiguity: { kind: "referent", question: "Кого или что именно — Архивист Речного Стража или Смотритель речных ворот?", candidates: ["Архивист Речного Стража", "Смотритель речных ворот"] },
    }));

    // "хочу поговорить с архивистом" has no known verb, so the deterministic
    // fast path declines it: the model is consulted and its hedge reaches
    // the server — exactly the live case.
    const result = await interpretMasterTurn("хочу поговорить с архивистом", snap, router);

    expect(result.status).not.toBe("clarification");
  });

  it("keeps a real ambiguity as a question when the scene cannot decide", async () => {
    const snap = citySnapshot();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ней." },
      supportingClauses: [],
      target: { role: "target", surface: "к ней" },
      referents: [],
      ambiguity: { kind: "referent", question: "К кому именно?", candidates: ["Архивист Речного Стража", "Смотритель речных ворот"] },
    }));

    const result = await interpretMasterTurn("подхожу к ней", snap, router);

    expect(result.status).toBe("clarification");
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

    const result = await interpretMasterTurn("Подхожу к ограде и осматриваю двор.", snap, router, {
      diagnostics: (event) => events.push(event),
    });

    expect(result.status).toBe("plan");
    expect(router.chat).toHaveBeenCalledTimes(2);
    const [, secondMessages] = router.chat.mock.calls[1] as any[];
    expect(secondMessages.map((message: any) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(secondMessages[2].content).toBe(enveloped);
    expect(secondMessages[3].content).toContain("rejected");
    expect(secondMessages[3].content).not.toContain("Подхожу к ограде и осматриваю двор.");
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

  it("does not mark a NEW clarification as resolving the pending question", async () => {
    // A player answers the pending question, but the answer produces another
    // question. Marking the turn as "resolves" dropped the live question from
    // the context, so the next answer had nothing to bind to and the master
    // asked the same question again.
    const base = snapshot();
    const fence = base.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    const stored = {
      turnSeq: 1,
      worldId: "test-world",
      correlationId: "c1",
      idempotencyKey: "k1",
      playerText: "Подхожу к ней.",
      inputClass: "action",
      worldTimeBefore: 0,
      worldTimeAfter: 0,
      responseKind: "clarification",
      responseText: "К чему именно подойти?",
      createdAt: 1,
      contextMetadata: {
        schemaVersion: 1,
        clarification: {
          question: "К чему именно подойти?",
          options: [{ optionId: "candidate-1", label: "Ограда" }],
        },
      },
    } as any;
    const conversation = buildMasterConversationContext([stored], "test-world", { scene: base.scene.context });
    expect(conversation.pendingClarification).not.toBeNull();
    const snap: MasterTurnSnapshot = { ...base, conversation };

    const asking = {
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

    const result = await interpretMasterTurn("к ограде", snap, asking);

    expect(result.status).toBe("clarification");
    expect((result as { pendingLink?: { relation: string } }).pendingLink).toBeUndefined();
  });

  it("never repairs usable replies", async () => {    const snap = snapshot();
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

    const result = await interpretMasterTurn("Подхожу к ограде и осматриваю двор.", snap, router, {
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
    expect(JSON.stringify(events)).not.toContain("Подхожу к ограде и осматриваю двор.");
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

describe("deterministic compound resolution (plan_9 §1)", () => {
  /** No model configured: the pure deterministic path. */
  const noModel = null;
  /** A configured but dead model: the deterministic fallback must recover. */
  function dead() {
    return { chat: vi.fn(() => { throw new Error("model down"); }) } as any;
  }

  it("resolves the flagship replica into one action plus both questions", async () => {
    const result = await interpretMasterTurn(
      "Я осматриваю переправу и хочу понять, куда лучше идти — что подсказывает вода?",
      snapshot(),
      noModel,
      { timeoutMs: 50 },
    );
    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.kind).toBe("mixed");
    expect(result.plan.execution?.intent.type).toBe("InteractionCommand");
    expect(result.plan.postActionInquiries.map((inquiry) => inquiry.queryId)).toEqual([
      "available_routes",
      "environmental_indication",
    ]);
  });

  it("recovers the same flagship plan after the model fails", async () => {
    const result = await interpretMasterTurn(
      "Я осматриваю переправу и хочу понять, куда лучше идти — что подсказывает вода?",
      snapshot(),
      dead(),
      { timeoutMs: 50 },
    );
    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.postActionInquiries.map((inquiry) => inquiry.queryId)).toEqual([
      "available_routes",
      "environmental_indication",
    ]);
  });

  it("answers two questions in one turn without a model", async () => {
    const result = await interpretMasterTurn("где я? и кто рядом?", snapshot(), noModel, { timeoutMs: 50 });
    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.execution).toBeNull();
    expect(result.plan.postActionInquiries.map((inquiry) => inquiry.queryId)).toEqual([
      "current_location",
      "who_is_nearby",
    ]);
  });

  it("names both actions for an action+action compound", async () => {
    const result = await interpretMasterTurn("осматриваю переправу и слушаю воду", snapshot(), dead(), { timeoutMs: 50 });
    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toContain("осматриваю переправу");
    expect(result.question).toContain("слушаю воду");
  });

  it("resolves the plan's live phrases without a generic fallback", async () => {
    const ambient = await interpretMasterTurn("я осматриваюсь", snapshot(), noModel, { timeoutMs: 50 });
    expect(ambient.status).toBe("deterministic");

    const approach = await interpretMasterTurn("подхожу к ограде", snapshot(), noModel, { timeoutMs: 50 });
    expect(approach.status).toBe("deterministic");
    if (approach.status === "deterministic") expect(approach.intent.type).toBe("ActionIntentCommand");

    // Positioning + a second action + a question: two actions is a real
    // conflict, so the master names both parts instead of a generic fallback.
    const compound = await interpretMasterTurn("подхожу к ограде и осматриваю двор, что я вижу?", snapshot(), noModel, { timeoutMs: 50 });
    expect(compound.status).toBe("clarification");
    if (compound.status !== "clarification") return;
    expect(compound.question).toContain("подхожу к ограде");
    expect(compound.question).toContain("осматриваю двор");
  });
});

describe("deterministic meta and inquiry patterns (full-master Stage 1)", () => {
  const noModel = null;

  it("resolves read-only meta phrases without a model", async () => {
    const result = await interpretMasterTurn("открой карту", snapshot(), noModel, { timeoutMs: 50 });
    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.kind).toBe("meta");
    expect(result.plan.metaInquiry?.operation).toBe("open_map_hint");
  });

  it("recognizes «кто здесь?» as a nearby inquiry", async () => {
    const result = await interpretMasterTurn("кто здесь?", snapshot(), noModel, { timeoutMs: 50 });
    expect(result.status).toBe("inquiry");
    if (result.status !== "inquiry") return;
    expect(result.inquiry.queryId).toBe("who_is_nearby");
  });

  it("prefers a deterministic compound plan over a model clarification", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю двор" },
      supportingClauses: [],
      referents: [],
      ambiguity: { kind: "action", question: "Что именно?", candidates: ["осмотреть двор", "идти"] },
    }));
    const result = await interpretMasterTurn("осматриваю двор, что я вижу?", snapshot(), router);
    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.kind).toBe("mixed");
    expect(result.plan.postActionInquiries.map((inquiry) => inquiry.queryId)).toEqual(["visible_scene"]);
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
    // Plan flagship: one action + two questions, resolved without the model.
    { input: "Я осматриваю переправу и хочу понять, куда лучше идти — что подсказывает вода?", snap: "empty" },
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

describe("pending-clarification frame (review P0)", () => {
  function frameRouter() {
    return { chat: vi.fn(() => { throw new Error("model down"); }) } as any;
  }

  function framedSnapshot(originalInput: string): MasterTurnSnapshot {
    const snap = snapshot();
    const pending = {
      turnSeq: 3,
      worldId: "test-world",
      correlationId: "cmd-3",
      idempotencyKey: "k3",
      playerText: originalInput,
      inputClass: "action",
      worldTimeBefore: 1,
      worldTimeAfter: 1,
      responseKind: "clarification",
      responseText: "К ограде или ко двору?",
      createdAt: 3,
      contextMetadata: {
        schemaVersion: 1,
        clarification: {
          question: "К ограде или ко двору?",
          options: [
            { optionId: "candidate-1", label: "Ограда" },
            { optionId: "candidate-2", label: "Двор" },
          ],
        },
      },
    } as unknown as import("../src/conversation/types.js").ConversationTurn;
    return { ...snap, conversation: buildMasterConversationContext([pending], "test-world", { scene: snap.scene.context }) };
  }

  it("resolves an exact frame answer first-try without the model", async () => {
    const router = frameRouter();
    const result = await interpretMasterTurn("Ограда", framedSnapshot("Осматриваю ограду."), router);

    expect(result.status).toBe("deterministic");
    if (result.status !== "deterministic") return;
    expect(result.intent).toMatchObject({ type: "InteractionCommand", verb: "observe" });
    expect(result.pendingLink).toEqual({ relation: "resolves", clarificationTurnSeq: 3 });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("leaves a foreign inquiry open with no link", async () => {
    const router = frameRouter();
    const result = await interpretMasterTurn("Где я?", framedSnapshot("Осматриваю ограду."), router);

    expect(result.status).toBe("inquiry");
    if (result.status !== "inquiry") return;
    expect(result.pendingLink).toBeUndefined();
    expect(router.chat).not.toHaveBeenCalled();
  });
});

describe("matchFrameOption", () => {  const ferrymen = [
    { optionId: "candidate-1", label: "Ночной перевозчик" },
    { optionId: "candidate-2", label: "Дневной перевозчик" },
  ];

  it("matches an exact label first, collapsing identical labels", () => {
    expect(matchFrameOption("Ночной перевозчик", ferrymen)).toEqual({ status: "matched", option: ferrymen[0] });
    expect(matchFrameOption("ночной ПЕРЕВОЗЧИК!", ferrymen)).toEqual({ status: "matched", option: ferrymen[0] });
    const twins = [ferrymen[0]!, { optionId: "candidate-9", label: "Ночной перевозчик" }];
    expect(matchFrameOption("Ночной перевозчик", twins)).toEqual({ status: "matched", option: twins[0] });
  });

  it("matches a long replica by unique best stem overlap", () => {
    const match = matchFrameOption(
      "К Ночному перевозчику. Спрошу именно его, что случилось с переправой.",
      ferrymen,
    );
    expect(match).toEqual({ status: "matched", option: ferrymen[0] });
  });

  it("stays ambiguous on a tied stem", () => {
    expect(matchFrameOption("перевозчик", ferrymen)).toEqual({ status: "ambiguous" });
  });

  it("matches nothing without overlap", () => {
    expect(matchFrameOption("осмотреться", ferrymen)).toEqual({ status: "none" });
    expect(matchFrameOption("", ferrymen)).toEqual({ status: "none" });
    expect(matchFrameOption("   ", ferrymen)).toEqual({ status: "none" });
  });
});

describe("unified frame selection (review P1)", () => {
  function frameRouter() {
    return { chat: vi.fn(() => { throw new Error("model down"); }) } as any;
  }

  function framedSnapshot(
    snap: MasterTurnSnapshot,
    originalInput: string,
    options: { optionId: string; label: string; referentRefs?: string[]; intentPatch?: { actionText: string } }[],
    framed?: Record<string, unknown>,
  ): MasterTurnSnapshot {
    const pending = {
      turnSeq: 3,
      worldId: "test-world",
      correlationId: "cmd-3",
      idempotencyKey: "k3",
      playerText: originalInput,
      inputClass: "action",
      worldTimeBefore: 1,
      worldTimeAfter: 1,
      responseKind: "clarification",
      responseText: "К ограде или ко двору?",
      createdAt: 3,
      contextMetadata: {
        schemaVersion: 1,
        clarification: {
          question: "К ограде или ко двору?",
          options,
          ...(framed ? { framed } : {}),
        },
      },
    } as unknown as import("../src/conversation/types.js").ConversationTurn;
    return { ...snap, conversation: buildMasterConversationContext([pending], "test-world", { scene: snap.scene.context }) };
  }

  function fenceRef(snap: MasterTurnSnapshot): string {
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    if (!fence) throw new Error("fence is not visible in the camp scene");
    return fence.observerRef;
  }

  const observeProposal = {
    schemaVersion: 2,
    kind: "action",
    primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваю её." },
    supportingClauses: [],
    target: { role: "target", surface: "ней" },
    referents: [{ role: "target", surface: "ней" }],
  };

  it("resolves an option-N answer through the stored proposal with no model call", async () => {
    const base = snapshot();
    const router = frameRouter();
    const snap = framedSnapshot(
      base,
      "Осматриваю её.",
      [
        { optionId: "option-1", label: "Ограда" },
        { optionId: "option-2", label: "Двор" },
      ],
      { slot: "target", proposal: observeProposal, revision: { ...base.scene.context.revision } },
    );
    const result = await interpretMasterTurn("Ограда", snap, router);

    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.execution?.intent).toMatchObject({ type: "InteractionCommand", verb: "observe" });
    expect(result.pendingLink).toEqual({ relation: "resolves", clarificationTurnSeq: 3 });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("resolves a candidate-N answer through the stored intent with no model call", async () => {
    const base = snapshot();
    const ref = fenceRef(base);
    const router = frameRouter();
    const snap = framedSnapshot(
      base,
      "Осматриваю её.",
      [
        { optionId: "candidate-1", label: "Ограда", referentRefs: [ref] },
        { optionId: "candidate-2", label: "Двор" },
      ],
      {
        slot: "target",
        intent: {
          type: "InteractionCommand",
          verb: "observe",
          target: { raw: "ней" },
          rawText: "Осматриваю её.",
          interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
        },
        revision: { ...base.scene.context.revision },
      },
    );
    const result = await interpretMasterTurn("Ограда", snap, router);

    expect(result.status).toBe("deterministic");
    if (result.status !== "deterministic") return;
    expect(result.intent).toMatchObject({ type: "InteractionCommand", target: { raw: "Ограда" } });
    expect(result.pendingLink).toEqual({ relation: "resolves", clarificationTurnSeq: 3 });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("falls back to re-interpretation on a stale revision without resolving", async () => {
    const router = frameRouter();
    const snap = framedSnapshot(
      snapshot(),
      "Осматриваю её.",
      [
        { optionId: "option-1", label: "Ограда" },
        { optionId: "option-2", label: "Двор" },
      ],
      { slot: "target", proposal: observeProposal, revision: { worldTime: 9999, eventNumber: 9999 } },
    );
    const result = await interpretMasterTurn("Ограда", snap, router);

    // No framed shortcut: the stale candidate cannot resolve, so the
    // original is re-understood from scratch (the model is consulted).
    expect(result.status).toBe("clarification");
    expect(router.chat).toHaveBeenCalled();
  });

  it("runs an action patch instead of the whole compound", async () => {
    const router = frameRouter();
    const snap = framedSnapshot(
      snapshot(),
      "осмотреться и идти к реке",
      [{ optionId: "deterministic-1", label: "осмотреться", intentPatch: { actionText: "осмотреться" } }],
    );
    const result = await interpretMasterTurn("осмотреться", snap, router);

    expect(result.status).toBe("deterministic");
    if (result.status !== "deterministic") return;
    expect(result.pendingLink).toEqual({ relation: "resolves", clarificationTurnSeq: 3 });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("matches target-N labels through the legacy restricted re-run", async () => {
    const router = frameRouter();
    const snap = framedSnapshot(
      snapshot(),
      "Осматриваю ограду.",
      [
        { optionId: "target-1", label: "Ограда" },
        { optionId: "target-2", label: "Двор" },
      ],
    );
    const result = await interpretMasterTurn("Ограда", snap, router);

    expect(result.status).toBe("deterministic");
    if (result.status !== "deterministic") return;
    expect(result.pendingLink).toEqual({ relation: "resolves", clarificationTurnSeq: 3 });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("never consumes an exact rephrase replica as a frame answer", async () => {
    const router = frameRouter();
    const snap = framedSnapshot(
      snapshot(),
      "Подойду к ней.",
      [{ optionId: "rephrase", label: "Уточнить намерение" }],
    );
    const result = await interpretMasterTurn("Уточнить намерение", snap, router);

    expect((result as { pendingLink?: unknown }).pendingLink).toBeUndefined();
  });

  it("stamps the scene revision onto a model-reported ambiguity (review P1)", async () => {
    const snap = snapshot();
    const router = {
      chat: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          schemaVersion: 2,
          kind: "action",
          primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваю её." },
          supportingClauses: [],
          target: { role: "target", surface: "ней" },
          referents: [{ role: "target", surface: "ней" }],
          ambiguity: { kind: "referent", question: "К ограде или ко двору?", candidates: ["Ограда", "Двор"] },
        }),
      }),
    } as any;
    const result = await interpretMasterTurn("Осматриваю её.", snap, router);

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.options.map((option) => option.optionId)).toEqual(["option-1", "option-2"]);
    expect(result.framed).toMatchObject({
      slot: "target",
      revision: snap.scene.context.revision,
    });
    expect((result.framed?.proposal as { target?: { surface?: string } } | undefined)?.target?.surface).toBe("ней");
    expect(router.chat).toHaveBeenCalledTimes(1);
  });
});

describe("whole-replica inquiry completeness (T3)", () => {
  const COMPOUND_REPLICA = "Что на нём одето и как он себя ведёт?";

  function proposalReturning(extra?: Record<string, unknown>) {
    return {
      schemaVersion: 2,
      kind: "inquiry",
      primaryIntent: { kind: "inquiry", queryId: "current_location", sourceText: "Где я и что здесь происходит?" },
      supportingClauses: [],
      referents: [],
      ...extra,
    };
  }

  it("defers an incomplete inquiry replica to the semantic interpreter", async () => {
    const router = routerReturning(JSON.stringify(proposalReturning()));
    const result = await interpretMasterTurn(COMPOUND_REPLICA, snapshot(), router);

    expect(router.chat).toHaveBeenCalledTimes(1);
    expect(result.status).not.toBe("inquiry");
    expect(result.status).toBe("plan");
  });

  it("clarifies instead of answering an unrelated query when the model is unavailable", async () => {
    const result = await interpretMasterTurn(COMPOUND_REPLICA, snapshot(), null);

    expect(result.status).toBe("clarification");
  });

  it("still short-circuits a whole-replica inquiry with a model available", async () => {
    const router = routerReturning("{}");
    const result = await interpretMasterTurn("где я?", snapshot(), router);

    expect(result.status).toBe("inquiry");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("builds one bounded question round from an accepted question plan", async () => {
    const snap = snapshot();
    const router = routerReturning(JSON.stringify(proposalReturning({
      questionPlan: {
        subjects: [{ id: "here", surface: "здесь", kind: "place" }],
        parts: [{ id: "p-act", subjectRefs: ["here"], aspect: "current_activity", time: "current", purpose: "describe" }],
      },
      readings: [{ partId: "p-act", source: "scene" }],
    })));
    const result = await interpretMasterTurn("Где я и что здесь происходит?", snap, router);

    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.questionRound).toBeDefined();
    expect(result.questionRound!.readings).toEqual([{ partId: "p-act", source: "scene" }]);
    expect(result.questionRound!.questionPlan.subjects[0]).toMatchObject({ resolution: "resolved", resolvedRef: null });
    expect(result.questionRound!.questionPlan.actionIntent).toBeNull();
    expect(result.questionRound!.interpretationRevision).toEqual({
      worldTime: snap.world.time,
      eventNumber: snap.world.eventNumber,
    });
  });

  it("emits a sanitized rejected-plan summary when the model omits group members (T6 R1)", async () => {
    const snap = snapshot();
    // Group without members: the contract rejects, the diagnostic names the
    // violated rule with counts and closed tokens only — never surfaces.
    const router = routerReturning(JSON.stringify(proposalReturning({
      questionPlan: {
        subjects: [{ id: "crew", surface: "они", kind: "group" }],
        parts: [{ id: "p-look", subjectRefs: ["crew"], aspect: "appearance", time: "current", purpose: "describe" }],
      },
      readings: [{ partId: "p-look", source: "person" }],
    })));
    const seen: any[] = [];
    const result = await interpretMasterTurn("Как они выглядят?", snap, router, {
      diagnostics: (event: any) => seen.push(event),
    });

    expect(result.status).toBe("clarification");
    const rejected = seen.find((event) => event.category === "proposal_schema_rejected");
    expect(rejected).toMatchObject({
      outcome: "invalid",
      planSubjectKinds: "group",
      planSubjectCount: 1,
      planGroupWithoutMembers: 1,
    });
    expect(JSON.stringify(seen)).not.toContain("они");
  });

  it("logs the round-1 rejection with sanitized dims before the repair (T6 R1 observability)", async () => {
    const snap = snapshot();
    let call = 0;
    const router = {
      chat: vi.fn(async () => {
        call += 1;
        // Round 1: malformed ambiguity (extra key, empty candidates) — the
        // exact live failure class. Round 2: a valid reply.
        if (call === 1) {
          return {
            text: JSON.stringify(proposalReturning({
              ambiguity: { kind: "referent", question: "Какой именно?", candidates: [], relation: "behind" },
            })),
          };
        }
        return { text: JSON.stringify(proposalReturning()) };
      }),
    } as any;
    const seen: any[] = [];
    const result = await interpretMasterTurn("Где я и что здесь происходит?", snap, router, {
      diagnostics: (event: any) => seen.push(event),
    });

    expect(router.chat).toHaveBeenCalledTimes(2);
    expect(seen.map((event) => event.category)).toContain("proposal_repair_requested");
    const rejected = seen.filter((event) => event.category === "proposal_schema_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      phase: "first_reply_validation",
      failureCategory: "shape:nested_invalid:ambiguity",
      ambKeyCount: 4,
      ambKindValid: true,
      ambQuestionIsString: true,
      ambCandidateCount: 0,
    });
    expect(["plan", "inquiry", "clarification"]).toContain(result.status);
    // No player text or model text ever reaches the diagnostics.
    const dump = JSON.stringify(seen);
    expect(dump).not.toContain("Где я и что здесь происходит");
    expect(dump).not.toContain("Какой именно");
  });

  it("never executes a speech reply for a pure question (T6 negative regression)", async () => {
    const snap = snapshot();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "привет", sourceText: "Что делает первый перевозчик?" },
      supportingClauses: [],
      addressedEntity: { role: "addressee", observerRef: "person_1", surface: "Перевозчик" },
      referents: [{ role: "addressee", observerRef: "person_1", surface: "Перевозчик" }],
    }));
    const seen: any[] = [];
    const result = await interpretMasterTurn("Что делает первый перевозчик?", snap, router, {
      diagnostics: (event: any) => seen.push(event),
    });

    // Round 1 gets the corrective note; the stubborn round-2 reply hits the
    // hard guard — either way nothing executes and no plan is produced.
    expect(result.status).toBe("clarification");
    if (result.status === "clarification") {
      expect(result.question.length).toBeGreaterThan(0);
    }
    const guard = seen.filter((event) => event.category === "proposal_schema_rejected" && event.failureCategory === "question_replica_action");
    expect(guard.length).toBeGreaterThanOrEqual(1);
    expect(router.chat).toHaveBeenCalledTimes(2);
  });

  it("corrects a speech reply that drops a mixed replica's question (question-safety)", async () => {
    const snap = snapshot();
    const fence = snap.scene.context.visibleObjects.find((object) => object.label === "Ограда");
    expect(fence).toBeDefined();
    // «она» is dual (person+thing): without a focus the pronoun step
    // clarifies before the model — mirror the confirmed mention the
    // deterministic approach turn records in production. The camp world
    // really contains the fence, so world-side target resolution agrees
    // with the scene table.
    const conversation = {
      ...snap.conversation,
      recentFocus: [{ kind: "target" as const, surface: "Ограда", turnSeq: 1 }],
    };
    const speechReply = JSON.stringify({
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "привет", sourceText: "Подойду к ограде" },
      supportingClauses: [],
      addressedEntity: { role: "addressee", observerRef: "person_1", surface: "Ограда" },
      referents: [{ role: "addressee", observerRef: "person_1", surface: "Ограда" }],
    });
    let call = 0;
    const router = {
      chat: vi.fn(async () => {
        call += 1;
        // Round 1 drops the embedded question; round 2 carries it.
        if (call === 1) return { text: speechReply };
        return {
          text: JSON.stringify({
            schemaVersion: 2,
            kind: "mixed",
            primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойду к ограде" },
            supportingClauses: [],
            question: { queryId: "visible_scene" },
            target: { role: "target", observerRef: fence!.observerRef, surface: "Ограда" },
            referents: [{ role: "target", observerRef: fence!.observerRef, surface: "Ограда" }],
          }),
        };
      }),
    } as any;
    const seen: any[] = [];
    const result = await interpretMasterTurn("Подойду к ограде, как она выглядит?", { ...snap, conversation }, router, {
      diagnostics: (event: any) => seen.push(event),
    });

    const dropped = seen.filter((event) => event.category === "proposal_schema_rejected" && event.failureCategory === "question_dropped");
    expect(dropped).toHaveLength(1);
    expect(router.chat).toHaveBeenCalledTimes(2);
    // The corrected reply executes BOTH parts: the approach and the question.
    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.execution?.intent).toMatchObject({ type: "ActionIntentCommand", operation: "approach" });
    expect(result.plan.postActionInquiries.map((entry) => entry.queryId)).toEqual(["visible_scene"]);
  });

  it("a stubborn question-dropper degrades to the deterministic action, never speech", async () => {
    const snap = snapshot();
    // Same focus precondition as above: «она» must continue the confirmed
    // mention instead of clarifying between person and objects.
    const conversation = {
      ...snap.conversation,
      recentFocus: [{ kind: "target" as const, surface: "Ограда", turnSeq: 1 }],
    };
    const speechReply = JSON.stringify({
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "привет", sourceText: "Подойду к ограде" },
      supportingClauses: [],
      addressedEntity: { role: "addressee", observerRef: "person_1", surface: "Ограда" },
      referents: [{ role: "addressee", observerRef: "person_1", surface: "Ограда" }],
    });
    const router = routerReturning(speechReply);
    const seen: any[] = [];
    const result = await interpretMasterTurn("Подойду к ограде, как она выглядит?", { ...snap, conversation }, router, {
      diagnostics: (event: any) => seen.push(event),
    });

    // Round 1 corrected, round 2 hit the hard guard — the degraded path is
    // honest: the deterministic approach (the replica's action) when the
    // parse is clean, otherwise the pronoun-aware clarification (the parsed
    // target carries «она»). The model's speech never produces a plan.
    expect(router.chat).toHaveBeenCalledTimes(2);
    expect(seen.filter((event) => event.category === "proposal_schema_rejected" && event.failureCategory === "question_dropped").length).toBeGreaterThanOrEqual(1);
    expect(["clarification", "deterministic"]).toContain(result.status);
    if (result.status === "deterministic") {
      expect(result.intent).toMatchObject({ type: "ActionIntentCommand", operation: "approach" });
    }
    expect(result.status).not.toBe("plan");
  });

  it("the degraded path never executes deterministic speech for a question-bearing replica (live control)", async () => {
    // Live control (replica 4 on the Pi): the parser infers SPEAK from the
    // question form, the model failed shape twice, and the speak-addressee
    // fallback executed «Ты обращаешься к …» — bypassing the question-safety
    // guard. People must be present in the scene, or the bind fails for the
    // wrong reason.
    const snap = snapshot();
    const references = new Map(snap.scene.references);
    references.set("person_1", { kind: "person", internalId: "warden", label: "Староста южного посада" });
    const scene = {
      ...snap.scene,
      references,
      context: {
        ...snap.scene.context,
        knownPeople: [{ observerRef: "person_1", kind: "person" as const, label: "Староста южного посада", knownAs: ["Староста"], known: true }],
      },
    };
    const conversation = {
      ...snap.conversation,
      recentFocus: [{ kind: "target" as const, surface: "Староста южного посада", turnSeq: 1 }],
    };
    const router = routerReturning("не json вовсе");
    const result = await interpretMasterTurn("Подойду к старосте, как он выглядит?", { ...snap, scene, conversation }, router);

    expect(router.chat).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("clarification");
  });

  it("keeps addressing a person executable (T6 positive control)", async () => {
    const snap = snapshot();
    const references = new Map(snap.scene.references);
    references.set("person_1", { kind: "person", internalId: "ferryman", label: "Перевозчик" });
    const scene = {
      ...snap.scene,
      references,
      context: {
        ...snap.scene.context,
        knownPeople: [{ observerRef: "person_1", kind: "person" as const, label: "Перевозчик", knownAs: ["Перевозчик"], known: true }],
      },
    };
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "Как дела?", sourceText: "Спрошу перевозчика, что он делает" },
      supportingClauses: [],
      addressedEntity: { role: "addressee", observerRef: "person_1", surface: "Перевозчик" },
      referents: [{ role: "addressee", observerRef: "person_1", surface: "Перевозчик" }],
    }));
    const seen: any[] = [];
    const result = await interpretMasterTurn("Спрошу перевозчика, что он делает", { ...snap, scene }, router, {
      diagnostics: (event: any) => seen.push(event),
    });

    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.execution?.intent).toMatchObject({ type: "ActionIntentCommand", operation: "speak" });
  });

  it("emits closed-token structure dims for the accepted plan (T6 R1)", async () => {
    const snap = snapshot();
    const router = routerReturning(JSON.stringify(proposalReturning({
      questionPlan: {
        subjects: [{ id: "me", surface: "я", kind: "self" }],
        parts: [{ id: "p", subjectRefs: ["me"], aspect: "background_arrival", time: "past", purpose: "explain" }],
      },
      readings: [{ partId: "p", source: "background_arrival" }],
    })));
    const seen: any[] = [];
    await interpretMasterTurn("Где я и что здесь происходит?", snap, router, {
      diagnostics: (event: any) => seen.push(event),
    });

    const received = seen.find((event) => event.category === "turn_proposal_received");
    expect(received).toMatchObject({
      planSubjectKinds: "self",
      planAspects: "background_arrival",
      planSources: "background_arrival",
      planSubjectCount: 1,
      planPartCount: 1,
      planReadingCount: 1,
    });
    expect(JSON.stringify(seen)).not.toContain("Где я и что здесь происходит");
  });

  it("turns an ambiguous subject binding into a clarification instead of a round", async () => {
    const snap = snapshot();
    const scene = {
      ...snap.scene,
      context: {
        ...snap.scene.context,
        knownPeople: [
          { observerRef: "person_1", kind: "person" as const, label: "Сторож", knownAs: [] },
          { observerRef: "person_3", kind: "person" as const, label: "Старый сторож", knownAs: [] },
        ],
      },
    };
    const router = routerReturning(JSON.stringify(proposalReturning({
      questionPlan: {
        subjects: [{ id: "guard", surface: "сторож", kind: "entity" }],
        parts: [{ id: "p-act", subjectRefs: ["guard"], aspect: "current_activity", time: "current", purpose: "describe" }],
      },
      readings: [{ partId: "p-act", source: "scene" }],
    })));
    const result = await interpretMasterTurn("Где я и что здесь происходит?", { ...snap, scene }, router);

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question.toLowerCase()).toContain("сторож");
    expect(result.options.length).toBeGreaterThanOrEqual(2);
    expect((result as { questionRound?: unknown }).questionRound).toBeUndefined();
  });
  it("continues a model question ambiguity through a persisted read-only QuestionPlan", async () => {
    const snap = snapshot();
    const references = new Map(snap.scene.references);
    references.set("person_1", { kind: "person", internalId: "contact:first", label: "Guard" });
    references.set("person_3", { kind: "person", internalId: "contact:second", label: "Guard" });
    const people = [
      { observerRef: "person_1", kind: "person" as const, label: "Guard", knownAs: [], known: true, portrait: { visibleAppearance: ["dark coat"], distinguishingFeatures: ["brass badge"], publicRole: "ferry keeper", addressForms: [] } },
      { observerRef: "person_3", kind: "person" as const, label: "Guard", knownAs: [], known: true, portrait: { visibleAppearance: ["blue scarf"], distinguishingFeatures: ["silver key"], publicRole: "gate keeper", addressForms: [] } },
    ];
    const scene = { ...snap.scene, references, context: { ...snap.scene.context, knownPeople: people } };
    const input = "Что на нём одето и как он себя ведёт?";
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "inquiry",
      primaryIntent: null,
      supportingClauses: [],
      referents: [],
      ambiguity: { kind: "question", question: "Which guard do you mean?", candidates: ["Guard", "Guard"] },
      questionPlan: {
        subjects: [{ id: "guard", surface: "Guard", kind: "entity" }],
        parts: [
          { id: "clothes", subjectRefs: ["guard"], aspect: "appearance", time: "current", purpose: "describe" },
          { id: "reaction", subjectRefs: ["guard"], aspect: "observed_reaction", time: "current", purpose: "describe" },
        ],
      },
      readings: [
        { partId: "clothes", source: "person" },
        { partId: "reaction", source: "scene" },
      ],
    }));
    const first = await interpretMasterTurn(input, { ...snap, scene }, router);
    expect(first.status).toBe("clarification");
    if (first.status !== "clarification") return;
    expect(first.framed).toMatchObject({ slot: "question_subject", subjectId: "guard", originalInput: input });
    expect(first.options).toHaveLength(2);
    expect(first.options[0]!.label).not.toBe(first.options[1]!.label);
    expect(first.options.every((option) => option.referentRefs?.length === 1)).toBe(true);
    expect(first.options.map((option) => option.label).join(" ")).toContain("ferry keeper");
    expect(first.options.map((option) => option.label).join(" ")).toContain("gate keeper");
    expect(JSON.stringify(first.options)).not.toContain("contact:first");


    const metadata = buildTurnMemoryMetadata({
      clarification: { question: first.question, options: first.options, framed: first.framed },
    });
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-question-continuation-")), "events.sqlite");
    const initialStore = createMultiWorldStore(dbPath);
    initialStore.recordConversationTurn(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "question-frame",
      playerText: input,
      inputClass: "inquiry",
      responseKind: "clarification",
      responseText: first.question,
      worldTime: snap.world.time,
      contextMetadata: metadata,
    }));
    initialStore.close();

    const reloadedStore = createMultiWorldStore(dbPath);
    try {
      const conversation = buildMasterConversationContext(
        reloadedStore.listRecentConversationTurns(LEGACY_WORLD_ID, { limit: 30 }),
        LEGACY_WORLD_ID,
        { scene: scene.context },
      );
      expect(conversation.pendingClarification).toMatchObject({
        question: first.question,
        originalInput: input,
      });
      expect(conversation.pendingClarification?.framed).toEqual(first.framed);
      expect(conversation.pendingClarification?.options).toEqual(first.options);

      const selected = conversation.pendingClarification!.options[1]!;
      const answer = await interpretMasterTurn(selected.label, { ...snap, scene, conversation }, router);
      expect(answer.status).toBe("plan");
      if (answer.status !== "plan") return;
      expect(answer.plan.execution).toBeNull();
      expect(answer.plan.kind).toBe("inquiry");
      expect(answer.questionRound?.questionPlan.subjects[0]).toMatchObject({
        resolution: "resolved",
        resolvedRef: selected.referentRefs![0],
      });
      expect(answer.questionRound?.questionPlan.parts.map((part) => part.aspect)).toEqual(["appearance", "observed_reaction"]);
      expect(answer.questionRound?.readings).toEqual([
        { partId: "clothes", source: "person" },
        { partId: "reaction", source: "scene" },
      ]);
      expect(answer.questionRound?.questionPlan.actionIntent).toBeNull();
      expect(answer.pendingLink).toEqual({
        relation: "resolves",
        clarificationTurnSeq: conversation.pendingClarification!.turnSeq,
      });
      expect(router.chat).toHaveBeenCalledTimes(1);
      expect(snap.world.time).toBe(0);
      expect(snap.events).toHaveLength(5);

      const oversized = await interpretMasterTurn(input + " ".repeat(500), { ...snap, scene }, router);
      expect(oversized.status).toBe("clarification");
      if (oversized.status === "clarification") expect(oversized.framed).toBeUndefined();
    } finally {
      reloadedStore.close();
    }
  });

  it("resolves a question ambiguity when recent focus identifies one candidate", async () => {
    const snap = citySnapshot();
    const archivist = [...snap.scene.references].find(([, reference]) => reference.internalId === "contact:archivist")?.[0];
    const gatekeeper = [...snap.scene.references].find(([, reference]) => reference.internalId === "contact:gatekeeper")?.[0];
    expect(archivist).toBeDefined();
    expect(gatekeeper).toBeDefined();
    const conversation = {
      ...snap.conversation,
      recentFocus: [{
        kind: "target" as const,
        surface: "Архивист Речного Стража",
        turnSeq: 1,
        identity: { kind: "person" as const, internalId: "contact:archivist" },
      }],
    };
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "inquiry",
      primaryIntent: null,
      supportingClauses: [],
      referents: [],
      ambiguity: {
        kind: "question",
        question: "Which person do you mean?",
        candidates: ["Архивист Речного Стража", "Смотритель речных ворот"],
      },
      questionPlan: {
        subjects: [{ id: "person", surface: "он", kind: "entity" }],
        parts: [{ id: "clothes", subjectRefs: ["person"], aspect: "appearance", time: "current", purpose: "describe" }],
      },
      readings: [{ partId: "clothes", source: "person" }],
    }));
    const result = await interpretMasterTurn("Что на нём одето?", { ...snap, conversation }, router);
    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.execution).toBeNull();
    expect(result.questionRound?.questionPlan.subjects[0]).toMatchObject({
      resolution: "resolved",
      resolvedRef: archivist,
    });
    expect(result.questionRound?.questionPlan.subjects[0]?.resolvedRef).not.toBe(gatekeeper);
    expect(router.chat).toHaveBeenCalledTimes(1);
    expect(snap.world.time).toBe(0);
    expect(snap.events).toHaveLength(7);
  });

  it("preserves a semantic question ambiguity when its choices are not scene people", async () => {
    const snap = snapshot();
    const router = routerReturning(JSON.stringify({
      schemaVersion: 2,
      kind: "inquiry",
      primaryIntent: null,
      supportingClauses: [],
      referents: [],
      ambiguity: { kind: "question", question: "Which aspect do you mean?", candidates: ["appearance", "reaction"] },
      questionPlan: {
        subjects: [{ id: "guard", surface: "Guard", kind: "entity" }],
        parts: [{ id: "clothes", subjectRefs: ["guard"], aspect: "appearance", time: "current", purpose: "describe" }],
      },
      readings: [{ partId: "clothes", source: "person" }],
    }));
    const result = await interpretMasterTurn("Что на нём одето и как он себя ведёт?", snap, router);
    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toBe("Which aspect do you mean?");
    expect(result.options.map((option) => option.label)).toEqual(["appearance", "reaction"]);
    expect(result.framed).toBeUndefined();
  });

  it("replays the failing live session end-to-end without losing the referent or looping", async () => {
    const snap = citySnapshot();
    const dead = routerReturning("не разбираем");

    // Step 1: compound replica "подхожу к архивисту и приветствую его"
    const step1 = await interpretMasterTurn("подхожу к архивисту и приветствую его", snap, dead);
    expect(step1.status).toBe("clarification");
    if (step1.status !== "clarification") return;
    expect(step1.options.every((opt) => Boolean(opt.intentPatch?.actionText))).toBe(true);

    // Step 2: player answers naturally "я же сказал, к архивисту" — resolves
    // directly to the approach intent via the compound option's intentPatch!
    const storedTurn1 = {
      turnSeq: 1,
      worldId: "test-world",
      correlationId: "c1",
      idempotencyKey: "k1",
      playerText: "подхожу к архивисту и приветствую его",
      inputClass: "clarification",
      worldTimeBefore: 0,
      worldTimeAfter: 0,
      responseKind: "clarification",
      responseText: step1.question,
      createdAt: 1,
      contextMetadata: buildTurnMemoryMetadata({
        clarification: { question: step1.question, options: step1.options },
      }),
    } as any;
    const convAfter1 = buildMasterConversationContext([storedTurn1], "test-world", { scene: snap.scene.context });
    const step2 = await interpretMasterTurn("я же сказал, к архивисту", { ...snap, conversation: convAfter1 }, dead);
    expect(step2.status).toBe("deterministic");
    if (step2.status === "deterministic") {
      expect(step2.intent).toMatchObject({ type: "ActionIntentCommand", operation: "approach" });
      expect(step2.pendingLink).toEqual({ relation: "resolves", clarificationTurnSeq: 1 });
    }

    // Step 3: explicit referent disambiguation "когда я говорю архивист, я имею ввиду Архивиста Речного Стража"
    // resolves to a focused read-only inquiry on the archivist (never character_identity).
    const step3 = await interpretMasterTurn(
      "когда я говорю архивист, я имею ввиду Архивиста Речного Стража",
      snap,
      dead,
    );
    expect(step3.status).toBe("inquiry");
    if (step3.status === "inquiry") {
      expect(step3.inquiry.queryId).toBe("visible_scene");
      expect(step3.inquiry.focus?.surface).toBe("Архивист Речного Стража");
    }

    // Step 4: ordinal frame selection ("первое" / "к первому") and conversational cancel ("ладно, забудь")
    const step2Ordinal = await interpretMasterTurn("давай первое", { ...snap, conversation: convAfter1 }, dead);
    expect(step2Ordinal.status).toBe("deterministic");

    const step2Cancel = await interpretMasterTurn("ладно, забудь", { ...snap, conversation: convAfter1 }, dead);
    expect(step2Cancel.status).toBe("inquiry");
    if (step2Cancel.status === "inquiry") {
      expect(step2Cancel.pendingLink).toEqual({ relation: "resolves", clarificationTurnSeq: 1 });
    }

    // Step 5: natural Master conversational check-ins and meta requests
    const greeting = await interpretMasterTurn("привет, мастер", snap, dead);
    expect(greeting.status).toBe("inquiry");

    const repeat = await interpretMasterTurn("Повтори, что ты только что сказал.", snap, dead);
    expect(repeat.status).toBe("plan");
    if (repeat.status === "plan") {
      expect(repeat.plan.metaInquiry?.operation).toBe("repeat_last_answer");
    }

    const advice = await interpretMasterTurn("что посоветуешь?", snap, dead);
    expect(advice.status).toBe("plan");
    if (advice.status === "plan") {
      expect(advice.plan.metaInquiry?.operation).toBe("explain_available_actions");
    }
  });

});
