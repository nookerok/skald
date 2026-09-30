import { describe, expect, it } from "vitest";
import type { ProposedQuestionPlan } from "@skald/intent-parser";
import type { MasterTurnSceneContext } from "@skald/world";
import type { MasterConversationContext } from "../src/conversation/context-builder.js";
import { resolveQuestionPlanBindings } from "../src/runtime/question-plan-resolver.js";

function scene(overrides?: Partial<MasterTurnSceneContext>): MasterTurnSceneContext {
  return {
    schemaVersion: 1,
    revision: { worldTime: 1, eventNumber: 4 },
    currentLocation: { name: "Переправа у Чёрного леса", description: "Ты стоишь у воды." },
    visibleObjects: [{ observerRef: "object_1", kind: "object", label: "Обломок знака", knownAs: [], known: true }],
    knownPeople: [
      { observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: [], known: true },
      { observerRef: "person_2", kind: "person", label: "Ночная торговка", knownAs: ["торговка"], known: false },
    ],
    knownRoutes: [],
    accessibleItems: [],
    availableActions: [],
    currentSituation: null,
    knownTopics: [{ observerRef: "topic_1", category: "told", text: "Ночной поток вынес след знака", status: "current" }],
    ...overrides,
  };
}

function conversation(overrides?: Partial<MasterConversationContext>): MasterConversationContext {
  return {
    recentTurns: [],
    recentFocus: [],
    pendingClarification: null,
    schemaVersion: 1,
    lastTurns: [],
    currentScene: null,
    recentlyMentionedEntities: [],
    activePlayerGoal: null,
    currentDramaticThread: null,
    knownFacts: [],
    knownUncertainties: [],
    truncated: false,
    rememberedLists: [],
    rememberedGroups: [],
    ...overrides,
  };
}

function plan(subjects: ProposedQuestionPlan["subjects"]): ProposedQuestionPlan {
  return {
    subjects,
    parts: [
      { id: "p1", subjectRefs: [subjects[0]!.id], aspect: "current_activity", time: "current", purpose: "describe" },
    ],
  };
}

