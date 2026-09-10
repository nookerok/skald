import { describe, expect, it, vi } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  buildMasterTurnSceneContext,
  createRules,
} from "@skald/world";
import type { TurnProposalV2 } from "@skald/intent-parser";
import { interpretPlayerInput } from "../src/runtime/intent-gateway.js";
import {
  MASTER_TURN_DIAGNOSTIC_CATEGORIES,
  emitMasterTurnDiagnostic,
} from "../src/runtime/master-turn-diagnostics.js";
import { validateMasterTurnPlan } from "../src/runtime/master-turn-validator.js";
import { revalidateMasterTurnPlan } from "../src/runtime/master-turn-revalidation.js";
import { executeMasterTurnPlan } from "../src/runtime/master-turn-executor.js";

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function campObject(id: string, name: string, state: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): DomainEvent {
  return campEvent("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [name], description: name, material: "wood",
    locationId: "camp", integrity: 100, temperature: 20, state, ...metadata,
  }, 0);
}

function bootCamp() {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const events: DomainEvent[] = [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь.",
      objectIds: ["torch"], connections: {},
    }, 0),
    campEvent("LocationDefined", "boot-grove", {
      id: "grove", name: "Роща", description: "Тихая роща.",
      objectIds: [], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    campObject("torch", "факел", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
  ];
  for (const bootstrap of events) {
    projection.apply(bootstrap);
    bus.append(bootstrap);
  }
  return { engine: new RuleEngine(createRules(), projection, bus), projection, events };
}

function routerReturning(text: string) {
  return { chat: vi.fn().mockResolvedValue({ text }) } as any;
}

describe("master turn diagnostic taxonomy", () => {
  it("fixes the fifteen plan categories", () => {
    expect(MASTER_TURN_DIAGNOSTIC_CATEGORIES).toEqual([
      "deterministic_fast_path",
      "context_required",
      "context_built",
      "conversation_context",
      "turn_proposal_requested",
      "turn_proposal_received",
      "proposal_repair_requested",
      "proposal_schema_rejected",
      "referent_rejected",
      "stale_context",
      "world_revalidation_failed",
      "primary_executed",
      "post_action_inquiry_answered",
      "clarification_returned",
      "deterministic_fallback",
    ]);
    expect(Object.isFrozen(MASTER_TURN_DIAGNOSTIC_CATEGORIES)).toBe(true);
  });

  it("emits conforming events and strips smuggled keys", () => {
    const seen: unknown[] = [];
    emitMasterTurnDiagnostic((event) => seen.push(event), {
      category: "referent_rejected",
      outcome: "clarification",
      phase: "context_validation",
      turnKind: "action",
      referentCount: 1,
      playerText: "подхожу к ограде",
      prompt: "system prompt",
      response: "model text",
      referenceTable: { object_1: "x" },
    } as any);

    expect(seen).toHaveLength(1);
    const event = seen[0] as Record<string, unknown>;
    expect(event.kind).toBe("intent");
    expect(event.category).toBe("referent_rejected");
    expect(event.turnKind).toBe("action");
    expect(event.referentCount).toBe(1);
    const json = JSON.stringify(seen);
    expect(json).not.toContain("подхожу к ограде");
    expect(json).not.toContain("system prompt");
    expect(json).not.toContain("model text");
    expect(json).not.toContain("referenceTable");
  });

  it("carries conversation_context counts without dialogue content", () => {
    const seen: unknown[] = [];
    emitMasterTurnDiagnostic((event) => seen.push(event), {
      category: "conversation_context",
      outcome: "degraded",
      phase: "snapshot",
      messageCount: 12,
      mentionCount: 2,
      hasPendingClarification: true,
      hasGoal: false,
      hasDramaticThread: true,
      truncated: true,
      question: "С кем?",
    } as any);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "intent",
      category: "conversation_context",
      outcome: "degraded",
      messageCount: 12,
      mentionCount: 2,
      hasPendingClarification: true,
      hasGoal: false,
      hasDramaticThread: true,
      truncated: true,
    });
    expect(JSON.stringify(seen)).not.toContain("С кем?");
  });

  it("never throws and no-ops without a sink", () => {
    expect(() => emitMasterTurnDiagnostic(undefined, { category: "primary_executed", outcome: "accepted" })).not.toThrow();
    expect(() => emitMasterTurnDiagnostic(() => { throw new Error("sink down"); }, { category: "primary_executed", outcome: "accepted" })).not.toThrow();
  });
});

