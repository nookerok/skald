import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  buildNarrativeAdapterContext,
  createRules,
  getRegionEntrypoint,
  handleCommand,
  rebuildProjection,
} from "@skald/world";
import type { InteractionCommand, TurnProposalV2 } from "@skald/intent-parser";
import { bindSceneSurface, splitTargetCompound, validateMasterTurnPlan } from "../src/runtime/master-turn-validator.js";

function livingWorld() {
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
  const scene = buildMasterTurnSceneContext(events, world, narrativeContext);
  return { events, world, scene };
}

function campBootstrap(): DomainEvent[] {
  return [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь.",
      objectIds: ["pouch", "torch"], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    campObject("pouch", "сумка", { open: true, portable: true, containerCapacityMass: 5 }, { mass: 1, portable: true, containerCapacity: 5 }),
    campObject("torch", "факел", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
  ];
}

/** Camp scene with the torch placed: declared, visible and resolver-mapped. */
function campWithPlacedTorch() {
  const projection = new WorldProjector();
  const events: DomainEvent[] = [...campBootstrap()];
  for (const bootstrap of events) projection.apply(bootstrap);
  const world = projection.getSnapshot();
  const scene = buildMasterTurnSceneContext(events, world);
  const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
  if (!torch) throw new Error("placed torch is not visible in the camp scene");
  return {
    events,
    world,
    scene,
    target: { role: "target" as const, observerRef: torch.observerRef, surface: torch.label },
  };
}

function actionProposal(
  target: { readonly role: "target"; readonly observerRef: string; readonly surface: string },
  extra: Record<string, unknown> = {},
): TurnProposalV2 {
  return {
    schemaVersion: 2,
    kind: "action",
    primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
    supportingClauses: [],
    target: { ...target },
    referents: [{ ...target }],
    ...extra,
  } as TurnProposalV2;
}

describe("master turn contextual validation", () => {
  it("carries the goal and conversation relation onto the accepted plan", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: actionProposal(target, { goal: "Осмотреть весь лагерь", conversationRelation: "continuation" }),
      scene,
      world,
      rawText: "Осматриваю факел, чтобы осмотреть весь лагерь.",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.goal).toBe("Осмотреть весь лагерь");
    expect(result.plan.conversationRelation).toBe("continuation");
    expect(result.plan.focus).toEqual(
      expect.arrayContaining([expect.objectContaining({ surface: "факел" })]),
    );
  });

  it("leaves goal and relation null when the model states none", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: actionProposal(target),
      scene,
      world,
      rawText: "Осматриваю факел.",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.goal).toBeNull();
    expect(result.plan.conversationRelation).toBeNull();
  });

  it("maps a declared target to a transient command with revision", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: actionProposal(target, { manner: "внимательно", goal: "разглядеть детали" }),
      scene,
      world,
      rawText: "осматриваю факел внимательно",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.kind).toBe("action");
    expect(result.plan.contextRevision).toEqual({ worldTime: world.time, eventNumber: world.eventNumber });
    expect(result.plan.execution?.intent).toMatchObject({
      type: "InteractionCommand",
      verb: "observe",
      target: { raw: target.surface },
      manner: "внимательно",
      goal: "разглядеть детали",
    });
    expect(result.plan.execution?.intent.interpretation.source).toBe("llm");
    expect(result.plan.postActionInquiries).toEqual([]);
    expect(result.plan.metaInquiry).toBeNull();
    expect(result.plan.focus).toContainEqual({ observerRef: target.observerRef, surface: target.surface, kind: "target" });
  });

  it("clarifies unknown observer refs without events", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: actionProposal({ ...target, observerRef: "object_99" }),
      scene,
      world,
      rawText: "осматриваю",
    });

    expect(result.status).toBe("clarification");
  });

  it("clarifies surface mismatches without events", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: actionProposal({ ...target, surface: "Выдуманная башня" }),
      scene,
      world,
      rawText: "осматриваю",
    });

    expect(result.status).toBe("clarification");
  });

  it("clarifies resolver-missing surfaces as stale", () => {
    const { world, scene } = livingWorld();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
        supportingClauses: [],
        target: { role: "target", surface: "выдуманная штуковина" },
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю выдуманную штуковину",
    });

    expect(result.status).toBe("clarification");
  });

  it("clarifies duplicated names with resolver candidates", () => {
    const baseline = livingWorld();
    const stones = [1, 2].map((index) => ({
      eventId: `twin-stone-${index}`,
      type: "WorldObjectPlaced",
      schemaVersion: 1,
      payload: {
        id: `twin-stone-${index}`,
        name: "Тестовый камень",
        aliases: ["камень"],
        description: "Обычный камень.",
        material: "stone",
        locationId: baseline.world.currentLocationId,
        integrity: 100,
        temperature: 20,
        state: {},
      },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    }) as DomainEvent);
    const events = [...baseline.events, ...stones];
    const world = rebuildProjection(events).getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
        supportingClauses: [],
        target: { role: "target", surface: "Тестовый камень" },
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю тестовый камень",
    });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.options.length).toBeGreaterThanOrEqual(2);
  });

  it("turns proposal ambiguity into clarification, never a confident plan", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: {
        ...actionProposal(target),
        ambiguity: { kind: "referent", question: "Кого ты имеешь в виду?", candidates: ["первый", "второй"] },
      },
      scene,
      world,
      rawText: "осматриваю",
    });

    expect(result).toMatchObject({
      status: "clarification",
      question: "Кого ты имеешь в виду?",
      options: [
        { optionId: "option-1", label: "первый" },
        { optionId: "option-2", label: "второй" },
      ],
    });
  });

  it("keeps one primary action with a post-action question and deferred clause", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "подхожу" },
        supportingClauses: [{ kind: "deferred_action", summary: "осмотреть лагерь" }],
        target: { ...target },
        question: { queryId: "visible_scene" },
        referents: [{ ...target }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "подхожу и смотрю",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.execution?.intent).toMatchObject({ type: "ActionIntentCommand", operation: "approach" });
    expect(result.plan.postActionInquiries.map((entry) => entry.queryId)).toEqual(["visible_scene"]);
    expect(result.plan.deferredClauses).toEqual([{ text: "осмотреть лагерь", reason: "secondary_action" }]);
  });

  it("answers pure inquiry without execution", () => {
    const { world, scene } = livingWorld();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "inquiry",
        primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: "что я вижу" },
        supportingClauses: [],
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "что я вижу?",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.execution).toBeNull();
    expect(result.plan.postActionInquiries.map((entry) => entry.queryId)).toEqual(["visible_scene"]);
  });

  it("validates every supporting question of a mixed turn (plan_9 §1)", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
        question: { queryId: "available_routes" },
        supportingClauses: [
          { kind: "question", queryId: "visible_scene" },
          { kind: "question", queryId: "environmental_indication", focus: { surface: "факел", role: "target" } },
        ],
        target: { ...target },
        referents: [{ ...target }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю факел, куда идти и что вокруг?",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.postActionInquiries.map((entry) => entry.queryId)).toEqual([
      "available_routes",
      "visible_scene",
      "environmental_indication",
    ]);
  });

  it("clarifies the one bad question without sinking the rest (plan_9 §1)", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
        question: { queryId: "available_routes" },
        supportingClauses: [
          { kind: "question", queryId: "visible_scene", focus: { observerRef: "object_99", surface: "Невидимая башня", role: "target" } },
        ],
        target: { ...target },
        referents: [{ ...target }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю факел, куда идти и что за башней?",
    });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toContain("Невидимая башня");
  });

  it("maps speech with a known addressee to the communicate pipeline", () => {
    const { world, scene } = livingWorld();
    const person = scene.context.knownPeople[0];
    if (!person) throw new Error("living-region scene has no known people");
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "speech",
        primaryIntent: { kind: "speech", utterance: "Помоги мне", sourceText: "прошу о помощи" },
        supportingClauses: [],
        addressedEntity: { role: "addressee", observerRef: person.observerRef, surface: person.label },
        referents: [{ role: "addressee", observerRef: person.observerRef, surface: person.label }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "прошу о помощи",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.execution?.intent).toMatchObject({
      type: "ActionIntentCommand",
      mode: "communicate",
      operation: "speak",
      utterance: "Помоги мне",
    });
    expect(result.plan.focus).toContainEqual({ observerRef: person.observerRef, surface: person.label, kind: "addressee" });
  });

  it("rejects a non-person addressee", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "speech",
        primaryIntent: { kind: "speech", utterance: "Привет", sourceText: "здороваюсь" },
        supportingClauses: [],
        addressedEntity: { ...target, role: "addressee" },
        referents: [{ ...target, role: "addressee" }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "здороваюсь",
    });

    expect(result.status).toBe("clarification");
  });

  it("answers meta from the closed registry without execution", () => {
    const { world, scene } = livingWorld();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "meta",
        primaryIntent: { kind: "meta", operation: "explain_available_actions", sourceText: "что я могу делать" },
        supportingClauses: [],
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "что я могу делать?",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.execution).toBeNull();
    expect(result.plan.metaInquiry).toEqual({ type: "MetaRequest", operation: "explain_available_actions" });
  });

  it("rejects a journey destination that is not a known route", () => {
    const { world, scene, target } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: {
          kind: "journey",
          destination: { role: "destination", observerRef: target.observerRef, surface: target.surface },
          sourceText: "иду",
        },
        supportingClauses: [],
        referents: [{ role: "destination", observerRef: target.observerRef, surface: target.surface }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "иду",
    });

    expect(result.status).toBe("clarification");
  });

  it("rejects a null primary without ambiguity", () => {
    const { world, scene } = livingWorld();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: null,
        supportingClauses: [],
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "делаю",
    });

    expect(result.status).toBe("invalid");
  });
});

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function campObject(id: string, name: string, state: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): DomainEvent {
  return campEvent("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [name], description: name, material: "wood",
    locationId: "camp", integrity: 100, temperature: 20, state, ...metadata,
  }, 0);
}