describe("resolveQuestionPlanBindings", () => {
  it("settles self and deictic place subjects without any ref", () => {
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "me", surface: "я", kind: "self" },
      { id: "here", surface: "здесь", kind: "place" },
    ]), scene(), conversation());
    expect(outcome.status).toBe("resolved");
    if (outcome.status !== "resolved") return;
    expect(outcome.bindings).toHaveLength(2);
    expect(outcome.bindings.every((binding) => binding.resolution === "resolved" && binding.resolvedRef === null)).toBe(true);
    expect(Object.isFrozen(outcome.bindings)).toBe(true);
  });

  it("keeps a named other place honestly absent", () => {
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "tower", surface: "Каменная башня", kind: "place" },
    ]), scene(), conversation());
    expect(outcome.status === "resolved" && outcome.bindings[0]!.resolution).toBe("absent");
  });

  it("trusts a declared observerRef only after a scene check", () => {
    const good = resolveQuestionPlanBindings(plan([
      { id: "ferry", surface: "перевозчик", kind: "entity", observerRef: "person_1" },
    ]), scene(), conversation());
    expect(good).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: "person_1" }] });

    // A hallucinated ref falls back to the surface, never into a binding.
    const hallucinated = resolveQuestionPlanBindings(plan([
      { id: "ferry", surface: "перевозчик", kind: "entity", observerRef: "person_9" },
    ]), scene(), conversation());
    expect(hallucinated).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: "person_1" }] });
  });

  it("resolves a unique scene label and an alias", () => {
    const byLabel = resolveQuestionPlanBindings(plan([
      { id: "ferry", surface: "перевозчик", kind: "entity" },
    ]), scene(), conversation());
    expect(byLabel).toMatchObject({ status: "resolved", bindings: [{ resolvedRef: "person_1" }] });

    const byAlias = resolveQuestionPlanBindings(plan([
      { id: "trader", surface: "торговка", kind: "entity" },
    ]), scene(), conversation());
    expect(byAlias).toMatchObject({ status: "resolved", bindings: [{ resolvedRef: "person_2" }] });
  });

  it("asks the player when a surface matches several scene referents", () => {
    const duplicated = scene({
      knownPeople: [
        { observerRef: "person_1", kind: "person", label: "Сторож", knownAs: [], known: true },
        { observerRef: "person_3", kind: "person", label: "Старый сторож", knownAs: [], known: false },
      ],
    });
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "guard", surface: "сторож", kind: "entity" },
    ]), duplicated, conversation());
    expect(outcome.status).toBe("clarification");
    if (outcome.status !== "clarification") return;
    expect(outcome.question.length).toBeGreaterThan(0);
    expect(outcome.options.some((option) => option.referentRefs?.includes("person_1"))).toBe(true);
    expect(outcome.options.some((option) => option.referentRefs?.includes("person_3"))).toBe(true);
  });

  it("keeps an unknown concrete subject as honest absence, not a guess", () => {
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "whale", surface: "кит", kind: "entity" },
    ]), scene(), conversation());
    expect(outcome).toMatchObject({ status: "resolved", bindings: [{ resolution: "absent", resolvedRef: null }] });
  });

  it("routes a pronoun through the focus stack: settled alone, asked when several", () => {
    const alone = scene({
      visibleObjects: [],
      knownPeople: [{ observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: [], known: true }],
    });
    const settled = resolveQuestionPlanBindings(plan([
      { id: "who", surface: "он", kind: "entity" },
    ]), alone, conversation());
    expect(settled).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: "person_1" }] });

    const ambiguous = resolveQuestionPlanBindings(plan([
      { id: "who", surface: "он", kind: "entity" },
    ]), scene(), conversation());
    expect(ambiguous.status).toBe("clarification");
    if (ambiguous.status !== "clarification") return;
    expect(ambiguous.options.filter((option) => option.referentRefs).length).toBeGreaterThanOrEqual(2);
  });

  it("validates every group member and rejects a partial group", () => {
    const complete = resolveQuestionPlanBindings(plan([
      { id: "crew", surface: "они", kind: "group", members: ["person_1", "person_2"] },
    ]), scene(), conversation());
    expect(complete).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved" }] });

    const partial = resolveQuestionPlanBindings(plan([
      { id: "crew", surface: "они", kind: "group", members: ["person_1", "person_9"] },
    ]), scene(), conversation());
    expect(partial).toMatchObject({ status: "resolved", bindings: [{ resolution: "absent" }] });
  });

  it("keeps ordinals absent when no shown list was ever recorded (T5)", () => {
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "first", surface: "первый перевозчик", kind: "ordinal", listRef: "scene_people", position: 1 },
    ]), scene(), conversation());
    expect(outcome).toMatchObject({ status: "resolved", bindings: [{ resolution: "absent" }] });
  });

  it("resolves an ordinal against the STORED list, not the scene order (T5)", () => {
    const memory = conversation({
      rememberedLists: [{ listRef: "scene_people", members: ["Ночная торговка", "Перевозчик"] }],
    });
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "second", surface: "второй", kind: "ordinal", listRef: "scene_people", position: 2 },
    ]), scene(), memory);
    expect(outcome).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: "person_1" }] });

    // The scene re-orders: the stored position still points at the stored member.
    const reordered = scene({
      knownPeople: [
        { observerRef: "person_2", kind: "person", label: "Ночная торговка", knownAs: ["торговка"], known: false },
        { observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: [], known: true },
      ],
    });
    const stable = resolveQuestionPlanBindings(plan([
      { id: "second", surface: "второй", kind: "ordinal", listRef: "scene_people", position: 2 },
    ]), reordered, memory);
    expect(stable).toMatchObject({ status: "resolved", bindings: [{ resolvedRef: "person_1" }] });
  });

  it("keeps a gone ordinal member speakable as memory, never a clarification (T5)", () => {
    const memory = conversation({
      rememberedLists: [{ listRef: "scene_people", members: ["Перевозчик"] }],
    });
    const gone = scene({ knownPeople: [] });
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "first", surface: "первый", kind: "ordinal", listRef: "scene_people", position: 1 },
    ]), gone, memory);
    expect(outcome).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: null }] });
  });

  it("never guesses a duplicate identity from legacy labels (T5)", () => {
    const memory = conversation({
      rememberedLists: [{ listRef: "scene_people", members: ["Перевозчик", "Перевозчик"] }],
    });
    const duplicated = scene({
      knownPeople: [
        { observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: [], known: true },
        { observerRef: "person_3", kind: "person", label: "Перевозчик", knownAs: [], known: false },
      ],
    });
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "second", surface: "второй", kind: "ordinal", listRef: "scene_people", position: 2 },
    ]), duplicated, memory);
    expect(outcome.status).toBe("clarification");

    // A single shown occurrence facing a grown scene of duplicates is
    // genuinely ambiguous — ask, never guess which is which.
    const single = conversation({
      rememberedLists: [{ listRef: "scene_people", members: ["Перевозчик"] }],
    });
    const ambiguous = resolveQuestionPlanBindings(plan([
      { id: "first", surface: "первый", kind: "ordinal", listRef: "scene_people", position: 1 },
    ]), duplicated, single);
    expect(ambiguous.status).toBe("clarification");
  });

  it("keeps a shown-but-gone subject speakable as memory (T5)", () => {
    const memory = conversation({
      recentlyMentionedEntities: [{ kind: "person", role: "topic", label: "Мельник", turnSeq: 1 }],
    });
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "miller", surface: "мельник", kind: "entity" },
    ]), scene(), memory);
    expect(outcome).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: null }] });

    // A genuinely unknown subject stays honestly absent — memory never guesses.
    const unknown = resolveQuestionPlanBindings(plan([
      { id: "whale", surface: "кит", kind: "entity" },
    ]), scene(), memory);
    expect(unknown).toMatchObject({ status: "resolved", bindings: [{ resolution: "absent", resolvedRef: null }] });
  });

  it("falls back to remembered group member links when handles go stale (T5)", () => {
    const memory = conversation({
      rememberedGroups: [{ label: "Эти люди у берега", members: ["Перевозчик", "Ночная торговка"] }],
    });
    // Stale model handles: stored labels are re-checked against the scene.
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "crew", surface: "они", kind: "group", members: ["person_9"] },
    ]), scene(), memory);
    expect(outcome).toMatchObject({
      status: "resolved",
      bindings: [{ resolution: "resolved", resolvedMembers: ["person_1", "person_2"] }],
    });

    // A gone member is null, never guessed; the group stays speakable.
    const partial = resolveQuestionPlanBindings(plan([
      { id: "crew", surface: "они", kind: "group", members: ["person_9"] },
    ]), scene({ knownPeople: [scene().knownPeople[0]!] }), memory);
    expect(partial).toMatchObject({
      status: "resolved",
      bindings: [{ resolution: "resolved", resolvedMembers: ["person_1", null] }],
    });

    // Nobody left: remembered group stays speakable, no clarification.
    const empty = resolveQuestionPlanBindings(plan([
      { id: "crew", surface: "они", kind: "group", members: ["person_9"] },
    ]), scene({ knownPeople: [] }), memory);
    expect(empty).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: null, resolvedMembers: [null, null] }] });
  });

  it("resolves topics by declared ref or scene text, else memory", () => {
    const byRef = resolveQuestionPlanBindings(plan([
      { id: "sign", surface: "знак", kind: "topic", observerRef: "topic_1" },
    ]), scene(), conversation());
    expect(byRef).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: "topic_1" }] });

    // T6 acceptance, series 6: an unresolvable topic stays speakable as a
    // memory (resolved without a handle) instead of vanishing — conversation
    // topics live in the transcript and testimony, which answer by surface,
    // while scene sources gap honestly.
    const memory = resolveQuestionPlanBindings(plan([
      { id: "whale", surface: "кит", kind: "topic" },
    ]), scene(), conversation());
    expect(memory).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: null }] });
  });

  it("returns the FIRST ambiguous subject and keeps plan order otherwise", () => {
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "me", surface: "я", kind: "self" },
      { id: "who", surface: "он", kind: "entity" },
      { id: "here", surface: "здесь", kind: "place" },
    ]), scene(), conversation());
    expect(outcome.status).toBe("clarification");

    const ordered = resolveQuestionPlanBindings(plan([
      { id: "here", surface: "здесь", kind: "place" },
      { id: "ferry", surface: "перевозчик", kind: "entity" },
    ]), scene(), conversation());
    expect(ordered.status === "resolved" && ordered.bindings.map((binding) => binding.subject.id)).toEqual(["here", "ferry"]);
  });
});


