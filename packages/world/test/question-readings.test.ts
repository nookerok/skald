import { describe, expect, it } from "vitest";
import type { ProposedQuestionPlan, SubjectBinding } from "@skald/intent-parser";
import {
  coveredPartsOf,
  executeQuestionReading,
  type QuestionReadingContext,
  type QuestionReadingResult,
  type ReadingTranscriptEntry,
} from "@skald/world";
import type { MasterTurnSceneSnapshot } from "@skald/world";
import type { NarrativeAdapterContext, NarrativeFact } from "@skald/world";

function narrativeFact(id: string, text: string, epistemicClass: NarrativeFact["epistemicClass"]): NarrativeFact {
  return { id, text, epistemicClass, source: "knowledge", usableNow: true };
}

function scene(overrides?: Partial<MasterTurnSceneSnapshot["context"]>): MasterTurnSceneSnapshot {
  return {
    context: {
      schemaVersion: 1,
      revision: { worldTime: 1, eventNumber: 4 },
      currentLocation: { name: "Переправа у Чёрного леса", description: "Ты стоишь у воды." },
      visibleObjects: [],
      knownPeople: [
        {
          observerRef: "person_1",
          kind: "person",
          label: "Перевозчик",
          knownAs: ["Перевозчик"],
          known: true,
          portrait: {
            visibleAppearance: ["Потёртый плащ", "Седина у висков"],
            distinguishingFeatures: ["Старые заплаты на рукавах"],
            publicRole: "Перевозчик",
            addressForms: ["Перевозчик"],
          },
        },
        {
          observerRef: "person_2",
          kind: "person",
          label: "Незнакомец",
          knownAs: [],
          known: false,
          portrait: {
            visibleAppearance: ["Капюшон"],
            distinguishingFeatures: [],
            publicRole: null,
            addressForms: [],
          },
        },
      ],
      knownRoutes: [
        { observerRef: "route_1", kind: "route", label: "Речная Стража", knownAs: [], status: "open" },
      ],
      accessibleItems: [
        { observerRef: "object_9", label: "Обломок знака", knownAs: [], affordances: ["осмотреть"] },
      ],
      availableActions: [],
      currentSituation: { title: "Ночной поток", description: "Вода прибывает." },
      knownTopics: [],
      ...overrides,
    },
    references: new Map(),
  };
}

function narrative(overrides?: Partial<NarrativeAdapterContext>): NarrativeAdapterContext {
  return {
    character: {
      name: "Лёха",
      backgroundTitle: "Следопыт",
      formerRole: "Ночному дозору",
      rupture: "Ты ушёл из дозора",
      obligation: "Ты должен вернуть украденный знак",
    },
    arrival: {
      reason: "Ночной поток вынес к переправе след неверно установленного дорожного знака.",
      personalHook: "Знак помечен клеймом дозора",
      startingLocation: "Лесная дорога",
    },
    visibleSituation: {
      facts: [narrativeFact("situation:opening-problem", "Ночной поток вынес след к переправе.", "observed_fact")],
      sensoryContext: [narrativeFact("situation:river", "Вода поднялась до уровня: высокая.", "observed_fact")],
    },
    knowledge: {
      observed: [narrativeFact("knowledge:1", "Ты видел обломок знака у воды.", "observed_fact")],
      testimony: [narrativeFact("testimony:1", "Перевозчик говорит, что знак ставили ночью.", "testimony")],
      hypotheses: [narrativeFact("hypothesis:1", "Возможно, знак связан с исчезнувшим дозорным.", "inference")],
    },
    contacts: [
      { id: "contact:1", text: "Ты знаком с Перевозчиком.", epistemicClass: "established_fact", source: "relation", usableNow: true },
    ],
    accessibleItems: [
      { id: "item:1", text: "Среди твоих вещей: обломок знака.", epistemicClass: "observed_fact", source: "inventory", usableNow: true },
    ],
    unresolvedSituation: [],
    openingWindow: true,
    ...overrides,
  };
}

