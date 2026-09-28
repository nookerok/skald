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

  it("keeps ordinals absent until the listRef vocabulary closes (T5)", () => {
    const outcome = resolveQuestionPlanBindings(plan([
      { id: "first", surface: "первый перевозчик", kind: "ordinal", listRef: "people", position: 1 },
    ]), scene(), conversation());
    expect(outcome).toMatchObject({ status: "resolved", bindings: [{ resolution: "absent" }] });
  });

  it("resolves topics by declared ref or scene text, else absent", () => {
    const byRef = resolveQuestionPlanBindings(plan([
      { id: "sign", surface: "знак", kind: "topic", observerRef: "topic_1" },
    ]), scene(), conversation());
    expect(byRef).toMatchObject({ status: "resolved", bindings: [{ resolution: "resolved", resolvedRef: "topic_1" }] });

    const absent = resolveQuestionPlanBindings(plan([
      { id: "whale", surface: "кит", kind: "topic" },
    ]), scene(), conversation());
    expect(absent).toMatchObject({ status: "resolved", bindings: [{ resolution: "absent" }] });
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
