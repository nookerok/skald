import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  buildGameShellSnapshot,
  buildInquiryAnswer,
  buildMasterTurnSceneContext,
  createRules,
  rebuildProjection,
  selectTurnPresentation,
} from "@skald/world";
import {
  validateTurnProposal,
  type TurnProposalV2,
} from "@skald/intent-parser";
import { interpretPlayerInput } from "../src/runtime/intent-gateway.js";
import { validateMasterTurnPlan } from "../src/runtime/master-turn-validator.js";
import { executeMasterTurnPlan } from "../src/runtime/master-turn-executor.js";
import { composeMasterTurnResponse } from "../src/conversation/master-turn-response.js";
import {
  buildActionConversationTurn,
  buildMixedConversationTurn,
  buildReadSideConversationTurn,
} from "../src/conversation/builder.js";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import { bindTurnPronouns } from "../src/conversation/focus-stack.js";
import type { ConversationTurnDraft } from "../src/conversation/types.js";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";

function event(type: string, eventId: string, payload: unknown, timestamp = 0): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "bootstrap", causationId: null };
}

function acceptanceBootstrap(): DomainEvent[] {
  return [
    event("PlayerSpawned", "boot-player", { x: 0, y: 0 }),
    event("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки. За почерневшей оградой виден двор.",
      objectIds: ["fence", "coffer"], connections: {},
    }),
    event("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }),
    event("WorldObjectPlaced", "boot-object-fence", {
      id: "fence", name: "Ограда", aliases: ["ограду", "оградой", "ограде"], description: "Почерневшая ограда.",
      material: "wood", locationId: "camp", integrity: 100, temperature: 20, state: {},
    }),
    event("WorldObjectPlaced", "boot-object-coffer", {
      id: "coffer", name: "Скрытый ларец", aliases: ["ларец"], description: "Ларец, который никто не замечал.",
      material: "wood", locationId: "camp", integrity: 100, temperature: 20, state: { hidden: true },
    }),
    event("ObjectObserved", "boot-fence-noticed", {
      objectId: "fence", observerId: "player", description: "Почерневшая ограда.",
    }),
    event("ObjectPlaced", "boot-carrier", {
      entityId: "carrier", x: 0, y: 1, name: "Перевозчик", aliases: ["перевозчика", "перевозчику"],
      description: "Перевозчик у переправы.", components: { contact: { locationId: "camp" } },
    }),
    event("RelationChanged", "boot-relation", { from: "player", to: "carrier", kind: "knows", delta: 1 }),
    event("TestimonyReceived", "boot-testimony", {
      observerId: "player", proposition: "Старое русло открывает путь за переправой.",
    }, 0),
  ];
}

/** The world changes only through committed Domain Events, verified by replay. */
function expectReplayPure(events: readonly DomainEvent[], liveTime: number, liveEventNumber: number): void {
  const replayed = rebuildProjection(events).getSnapshot();
  expect(replayed.time).toBe(liveTime);
  expect(replayed.eventNumber).toBe(liveEventNumber);
}