function plan(overrides?: Partial<ProposedQuestionPlan>): ProposedQuestionPlan {
  return {
    subjects: [
      { id: "here", surface: "здесь", kind: "place" },
      { id: "ferryman", surface: "перевозчик", kind: "entity", observerRef: "person_1" },
      { id: "me", surface: "я", kind: "self" },
      { id: "people", surface: "они", kind: "group", members: ["person_1", "person_2"] },
      { id: "sign", surface: "знак", kind: "topic", observerRef: "topic_1" },
    ],
    parts: [
      { id: "p-scene", subjectRefs: ["here"], aspect: "current_activity", time: "current", purpose: "describe" },
      { id: "p-look", subjectRefs: ["ferryman"], aspect: "appearance", time: "current", purpose: "describe" },
      { id: "p-reaction", subjectRefs: ["ferryman"], aspect: "observed_reaction", time: "current", purpose: "describe" },
      { id: "p-arrival", subjectRefs: ["me"], aspect: "background_arrival", time: "past", purpose: "explain" },
    ],
    ...overrides,
  };
}

function bindings(plan: ProposedQuestionPlan, overrides?: Partial<Record<string, Partial<SubjectBinding>>>): SubjectBinding[] {
  return plan.subjects.map((subject) => ({
    subject,
    resolution: "resolved" as const,
    resolvedRef: subject.observerRef ?? null,
    ...overrides?.[subject.id],
  }));
}

function context(overrides?: Partial<QuestionReadingContext>): QuestionReadingContext {
  const base = plan();
  return {
    plan: base,
    bindings: bindings(base),
    scene: scene(),
    narrative: narrative(),
    transcript: null,
    ...overrides,
  };
}

function run(
  partId: string,
  source: Parameters<typeof executeQuestionReading>[0]["source"],
  overrides?: Partial<QuestionReadingContext>,
): QuestionReadingResult {
  return executeQuestionReading({ partId, source }, context(overrides));
}

describe("scene reading", () => {
  it("answers place parts with location and situation, filtered to the part aspect", () => {
    const result = run("p-scene", "scene");
    expect(result.status).toBe("available");
    expect(result.facts.some((entry) => entry.text.includes("Переправа у Чёрного леса"))).toBe(true);
    expect(result.facts.some((entry) => entry.text.includes("Ночной поток"))).toBe(true);
    expect(result.facts.some((entry) => entry.text.includes("Проход к «Речной Страже»"))).toBe(false);
    expect(coveredPartsOf([result], context().plan.parts).has("p-scene")).toBe(true);

    const base = plan({
      parts: [{ id: "p-way", subjectRefs: ["here"], aspect: "continuation_way", time: "current", purpose: "describe" }],
    });
    const way = executeQuestionReading({ partId: "p-way", source: "scene" }, context({ plan: base, bindings: bindings(base) }));
    expect(way.facts.some((entry) => entry.text.includes("Проход к «Речная Стража»: возможен"))).toBe(true);
  });

  it("gives an explicit gap when the aspect cannot be served", () => {
    const base = plan({
      parts: [{ id: "p-way", subjectRefs: ["here"], aspect: "continuation_way", time: "current", purpose: "describe" }],
    });
    const noRoutes = scene();
    const bare = context({
      plan: base,
      bindings: bindings(base),
      scene: { ...noRoutes, context: { ...noRoutes.context, knownRoutes: [] } },
      narrative: null,
    });
    const result = executeQuestionReading({ partId: "p-way", source: "scene" }, bare);
    expect(result.facts).toHaveLength(0);
    expect(result.gaps[0]).toMatchObject({ status: "no_data", aspect: "continuation_way" });
  });
});

