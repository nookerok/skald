import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  buildNarrativeAdapterContext,
  createRules,
  getRegionEntrypoint,
  rebuildProjection,
  selectTurnPresentation,
} from "@skald/world";
import type { TurnProposalV2 } from "@skald/intent-parser";
import { validateMasterTurnPlan } from "../src/runtime/master-turn-validator.js";
import { executeMasterTurnPlan } from "../src/runtime/master-turn-executor.js";
import { composeMasterTurnResponse } from "../src/conversation/master-turn-response.js";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import { conversationRequestHash } from "../src/conversation/builder.js";
import { bindTurnPronouns } from "../src/conversation/focus-stack.js";
import { buildMixedConversationTurn } from "../src/conversation/builder.js";
import type { ConversationTurnDraft } from "../src/conversation/types.js";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function campObject(id: string, name: string, aliases: readonly string[] = [name]): DomainEvent {
  return campEvent("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [...aliases], description: name, material: "wood",
    locationId: "camp", integrity: 100, temperature: 20, state: { portable: true },
    mass: 1, portable: true, affordances: ["ignite"],
  }, 0);
}

function bootCamp() {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const events: DomainEvent[] = [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: ["torch", "fence"], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    campObject("torch", "факел"),
    campObject("fence", "ограда", ["ограду", "оградой", "ограде"]),
  ];
  for (const bootstrap of events) {
    projection.apply(bootstrap);
    bus.append(bootstrap);
  }
  return { engine: new RuleEngine(createRules(), projection, bus), projection, events };
}

function livingScene() {
  const events = buildBootstrapEvents({
    templateId: "living_region",
    regionId: "riverwatch-basin",
    entrypointId: "river_waystation_arrival",
    backgroundId: "keeper",
  });
  const world = rebuildProjection(events).getSnapshot();
  const narrativeContext = buildNarrativeAdapterContext(events, world, {
    profile: { background_id: "keeper" },
    entrypoint: getRegionEntrypoint("river_waystation_arrival"),
    characterName: "Виктор",
  });
  return { events, world, scene: buildMasterTurnSceneContext(events, world, narrativeContext) };
}

const REPLICA = "осматриваю факел и лагерь, что я вижу?";

describe("mixed turn integration", () => {
  it("carries one primary through execution, composition and a single durable turn", () => {
    const { engine, projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");

    const validated = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю факел" },
        supportingClauses: [{ kind: "deferred_action", summary: "осмотреть лагерь" }],
        target: { role: "target", observerRef: torch.observerRef, surface: torch.label },
        question: { queryId: "visible_scene" },
        referents: [{ role: "target", observerRef: torch.observerRef, surface: torch.label }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: REPLICA,
    });
    expect(validated.status).toBe("accepted");
    if (validated.status !== "accepted") return;

    const executed = executeMasterTurnPlan(validated.plan, scene, {
      engine,
      projection,
      events,
      worldId: "camp-mixed",
    });
    expect(executed.status).toBe("executed");
    if (executed.status !== "executed") return;
    expect(executed.executed).toBe(true);
    expect(executed.actionRejected).toBe(false);
    // Exactly one primary command root; the deferred action never runs.
    expect(executed.commandEvents.filter((event) => event.type === "InteractionRequested")).toHaveLength(1);
    // At most one game tick for the whole mixed turn.
    expect(executed.revisionAfter.worldTime - executed.revisionBefore.worldTime).toBeLessThanOrEqual(1);
    // The post-action question is answered on the new projection.
    expect(executed.inquiryAnswer?.queryId).toBe("visible_scene");
    expect(executed.inquiryAnswer?.answer.length).toBeGreaterThan(0);
    expect(executed.deferred).toEqual([{ text: "осмотреть лагерь", reason: "secondary_action" }]);

    const postWorld = projection.getSnapshot();
    const presentation = selectTurnPresentation(
      [...executed.commandEvents, ...executed.tickEvents],
      postWorld,
    );
    const response = composeMasterTurnResponse({
      kind: "mixed",
      actionPresentation: presentation.response || presentation.primary
        ? { text: presentation.response?.text ?? presentation.primary?.text ?? "", rejected: false }
        : null,
      inquiryAnswer: executed.inquiryAnswer ? { text: executed.inquiryAnswer.answer } : null,
      speechReaction: null,
      metaAnswer: null,
      deferredClauses: executed.deferred,
      clarification: null,
    });
    expect(response.kind).toBe("mixed_outcome");
    expect(response.text).toContain("осмотреть лагерь");
    expect(response.sanitized).toBe(false);

    // One durable turn: the full replica plus the single combined answer.
    const draft = buildMixedConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-mixed",
      idempotencyKey: "mixed-integration-1",
      playerText: REPLICA,
      worldTimeBefore: 0,
      preEvents: events,
      stagedEvents: [...executed.commandEvents, ...executed.tickEvents],
      projectedWorld: postWorld,
      profile: null,
      characterProfile: null,
      inquiry: validated.plan.postActionInquiry,
      deferred: executed.deferred,
    });
    expect(draft.inputClass).toBe("mixed");
    expect(draft.responseKind).toBe("mixed_outcome");
    expect(draft.playerText).toBe(REPLICA);
    expect(draft.responseText).toContain("осмотреть лагерь");

    const db = join(mkdtempSync(join(tmpdir(), "skald-mixed-integration-")), "events.sqlite");
    const store = createMultiWorldStore(db);
    store.commitBatch(LEGACY_WORLD_ID, [...executed.commandEvents, ...executed.tickEvents], {
      idempotencyKey: "mixed-integration-1",
      requestKind: "command",
      correlationId: "cmd-mixed",
      conversationTurn: draft,
    });
    const turns = store.listConversationTurns(LEGACY_WORLD_ID);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.playerText).toBe(REPLICA);
    store.close();

    const reopened = createMultiWorldStore(db);
    expect(reopened.listConversationTurns(LEGACY_WORLD_ID)).toEqual(turns);
    reopened.close();
  });
});