describe("master turn emission points", () => {
  it("marks the deterministic fast path without calling the model", async () => {
    const seen: any[] = [];
    const router = routerReturning("{}");
    const result = await interpretPlayerInput("осматриваюсь", router, {
      diagnostics: (event) => seen.push(event),
      correlationId: "diag-fast",
      worldTime: 3,
    });

    expect(result.status).toBe("accepted");
    expect(router.chat).not.toHaveBeenCalled();
    const fast = seen.find((event) => event.category === "deterministic_fast_path");
    expect(fast).toMatchObject({ outcome: "accepted", phase: "fast_path", correlationId: "diag-fast", worldTime: 3 });
    expect(JSON.stringify(seen)).not.toContain("осматриваюсь");
  });

  it("marks LLM diversions as context required", async () => {
    const seen: any[] = [];
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня" },
    }));
    await interpretPlayerInput("обхожу башню западнее", router, {
      diagnostics: (event) => seen.push(event),
    });

    expect(seen.map((event) => event.category)).toContain("context_required");
    expect(JSON.stringify(seen)).not.toContain("обхожу башню западнее");
  });

  it("reports stale referents and ambiguity from contextual validation", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");
    const base = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
      supportingClauses: [],
      referents: [{ role: "target", observerRef: torch.observerRef, surface: torch.label }],
    } as const;

    const staleSeen: any[] = [];
    const stale = validateMasterTurnPlan({
      proposal: {
        ...base,
        target: { role: "target", observerRef: "object_99", surface: torch.label },
      } as unknown as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю",
      diagnostics: (event) => staleSeen.push(event),
    });
    expect(stale.status).toBe("clarification");
    expect(staleSeen.map((event) => event.category)).toEqual(["referent_rejected"]);
    expect(staleSeen[0]).toMatchObject({ turnKind: "action", referentCount: 1 });
    expect(JSON.stringify(staleSeen)).not.toContain("object_99");

    const ambiguousSeen: any[] = [];
    const ambiguous = validateMasterTurnPlan({
      proposal: {
        ...base,
        target: { role: "target", observerRef: torch.observerRef, surface: torch.label },
        ambiguity: { kind: "referent", question: "Кого?", candidates: ["a", "b"] },
      } as unknown as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю",
      diagnostics: (event) => ambiguousSeen.push(event),
    });
    expect(ambiguous.status).toBe("clarification");
    expect(ambiguousSeen.map((event) => event.category)).toEqual(["clarification_returned"]);

    const acceptedSeen: any[] = [];
    const accepted = validateMasterTurnPlan({
      proposal: {
        ...base,
        target: { role: "target", observerRef: torch.observerRef, surface: torch.label },
      } as unknown as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю факел",
      diagnostics: (event) => acceptedSeen.push(event),
    });
    expect(accepted.status).toBe("accepted");
    expect(acceptedSeen).toEqual([]);
  });

  it("reports stale queue revalidation once and stays silent when fresh", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const plan = {
      contextRevision: { worldTime: world.time, eventNumber: world.eventNumber },
      kind: "action",
      execution: {
        intent: {
          type: "InteractionCommand",
          verb: "observe",
          target: { raw: "факел" },
          rawText: "осматриваю факел",
          interpretation: { source: "llm", confidence: 1, ambiguities: [] },
        },
      },
      postActionInquiry: null,
      metaInquiry: null,
      deferredClauses: [],
      focus: [],
    } as const;

    const freshSeen: any[] = [];
    expect(revalidateMasterTurnPlan({
      plan, scene, world, diagnostics: (event) => freshSeen.push(event),
    })).toEqual({ status: "fresh" });
    expect(freshSeen).toEqual([]);

    projection.apply(campEvent("PlayerLocationChanged", "move-grove", { locationId: "grove" }, 1));
    const staleSeen: any[] = [];
    const stale = revalidateMasterTurnPlan({
      plan, scene, world: projection.getSnapshot(), diagnostics: (event) => staleSeen.push(event),
    });
    expect(stale.status).toBe("stale");
    expect(staleSeen.map((event) => event.category)).toEqual(["stale_context"]);
    expect(staleSeen[0]).toMatchObject({
      turnKind: "action",
      contextWorldTime: world.time,
      contextEventNumber: world.eventNumber,
    });
  });

  it("reports execution and inquiry answers without duplicating stale", () => {
    const { engine, projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");
    const validated = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
        supportingClauses: [],
        target: { role: "target", observerRef: torch.observerRef, surface: torch.label },
        question: { queryId: "visible_scene" },
        referents: [{ role: "target", observerRef: torch.observerRef, surface: torch.label }],
      } as unknown as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю факел, что я вижу?",
    });
    expect(validated.status).toBe("accepted");
    if (validated.status !== "accepted") return;

    const seen: any[] = [];
    const result = executeMasterTurnPlan(validated.plan, scene, {
      engine,
      projection,
      events,
      worldId: "camp-diag",
      diagnostics: (event) => seen.push(event),
    });

    expect(result.status).toBe("executed");
    const categories = seen.map((event) => event.category);
    expect(categories).toContain("primary_executed");
    expect(categories).toContain("post_action_inquiry_answered");
    expect(categories).not.toContain("stale_context");
    const answered = seen.find((event) => event.category === "post_action_inquiry_answered");
    expect(answered).toMatchObject({ queryId: "visible_scene", turnKind: "mixed" });
    expect(JSON.stringify(seen)).not.toContain("осматриваю факел, что я вижу?");
  });
});