describe("stale world revalidation", () => {
  it("blocks an item that became inaccessible after the scene snapshot", () => {
    const projection = new WorldProjector();
    const bus = new EventBus();
    const events: DomainEvent[] = [
      campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
      campEvent("LocationDefined", "boot-location", {
        id: "camp", name: "Лагерь", description: "Тихий лагерь.",
        objectIds: ["pouch", "torch"], connections: {},
      }, 0),
      campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
      campObject("pouch", "сумка", { open: true, portable: true, containerCapacityMass: 5 }, { mass: 1, portable: true, containerCapacity: 5 }),
      campObject("torch", "факел", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
    ];
    for (const bootstrap of events) {
      projection.apply(bootstrap);
      bus.append(bootstrap);
    }
    const engine = new RuleEngine(createRules(), projection, bus);
    const take: InteractionCommand = {
      type: "InteractionCommand", verb: "take", target: { raw: "факел" }, rawText: "take факел",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    events.push(...engine.process(handleCommand(take, "take-torch", 1)).committed);
    events.push(...engine.process(campEvent("InteractionValidated", "place-torch", {
      law: "containment", verb: "place", entityId: "torch", secondaryTarget: "сумка",
    }, 2)).committed);

    const scene = buildMasterTurnSceneContext(events, projection.getSnapshot());
    const torch = scene.context.accessibleItems.find((item) => item.label === "факел");
    if (!torch) throw new Error("torch is not accessible in the open-container scene");
    const proposal = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "take", sourceText: "беру факел" },
      supportingClauses: [],
      target: { role: "target", observerRef: torch.observerRef, surface: torch.label },
      referents: [{ role: "target", observerRef: torch.observerRef, surface: torch.label }],
    } as TurnProposalV2;

    const closed = campEvent("ContainerClosed", "close-pouch", { containerId: "pouch", subjectId: "player" }, 3);
    projection.apply(closed);
    const staleWorld = projection.getSnapshot();
    const result = validateMasterTurnPlan({ proposal, scene, world: staleWorld, rawText: "беру факел" });

    expect(result.status).toBe("clarification");
  });

  it("rejects using an item without registered affordances", () => {
    const projection = new WorldProjector();
    const bus = new EventBus();
    const events: DomainEvent[] = [
      campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
      campEvent("LocationDefined", "boot-location", {
        id: "camp", name: "Лагерь", description: "Тихий лагерь.",
        objectIds: ["pebble"], connections: {},
      }, 0),
      campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
      campObject("pebble", "камень", { portable: true }, { mass: 2, portable: true }),
    ];
    for (const bootstrap of events) {
      projection.apply(bootstrap);
      bus.append(bootstrap);
    }
    const engine = new RuleEngine(createRules(), projection, bus);
    const take: InteractionCommand = {
      type: "InteractionCommand", verb: "take", target: { raw: "камень" }, rawText: "take камень",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    events.push(...engine.process(handleCommand(take, "take-pebble", 1)).committed);

    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const pebble = scene.context.visibleObjects.find((object) => object.label === "камень");
    if (!pebble) throw new Error("carried pebble is not visible in the scene");
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "use", sourceText: "использую камень" },
        supportingClauses: [],
        target: { role: "target", observerRef: pebble.observerRef, surface: pebble.label },
        referents: [{ role: "target", observerRef: pebble.observerRef, surface: pebble.label }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "использую камень",
    });

    expect(result.status).toBe("clarification");
  });
});