function actionRow(turnSeq: number, playerText: string, responseText = "Ответ Мастера.") {
  return {
    turnSeq,
    worldId: LEGACY_WORLD_ID,
    correlationId: `c${turnSeq}`,
    idempotencyKey: `k${turnSeq}`,
    playerText,
    inputClass: "action" as const,
    worldTimeBefore: 0,
    worldTimeAfter: 1,
    responseKind: "action_outcome" as const,
    responseText,
    createdAt: turnSeq,
  };
}

describe("referent sequences across turns", () => {
  it("binds him to the mentioned carrier", () => {
    const { scene } = livingScene();
    const carrier = scene.context.knownPeople.find((person) => person.label.includes("Перевозчик"));
    if (!carrier) throw new Error("living scene has no carrier");
    const context = buildMasterConversationContext(
      [actionRow(1, "подойти к перевозчику")],
      LEGACY_WORLD_ID,
    );
    const [binding] = bindTurnPronouns("спрошу у него о воде", context, scene.context);

    expect(binding?.pronoun).toBe("него");
    expect(binding?.candidates[0]).toBe(carrier.observerRef);
    expect(binding?.mention).toMatchObject({ surface: "перевозчику" });
  });

  it("binds her to the examined object", () => {
    const { projection, events } = bootCamp();
    const scene = buildMasterTurnSceneContext(events, projection.getSnapshot());
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");
    const context = buildMasterConversationContext(
      [actionRow(1, "осматриваю факел")],
      LEGACY_WORLD_ID,
    );
    const [binding] = bindTurnPronouns("осмотрю его внимательнее", context, scene.context);

    expect(binding?.pronoun).toBe("его");
    expect(binding?.candidates[0]).toBe(torch.observerRef);
  });

  it("binds behind-her to the watched fence with its preposition", () => {
    const { projection, events } = bootCamp();
    const scene = buildMasterTurnSceneContext(events, projection.getSnapshot());
    const fence = scene.context.visibleObjects.find((object) => object.label === "ограда");
    if (!fence) throw new Error("placed fence is not visible in the camp scene");
    const context = buildMasterConversationContext(
      [actionRow(1, "смотрю на ограду")],
      LEGACY_WORLD_ID,
    );
    const [binding] = bindTurnPronouns("а что за ней?", context, scene.context);

    expect(binding?.pronoun).toBe("ней");
    expect(binding?.preposition).toBe("за");
    expect(binding?.candidates[0]).toBe(fence.observerRef);
  });

  it("keeps topic pronouns inside known topics without inventing refs", () => {
    const { scene } = livingScene();
    const context = buildMasterConversationContext(
      [actionRow(1, "спрашиваю о старом русле")],
      LEGACY_WORLD_ID,
    );
    const [binding] = bindTurnPronouns("что мне об этом известно?", context, scene.context);

    expect(binding?.pronoun).toBe("этом");
    expect(binding?.classes).toEqual(["topic"]);
    expect(binding?.mention).toBeNull();
    const topicRefs = new Set(scene.context.knownTopics.map((topic) => topic.observerRef));
    for (const candidate of binding?.candidates ?? []) {
      expect(topicRefs.has(candidate)).toBe(true);
    }
  });

  it("restores the same bindings after a SQLite reload", () => {
    const { scene } = livingScene();
    const rows = [actionRow(1, "подойти к перевозчику"), actionRow(2, "осматриваюсь")];
    const before = bindTurnPronouns(
      "спрошу у него о воде",
      buildMasterConversationContext(rows, LEGACY_WORLD_ID),
      scene.context,
    );

    const db = join(mkdtempSync(join(tmpdir(), "skald-focus-reload-")), "events.sqlite");
    const store = createMultiWorldStore(db);
    for (const row of rows) {
      const draft: ConversationTurnDraft = {
        worldId: row.worldId,
        correlationId: row.correlationId,
        idempotencyKey: row.idempotencyKey,
        requestHash: conversationRequestHash(row.playerText),
        playerText: row.playerText,
        inputClass: row.inputClass,
        worldTimeBefore: row.worldTimeBefore,
        worldTimeAfter: row.worldTimeAfter,
        responseKind: row.responseKind,
        responseText: row.responseText,
      };
      store.recordConversationTurn(draft);
    }
    store.close();

    const reopened = createMultiWorldStore(db);
    const reloaded = reopened.listConversationTurns(LEGACY_WORLD_ID);
    reopened.close();
    const after = bindTurnPronouns(
      "спрошу у него о воде",
      buildMasterConversationContext(reloaded, LEGACY_WORLD_ID),
      scene.context,
    );

    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after[0]?.candidates.length).toBeGreaterThan(0);
  });
});
