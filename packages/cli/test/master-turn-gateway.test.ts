import { describe, expect, it, vi } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { WorldProjector, buildMasterTurnSceneContext, createRules } from "@skald/world";
import { RuleEngine } from "@skald/rule-engine";
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
});