describe("person reading", () => {
  it("returns the portrait of exactly the requested subject (no mixing)", () => {
    const result = run("p-look", "person");
    expect(result.status).toBe("available");
    expect(result.facts.every((entry) => entry.subjectId === "ferryman")).toBe(true);
    expect(result.facts.some((entry) => entry.text === "Потёртый плащ")).toBe(true);
    expect(result.facts.some((entry) => entry.text === "Капюшон")).toBe(false);
    const serialized = JSON.stringify(result.facts);
    expect(serialized).not.toMatch(/worldId|eventId|entityId|sourceEventIds/);
  });

  it("reports no data for observed reaction even when a portrait exists", () => {
    const result = run("p-reaction", "person");
    expect(result.facts).toHaveLength(0);
    expect(result.gaps[0]).toMatchObject({ status: "no_data", aspect: "observed_reaction" });
    expect(result.gaps[0]!.status).not.toBe("failed");
  });

  it("maps group members to presence facts per member", () => {
    const base = plan({
      parts: [{ id: "p-group", subjectRefs: ["people"], aspect: "current_activity", time: "current", purpose: "describe" }],
    });
    const result = executeQuestionReading({ partId: "p-group", source: "scene" }, context({ plan: base, bindings: bindings(base) }));
    expect(result.facts).toHaveLength(2);
    expect(result.facts.map((entry) => entry.text).join(" ")).toContain("Перевозчик здесь");
  });
});

describe("background_arrival reading", () => {
  it("gives the arrival reason for self with past temporal membership", () => {
    const result = run("p-arrival", "background_arrival");
    expect(result.status).toBe("available");
    const reason = result.facts.find((entry) => entry.text.includes("Ночной поток"));
    expect(reason).toBeDefined();
    expect(reason!.temporal).toBe("past");
    expect(reason!.epistemicClass).toBe("established_fact");
    expect(reason!.usableNow).toBe(true);
  });

  it("has no arrival data for another entity — explicit no_data, not invention", () => {
    const base = plan({
      parts: [{ id: "p-his", subjectRefs: ["ferryman"], aspect: "background_arrival", time: "past", purpose: "explain" }],
    });
    const result = executeQuestionReading({ partId: "p-his", source: "background_arrival" }, context({ plan: base, bindings: bindings(base) }));
    expect(result.facts).toHaveLength(0);
    expect(result.gaps[0]).toMatchObject({ status: "no_data", subjectId: "ferryman" });
  });
});