it("keeps duplicate identity after handle reuse and treats disappearance as memory", () => {
  const memory = conversation({ rememberedLists: [{ listRef: "scene_people", members: ["Перевозчик", "Перевозчик"], memberIdentities: [
    { kind: "person", internalId: "ferry-a" }, { kind: "person", internalId: "ferry-b" },
  ] }] });
  const proposal = plan([{ id: "second", surface: "второй", kind: "ordinal", listRef: "scene_people", position: 2 }]);
  const duplicated = scene({ knownPeople: [1, 2].map((n) => ({ observerRef: `person_${n}`, kind: "person", label: "Перевозчик", knownAs: [] })) });
  const refs = new Map([
    ["person_1", { kind: "person" as const, internalId: "ferry-b", label: "Перевозчик" }],
    ["person_2", { kind: "person" as const, internalId: "ferry-a", label: "Перевозчик" }],
  ]);
  expect(resolveQuestionPlanBindings(proposal, duplicated, memory, refs)).toMatchObject({ bindings: [{ resolvedRef: "person_1" }] });
  refs.delete("person_1");
  expect(resolveQuestionPlanBindings(proposal, duplicated, memory, refs)).toMatchObject({ bindings: [{ resolution: "resolved", resolvedRef: null }] });
});

it("rechecks remembered group identities before accepting reused handles", () => {
  const memory = conversation({ rememberedGroups: [{ label: "люди", members: ["Перевозчик"], memberIdentities: [{ kind: "person", internalId: "old-person" }] }] });
  const proposal = plan([{ id: "group", surface: "они", kind: "group", members: ["person_1"] }]);
  const refs = new Map([["person_1", { kind: "person" as const, internalId: "new-person", label: "Перевозчик" }]]);
  expect(resolveQuestionPlanBindings(proposal, scene(), memory, refs)).toMatchObject({ bindings: [{ resolution: "resolved", resolvedMembers: [null] }] });
});


it("does not let a model ref override a gone pronoun subject", () => {
  const remembered = conversation({ recentFocus: [{ kind: "topic", surface: "Перевозчик", turnSeq: 1, identity: { kind: "person", internalId: "gone" } }] });
  const proposal = plan([{ id: "he", surface: "он", kind: "entity", observerRef: "person_1" }]);
  const refs = new Map([["person_1", { kind: "person" as const, internalId: "other", label: "Перевозчик" }]]);
  expect(resolveQuestionPlanBindings(proposal, scene(), remembered, refs)).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: null }] });
});