describe("surface-only model referents (review P1)", () => {
  function surfaceProposal(surface: string): TurnProposalV2 {
    const target = { role: "target" as const, observerRef: "", surface };
    return {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
      supportingClauses: [],
      target: { ...target },
      referents: [{ ...target }],
    } as TurnProposalV2;
  }

  it("splits a compound target into a conflicting-actions clarification", () => {
    const { world, scene } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: surfaceProposal("мокрый настил у самой воды и ищу следы"),
      scene,
      world,
      rawText: "Осматриваю мокрый настил у самой воды и ищу следы.",
    });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.question).toBe("Что именно ты хочешь сделать — мокрый настил у самой воды или ищу следы?");
    expect(result.options.map((option) => option.label)).toEqual([
      "мокрый настил у самой воды",
      "ищу следы",
    ]);
  });

  it("binds a declined surface-only target exact-first", () => {
    const { world, scene } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: surfaceProposal("факелом"),
      scene,
      world,
      rawText: "Осматриваю факелом.",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.execution?.intent).toMatchObject({
      type: "InteractionCommand",
      target: { raw: "факел" },
    });
  });

  it("binds a declined multi-word surface by contiguous phrase", () => {
    const { world, scene } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: surfaceProposal("к Ночному факелу"),
      scene,
      world,
      rawText: "Подхожу к Ночному факелу.",
    });

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.plan.execution?.intent).toMatchObject({
      type: "InteractionCommand",
      target: { raw: "факел" },
    });
  });

  it("never invents a target for an unknown surface", () => {
    const { world, scene } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: surfaceProposal("дракон"),
      scene,
      world,
      rawText: "Осматриваю дракона.",
    });

    expect(result.status).toBe("clarification");
  });

  it("attaches the structured candidate to model-reported ambiguity (review P1)", () => {
    const { world, scene } = campWithPlacedTorch();
    const result = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваю её." },
        supportingClauses: [],
        target: { role: "target", surface: "ней" },
        referents: [{ role: "target", surface: "ней" }],
        ambiguity: { kind: "referent", question: "К ограде или ко двору?", candidates: ["Ограда", "Двор"] },
      } as TurnProposalV2,
      scene,
      world,
      rawText: "Подойду к ней.",
    });

    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(result.options.map((option) => option.optionId)).toEqual(["option-1", "option-2"]);
    expect(result.framed).toMatchObject({ slot: "target", revision: scene.context.revision });
  });
});