describe("known_events, relations, items, conversation_topics", () => {
  it("keeps the epistemic class of each knowledge entry and filters by subject", () => {
    const base = plan({
      parts: [{ id: "p-sign", subjectRefs: ["sign"], aspect: "known_event", time: "unspecified", purpose: "recall" }],
    });
    const ctx = context({ plan: base, bindings: bindings(base) });
    const matched = executeQuestionReading({ partId: "p-sign", source: "known_events" }, ctx);
    const testimony = matched.facts.find((entry) => entry.text.includes("ставили ночью"));
    expect(testimony?.epistemicClass).toBe("testimony");
    expect(matched.facts.every((entry) => entry.text.includes("знак") || entry.epistemicClass !== "observed_fact")).toBe(true);

    const other = plan({
      subjects: [{ id: "whale", surface: "кит", kind: "topic" }],
      parts: [{ id: "p-whale", subjectRefs: ["whale"], aspect: "known_event", time: "unspecified", purpose: "recall" }],
    });
    const missing = executeQuestionReading({ partId: "p-whale", source: "known_events" },
      context({ plan: other, bindings: bindings(other) }));
    expect(missing.facts).toHaveLength(0);
    expect(missing.gaps[0]!.status).toBe("no_data");
  });

  it("links acquaintance by text and gives the known obligation for self", () => {
    const base = plan({
      parts: [{ id: "p-knows", subjectRefs: ["ferryman"], aspect: "acquaintance_link", time: "current", purpose: "describe" }],
    });
    const result = executeQuestionReading({ partId: "p-knows", source: "relations" }, context({ plan: base, bindings: bindings(base) }));
    expect(result.facts.some((entry) => entry.text === "Ты знаком с Перевозчиком.")).toBe(true);

    const selfPart = plan({
      parts: [{ id: "p-obl", subjectRefs: ["me"], aspect: "acquaintance_link", time: "current", purpose: "describe" }],
    });
    const self = executeQuestionReading({ partId: "p-obl", source: "relations" }, context({ plan: selfPart, bindings: bindings(selfPart) }));
    expect(self.facts.some((entry) => entry.text.includes("должен вернуть"))).toBe(true);
  });

  it("reads scene affordances for an item and inventory for self", () => {
    const itemPart = plan({
      subjects: [{ id: "shard", surface: "обломок знака", kind: "entity", observerRef: "object_9" }],
      parts: [{ id: "p-item", subjectRefs: ["shard"], aspect: "item_properties", time: "current", purpose: "describe" }],
    });
    const item = executeQuestionReading({ partId: "p-item", source: "items" }, context({ plan: itemPart, bindings: bindings(itemPart) }));
    expect(item.facts[0]!.text).toBe("Обломок знака: осмотреть");

    const selfPart = plan({
      parts: [{ id: "p-mine", subjectRefs: ["me"], aspect: "item_properties", time: "current", purpose: "describe" }],
    });
    const mine = executeQuestionReading({ partId: "p-mine", source: "items" }, context({ plan: selfPart, bindings: bindings(selfPart) }));
    expect(mine.facts.some((entry) => entry.text.includes("Среди твоих вещей"))).toBe(true);
  });

  it("answers from transcript mentions as past conversation facts", () => {
    const transcript: readonly ReadingTranscriptEntry[] = [
      { role: "master", text: "Ты пришёл по следу неверно установленного знака." },
      { role: "player", text: "Почему ты упомянул этот знак?" },
    ];
    const base = plan({
      parts: [{ id: "p-topic", subjectRefs: ["sign"], aspect: "conversation_topic", time: "past", purpose: "recall" }],
    });
    const result = executeQuestionReading({ partId: "p-topic", source: "conversation_topics" },
      context({ plan: base, bindings: bindings(base), transcript }));
    expect(result.facts).toHaveLength(2);
    expect(result.facts.every((entry) => entry.temporal === "past")).toBe(true);

    const without = executeQuestionReading({ partId: "p-topic", source: "conversation_topics" },
      context({ plan: base, bindings: bindings(base), transcript: null }));
    expect(without.facts).toHaveLength(0);
    expect(without.gaps[0]!.status).toBe("no_data");
  });
});

describe("request validation and subject resolution", () => {
  it("fails on an unknown part and on a missing binding", () => {
    expect(run("ghost", "scene").gaps[0]).toMatchObject({ status: "failed" });
    const base = plan();
    const withoutBinding = context({
      plan: base,
      bindings: bindings(base).filter((binding) => binding.subject.id !== "ferryman"),
    });
    const result = executeQuestionReading({ partId: "p-look", source: "person" }, withoutBinding);
    expect(result.facts).toHaveLength(0);
    expect(result.gaps[0]!.status).toBe("failed");
  });

  it("separates ambiguous and absent subjects without leaking secrets", () => {
    const base = plan();
    const ambiguous = context({
      plan: base,
      bindings: bindings(base, { ferryman: { resolution: "ambiguous", resolvedRef: null } }),
    });
    const result = executeQuestionReading({ partId: "p-look", source: "person" }, ambiguous);
    expect(result.status).toBe("ambiguous_subject");
    expect(result.gaps[0]).toMatchObject({ status: "ambiguous_subject", surface: "перевозчик" });

    const absent = context({
      plan: base,
      bindings: bindings(base, { ferryman: { resolution: "absent", resolvedRef: null } }),
    });
    const gone = executeQuestionReading({ partId: "p-look", source: "person" }, absent);
    expect(gone.status).toBe("no_data");
    expect(JSON.stringify(gone.gaps)).not.toMatch(/hidden|secret|forbidden|denied/);
  });

  it("treats a stale scene ref as ordinary no_data", () => {
    const base = plan();
    const stale = context({
      plan: base,
      bindings: bindings(base, { ferryman: { resolution: "resolved", resolvedRef: "person_9" } }),
    });
    const result = executeQuestionReading({ partId: "p-look", source: "person" }, stale);
    expect(result.facts).toHaveLength(0);
    expect(result.gaps[0]!.status).toBe("no_data");
  });
});