describe("master turn acceptance scenario", () => {
  it("plays five turns and restores pronoun bindings after reload", async () => {
    const projection = new WorldProjector();
    const bus = new EventBus();
    let log: DomainEvent[] = [...acceptanceBootstrap()];
    for (const bootstrap of log) {
      projection.apply(bootstrap);
      bus.append(bootstrap);
    }
    const engine = new RuleEngine(createRules(), projection, bus);
    const rows: ConversationTurnDraft[] = [];
    const noLLM = { chat: (): Promise<never> => { throw new Error("LLM must not be called"); } } as any;

    // Ход 1: deterministic fast path, без LLM, наблюдение пишет Events.
    const turn1 = await interpretPlayerInput("Я осматриваюсь.", noLLM);
    expect(turn1.status).toBe("accepted");
    expect((turn1 as { source?: string }).source).toBe("deterministic");
    const plan1 = validateTurnProposal({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Я осматриваюсь." },
      supportingClauses: [],
      referents: [],
    });
    expect(plan1.status).toBe("accepted");
    if (plan1.status !== "accepted") return;
    const scene1 = buildMasterTurnSceneContext(log, projection.getSnapshot());
    const checked1 = validateMasterTurnPlan({ proposal: plan1.proposal, scene: scene1, world: projection.getSnapshot(), rawText: "Я осматриваюсь." });
    expect(checked1.status).toBe("accepted");
    if (checked1.status !== "accepted") return;
    const run1 = executeMasterTurnPlan(checked1.plan, scene1, { engine, projection, events: log, worldId: "acceptance" });
    expect(run1.status).toBe("executed");
    if (run1.status !== "executed") return;
    expect(run1.commandEvents.length).toBeGreaterThan(0);
    log = [...run1.postEvents];
    const world1 = projection.getSnapshot();
    expectReplayPure(log, world1.time, world1.eventNumber);
    const presentation1 = selectTurnPresentation([...run1.commandEvents, ...run1.tickEvents], world1);
    const masterText1 = presentation1.response?.text ?? presentation1.primary?.text ?? "";
    expect(masterText1.length).toBeGreaterThan(0);
    rows.push(buildActionConversationTurn({
      worldId: LEGACY_WORLD_ID, correlationId: "cmd-turn-1", idempotencyKey: "accept-1",
      playerText: "Я осматриваюсь.", worldTimeBefore: 0, stagedEvents: [...run1.commandEvents, ...run1.tickEvents], projectedWorld: world1,
    }));

    // Ход 2: неизвестная форма — в TurnProposal; ограда только из observer-safe сцены.
    const scene2 = buildMasterTurnSceneContext(log, projection.getSnapshot());
    const fence = scene2.context.visibleObjects.find((object) => object.label === "Ограда");
    if (!fence) throw new Error("fence is not observer-safe visible");
    const fenceRef = scene2.references.get(fence.observerRef);
    expect(fenceRef?.internalId).toBe("fence");
    const plan2 = validateTurnProposal({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ограде." },
      supportingClauses: [],
      target: { role: "target", observerRef: fence.observerRef, surface: fence.label },
      referents: [{ role: "target", observerRef: fence.observerRef, surface: fence.label }],
    });
    expect(plan2.status).toBe("accepted");
    if (plan2.status !== "accepted") return;
    const checked2 = validateMasterTurnPlan({ proposal: plan2.proposal, scene: scene2, world: projection.getSnapshot(), rawText: "Подхожу к ограде." });
    expect(checked2.status).toBe("accepted");
    if (checked2.status !== "accepted") return;
    const run2 = executeMasterTurnPlan(checked2.plan, scene2, { engine, projection, events: log, worldId: "acceptance" });
    expect(run2.status).toBe("executed");
    if (run2.status !== "executed") return;
    log = [...run2.postEvents];
    const world2 = projection.getSnapshot();
    expectReplayPure(log, world2.time, world2.eventNumber);
    rows.push(buildActionConversationTurn({
      worldId: LEGACY_WORLD_ID, correlationId: "cmd-turn-2", idempotencyKey: "accept-2",
      playerText: "Подхожу к ограде.", worldTimeBefore: world1.time, stagedEvents: [...run2.commandEvents, ...run2.tickEvents], projectedWorld: world2,
    }));

    // Ход 3: mixed — один primary, вопрос цел, второй action только deferred.
    const scene3 = buildMasterTurnSceneContext(log, projection.getSnapshot());
    const fence3 = scene3.context.visibleObjects.find((object) => object.label === "Ограда");
    if (!fence3) throw new Error("fence left the scene");
    const plan3 = validateTurnProposal({
      schemaVersion: 2,
      kind: "mixed",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подхожу к ограде" },
      supportingClauses: [{ kind: "deferred_action", summary: "осмотреть двор" }],
      target: { role: "target", observerRef: fence3.observerRef, surface: fence3.label },
      question: { queryId: "visible_scene", focus: { role: "topic", surface: "двор" } },
      referents: [{ role: "target", observerRef: fence3.observerRef, surface: fence3.label }],
    } as TurnProposalV2);
    expect(plan3.status).toBe("accepted");
    if (plan3.status !== "accepted") return;
    const checked3 = validateMasterTurnPlan({ proposal: plan3.proposal, scene: scene3, world: projection.getSnapshot(), rawText: "Подхожу к ограде и осматриваю двор, что я вижу?" });
    expect(checked3.status).toBe("accepted");
    if (checked3.status !== "accepted") return;
    const run3 = executeMasterTurnPlan(checked3.plan, scene3, { engine, projection, events: log, worldId: "acceptance" });
    expect(run3.status).toBe("executed");
    if (run3.status !== "executed") return;
    expect(run3.commandEvents.filter((item) => item.type === "InteractionRequested" || item.type === "ActionAttempted" || item.type === "JourneyRequested")).toHaveLength(1);
    expect(run3.inquiryAnswer?.queryId).toBe("visible_scene");
    expect(run3.inquiryAnswer?.answer).toContain("двор");
    expect(run3.deferred).toEqual([{ text: "осмотреть двор", reason: "secondary_action" }]);
    log = [...run3.postEvents];
    const world3 = projection.getSnapshot();
    expectReplayPure(log, world3.time, world3.eventNumber);
    const presentation3 = selectTurnPresentation([...run3.commandEvents, ...run3.tickEvents], world3);
    const response3 = composeMasterTurnResponse({
      kind: "mixed",
      actionPresentation: presentation3.response || presentation3.primary
        ? { text: presentation3.response?.text ?? presentation3.primary?.text ?? "", rejected: false }
        : null,
      inquiryAnswer: run3.inquiryAnswer ? { text: run3.inquiryAnswer.answer } : null,
      speechReaction: null,
      metaAnswer: null,
      deferredClauses: run3.deferred,
      clarification: null,
    });
    expect(response3.kind).toBe("mixed_outcome");
    expect(response3.text).toContain("осмотреть двор");
    rows.push(buildMixedConversationTurn({
      worldId: LEGACY_WORLD_ID, correlationId: "cmd-turn-3", idempotencyKey: "accept-3",
      playerText: "Подхожу к ограде и осматриваю двор, что я вижу?", worldTimeBefore: world2.time,
      preEvents: log.slice(0, log.length - run3.commandEvents.length - run3.tickEvents.length),
      stagedEvents: [...run3.commandEvents, ...run3.tickEvents], projectedWorld: world3,
      profile: null, characterProfile: null,
      inquiry: checked3.plan.postActionInquiry, deferred: run3.deferred,
    }));
    expect(rows[rows.length - 1]?.inputClass).toBe("mixed");

    // Ход 4: местоимение связывается, время стоит, скрытое не раскрывается.
    const timeBefore4 = projection.getSnapshot().time;
    const eventsBefore4 = projection.getSnapshot().eventNumber;
    const scene4 = buildMasterTurnSceneContext(log, projection.getSnapshot());
    const context4 = buildMasterConversationContext(
      rows.map((draft, index) => ({ ...draft, turnSeq: index + 1, createdAt: index + 1 })),
      LEGACY_WORLD_ID,
    );
    const [behind] = bindTurnPronouns("А что за ней?", context4, scene4.context);
    expect(behind?.preposition).toBe("за");
    expect(behind?.candidates[0]).toBe(fence3.observerRef);
    const shell4 = buildGameShellSnapshot(log, projection.getSnapshot(), null, "acceptance", undefined);
    const answer4 = buildInquiryAnswer(
      {
        type: "InquiryRequest", queryId: "visible_scene", rawText: "А что за ней?",
        confidence: 1, source: "deterministic",
        ...(behind?.candidates[0] ? { focus: { observerRef: behind.candidates[0], surface: "ограда" } } : {}),
        relation: "behind",
      },
      { shell: shell4, background: null },
    );
    expect(projection.getSnapshot().time).toBe(timeBefore4);
    expect(projection.getSnapshot().eventNumber).toBe(eventsBefore4);
    expect(answer4.answer).not.toContain("ларец");
    expect(answer4.answer).not.toContain("Ларец");
    rows.push(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID, idempotencyKey: "accept-4",
      playerText: "А что за ней?", inputClass: "inquiry", responseKind: "inquiry_answer",
      responseText: answer4.answer, worldTime: timeBefore4,
    }));

    // Ход 5: speech через обычную валидацию мира, без выдуманных реакций.
    const scene5 = buildMasterTurnSceneContext(log, projection.getSnapshot());
    const carrier = scene5.context.knownPeople.find((person) => person.label === "Перевозчик");
    if (!carrier) throw new Error("carrier left the scene");
    const context5 = buildMasterConversationContext(
      rows.map((draft, index) => ({ ...draft, turnSeq: index + 1, createdAt: index + 1 })),
      LEGACY_WORLD_ID,
    );
    const bindings5 = bindTurnPronouns("Спрошу у него об этом.", context5, scene5.context);
    const him = bindings5.find((binding) => binding.pronoun === "него");
    const about = bindings5.find((binding) => binding.pronoun === "этом");
    expect(him?.candidates[0]).toBe(carrier.observerRef);
    expect(about?.classes).toEqual(["topic"]);
    const plan5 = validateTurnProposal({
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "Спрошу у него об этом.", sourceText: "Спрошу у него об этом." },
      supportingClauses: [],
      addressedEntity: { role: "addressee", observerRef: carrier.observerRef, surface: carrier.label },
      referents: [{ role: "addressee", observerRef: carrier.observerRef, surface: carrier.label }],
    });
    expect(plan5.status).toBe("accepted");
    if (plan5.status !== "accepted") return;
    const checked5 = validateMasterTurnPlan({ proposal: plan5.proposal, scene: scene5, world: projection.getSnapshot(), rawText: "Спрошу у него об этом." });
    expect(checked5.status).toBe("accepted");
    if (checked5.status !== "accepted") return;
    const run5 = executeMasterTurnPlan(checked5.plan, scene5, { engine, projection, events: log, worldId: "acceptance" });
    expect(run5.status).toBe("executed");
    if (run5.status !== "executed") return;
    log = [...run5.postEvents];
    const world5 = projection.getSnapshot();
    expectReplayPure(log, world5.time, world5.eventNumber);
    const presentation5 = selectTurnPresentation([...run5.commandEvents, ...run5.tickEvents], world5);
    const reactionText = presentation5.response?.text ?? presentation5.primary?.text ?? "";
    const response5 = composeMasterTurnResponse({
      kind: "speech",
      actionPresentation: null,
      inquiryAnswer: null,
      speechReaction: reactionText ? { text: reactionText } : null,
      metaAnswer: null,
      deferredClauses: [],
      clarification: null,
    });
    expect(response5.kind === "speech_reaction" || response5.kind === "clarification").toBe(true);
    expect(response5.text).not.toContain("object_");
    expect(response5.text).not.toContain("person_");
    rows.push({
      worldId: LEGACY_WORLD_ID, correlationId: "cmd-turn-5", idempotencyKey: "accept-5",
      requestHash: "accept-5",
      playerText: "Спрошу у него об этом.", inputClass: "speech",
      worldTimeBefore: world3.time, worldTimeAfter: world5.time,
      responseKind: response5.kind === "speech_reaction" ? "speech_reaction" : "clarification",
      responseText: response5.text,
    });

    // Reload: ходы 4–5 работают так же.
    const db = join(mkdtempSync(join(tmpdir(), "skald-acceptance-")), "events.sqlite");
    const store = createMultiWorldStore(db);
    for (const draft of rows) store.recordConversationTurn(draft);
    store.close();
    const reopened = createMultiWorldStore(db);
    const reloaded = reopened.listConversationTurns(LEGACY_WORLD_ID);
    reopened.close();
    expect(reloaded).toHaveLength(5);
    const reloadedContext = buildMasterConversationContext(reloaded, LEGACY_WORLD_ID);
    const sceneReloaded = buildMasterTurnSceneContext(log, projection.getSnapshot());
    const [behindReloaded] = bindTurnPronouns("А что за ней?", reloadedContext, sceneReloaded.context);
    expect(behindReloaded?.candidates[0]).toBe(fence3.observerRef);
    const reloaded5 = bindTurnPronouns("Спрошу у него об этом.", reloadedContext, sceneReloaded.context);
    expect(reloaded5.find((binding) => binding.pronoun === "него")?.candidates[0]).toBe(carrier.observerRef);
  });
});