describe("bindSceneSurface", () => {
  const entries = [
    { observerRef: "object_1", label: "Ограда", knownAs: ["ограду", "оградой"] },
    { observerRef: "object_2", label: "Двор", knownAs: [] as string[] },
  ];

  it("binds exact labels and aliases first", () => {
    expect(bindSceneSurface("Ограда", entries)).toMatchObject({ status: "unique", entry: { observerRef: "object_1" } });
    expect(bindSceneSurface("оградой!", entries)).toMatchObject({ status: "unique", entry: { observerRef: "object_1" } });
  });

  it("binds a contiguous stem phrase over bag overlap", () => {
    const people = [
      { observerRef: "person_1", label: "Перевозчик у переправы", knownAs: [] as string[] },
      { observerRef: "person_2", label: "Ночной перевозчик", knownAs: [] as string[] },
    ];
    expect(
      bindSceneSurface("К Ночному перевозчику. Спрошу именно его.", people),
    ).toMatchObject({ status: "unique", entry: { observerRef: "person_2" } });
  });

  it("stays ambiguous on a tied stem and absent without overlap", () => {
    const twins = [
      { observerRef: "person_1", label: "Ночной перевозчик", knownAs: [] as string[] },
      { observerRef: "person_2", label: "Дневной перевозчик", knownAs: [] as string[] },
    ];
    const tied = bindSceneSurface("перевозчик", twins);
    expect(tied.status).toBe("ambiguous");
    if (tied.status !== "ambiguous") return;
    expect([...tied.labels].sort()).toEqual(["Дневной перевозчик", "Ночной перевозчик"]);
    expect(bindSceneSurface("дракон", entries)).toEqual({ status: "absent" });
    expect(bindSceneSurface("", entries)).toEqual({ status: "absent" });
  });
});

describe("splitTargetCompound", () => {
  it("splits a second action clause off the head", () => {
    expect(splitTargetCompound("мокрый настил у самой воды и ищу следы")).toEqual({
      head: "мокрый настил у самой воды",
      tail: "ищу следы",
    });
  });

  it("returns null for a single clause", () => {
    expect(splitTargetCompound("факел")).toBeNull();
    expect(splitTargetCompound("")).toBeNull();
    expect(splitTargetCompound("именно его, что случилось с переправой?")).toBeNull();
  });
});
