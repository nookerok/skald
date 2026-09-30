/**
 * `AllowedNarrativeFacts` contract (ADR-0037 / T2): the closed, bounded set
 * handed to the master, with turn-local refs and no internal ids.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_NARRATIVE_FACTS_MAX,
  ANSWER_GAP_STATEMENT,
  buildAllowedNarrativeFacts,
  buildAnswerPlanAllowedFacts,
} from "@skald/world";
import type { AnswerPlan } from "@skald/world";

function fact(id: string, text: string, epistemicClass: string, source: string, usableNow = true) {
  return { id, text, epistemicClass, source, usableNow, sourceEventIds: ["evt-secret"] };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    character: { name: "Зоя", backgroundTitle: "Изгнанник с северной дороги", formerRole: "Бывший дорожный проводник.", rupture: "Дорога домой закрыта.", obligation: "Найти того, кто изменил знак." },
    arrival: { reason: "Ты пришёл по следу неверного знака.", personalHook: "Тебя ждут объяснения.", startingLocation: "river_waystation" },
    visibleSituation: { facts: [fact("situation:flood", "Вода поднялась.", "observed_fact", "observation")], sensoryContext: [] },
    accessibleItems: [],
    contacts: [fact("contact:keeper", "Перевозчик у переправы.", "observed_fact", "observation")],
    knowledge: {
      observed: [],
      testimony: [fact("testimony:north", "Свидетель видел знак на северной дороге.", "testimony", "testimony")],
      hypotheses: [fact("hypothesis:course", "Старое русло могло уйти к развалинам.", "inference", "observation")],
    },
    unresolvedSituation: [],
    ...overrides,
  } as never;
}

describe("AllowedNarrativeFacts", () => {
  it("carries typed facts with turn-local refs and provenance", () => {
    const allowed = buildAllowedNarrativeFacts({ context: context(), question: "почему я здесь?" });
    expect(allowed.question).toBe("почему я здесь?");
    expect(allowed.facts.length).toBeGreaterThanOrEqual(4);
    expect(allowed.facts.map((f) => f.ref)).toEqual(allowed.facts.map((_, i) => `f${i + 1}`));

    const byContent = new Map(allowed.facts.map((f) => [f.content, f]));
    expect(byContent.get("Бывший дорожный проводник.")).toMatchObject({ provenance: "background", assertion: "established", temporal: "now", available: true });
    expect(byContent.get("Перевозчик у переправы.")).toMatchObject({ provenance: "observation", assertion: "observed" });
    expect(byContent.get("Свидетель видел знак на северной дороге.")).toMatchObject({ provenance: "testimony", assertion: "told" });
    expect(byContent.get("Старое русло могло уйти к развалинам.")).toMatchObject({ provenance: "hypothesis", assertion: "inferred" });
  });

  it("never leaks internal ids, event ids or provenance into the set", () => {
    const allowed = buildAllowedNarrativeFacts({ context: context() });
    const dump = JSON.stringify(allowed);
    expect(dump).not.toContain("contact:keeper");
    expect(dump).not.toContain("background:role");
    expect(dump).not.toContain("sourceEventIds");
    expect(dump).not.toContain("evt-secret");
  });

  it("is bounded and marks memory facts", () => {
    const many = Array.from({ length: 40 }, (_, i) => fact(`background:${i}`, `Факт ${i}.`, "established_fact", "background", i % 2 === 0));
    const allowed = buildAllowedNarrativeFacts({ context: context({ knowledge: { observed: many, testimony: [], hypotheses: [] } }) });
    expect(allowed.facts.length).toBeLessThanOrEqual(ALLOWED_NARRATIVE_FACTS_MAX);
    expect(allowed.facts.some((f) => f.temporal === "memory")).toBe(true);
  });

  it("keeps mandatory results, continuations and gaps", () => {
    const allowed = buildAllowedNarrativeFacts({ mandatory: ["путь заблокирован"], continuations: ["спросить перевозчика"], gaps: ["реакция неизвестна"] });
    expect(allowed.mandatory).toEqual(["путь заблокирован"]);
    expect(allowed.continuations).toEqual(["спросить перевозчика"]);
    expect(allowed.gaps).toEqual(["реакция неизвестна"]);
    expect(allowed.facts).toEqual([]);
  });

  it("is frozen and deterministic", () => {
    const a = buildAllowedNarrativeFacts({ context: context() });
    const b = buildAllowedNarrativeFacts({ context: context() });
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.facts)).toBe(true);
  });

  it("never admits a player claim from the replica into the set", () => {
    // The replica reaches only `question`; a claim inside it («у меня есть
    // меч») never becomes an allowed fact.
    const allowed = buildAllowedNarrativeFacts({ context: context(), question: "у меня есть меч, покажи его" });
    expect(allowed.question).toBe("у меня есть меч, покажи его");
    expect(allowed.facts.some((entry) => /меч/iu.test(entry.content))).toBe(false);
  });
});

function planFact(content: string, overrides?: Partial<AnswerPlan["parts"][number]["facts"][number]>): AnswerPlan["parts"][number]["facts"][number] {
  return { content, provenance: "observation", assertion: "observed", temporal: "now", available: true, ...overrides };
}

function answerPlan(parts: AnswerPlan["parts"]): AnswerPlan {
  return Object.freeze({
    parts: Object.freeze(parts),
    worldResults: Object.freeze(["Перед тобой нет свободного прохода."]),
    statements: Object.freeze([]),
    allCovered: true,
    narrowClarification: null,
  });
}

describe("AllowedNarrativeFacts answer-plan selection (T4)", () => {
  it("selects question-part facts before useful context (coverage first)", () => {
    const plan = answerPlan([{
      partId: "p-act",
      aspect: "current_activity",
      coverage: "covered",
      facts: Object.freeze([planFact("Вода прибывает.")]),
      gapStatement: null,
      gapStatus: null,
    }]);
    const allowed = buildAllowedNarrativeFacts({ context: context(), answerPlan: plan });

    expect(allowed.facts[0]!.content).toBe("Вода прибывает.");
    const partIndex = allowed.facts.findIndex((entry) => entry.content === "Вода прибывает.");
    const backgroundIndex = allowed.facts.findIndex((entry) => entry.content === "Изгнанник с северной дороги");
    expect(partIndex).toBeGreaterThanOrEqual(0);
    expect(backgroundIndex).toBeGreaterThan(partIndex);
    expect(allowed.coverageComplete).toBe(true);
  });

  it("gives an explicit incomplete-coverage signal when a part fact overflows", () => {
    const many = Array.from({ length: ALLOWED_NARRATIVE_FACTS_MAX + 6 }, (_, i) => planFact(`Наблюдение ${i}.`));
    const plan = answerPlan([{
      partId: "p-act",
      aspect: "current_activity",
      coverage: "covered",
      facts: Object.freeze(many),
      gapStatement: null,
      gapStatus: null,
    }]);
    const allowed = buildAllowedNarrativeFacts({ context: context(), answerPlan: plan });

    expect(allowed.coverageComplete).toBe(false);
    // Reserved first: the set starts with part facts, context overflowed silently.
    expect(allowed.facts[0]!.content).toBe("Наблюдение 0.");
    expect(allowed.facts.length).toBe(ALLOWED_NARRATIVE_FACTS_MAX);
  });

  it("keeps coverage complete when only useful context overflows", () => {
    const plan = answerPlan([{
      partId: "p-act",
      aspect: "current_activity",
      coverage: "covered",
      facts: Object.freeze([planFact("Вода прибывает.")]),
      gapStatement: null,
      gapStatus: null,
    }]);
    const many = Array.from({ length: 40 }, (_, i) => fact(`background:${i}`, `Факт ${i}.`, "established_fact", "background"));
    const allowed = buildAllowedNarrativeFacts({
      context: context({ knowledge: { observed: many, testimony: [], hypotheses: [] } }),
      answerPlan: plan,
    });

    expect(allowed.coverageComplete).toBe(true);
    expect(allowed.facts.length).toBe(ALLOWED_NARRATIVE_FACTS_MAX);
  });

  it("joins the plan's gap statements into the allowed gaps", () => {
    const plan = answerPlan([{
      partId: "p-look",
      aspect: "appearance",
      coverage: "gap",
      facts: Object.freeze([]),
      gapStatement: ANSWER_GAP_STATEMENT,
      gapStatus: "no_data",
    }]);
    const allowed = buildAllowedNarrativeFacts({ answerPlan: plan, gaps: ["реакция неизвестна"] });

    expect(allowed.gaps).toContain(ANSWER_GAP_STATEMENT);
    expect(allowed.gaps).toContain("реакция неизвестна");
  });

  it("splits mandatory: world results and part facts mandatory, the paragraph only a fallback", () => {
    const plan = answerPlan([{
      partId: "p-act",
      aspect: "current_activity",
      coverage: "covered",
      facts: Object.freeze([planFact("Вода прибывает.")]),
      gapStatement: null,
      gapStatus: null,
    }]);
    const allowed = buildAnswerPlanAllowedFacts({
      context: context(),
      answer: "Ты стоишь у подъёма, и берег размыт.",
      answerPlan: plan,
    });

    expect(allowed.mandatory).toEqual([
      "Перед тобой нет свободного прохода.",
      "Вода прибывает.",
    ]);
    // The mis-chosen answer paragraph is NOT mandatory — but stays available
    // as the fallback formulation from the same facts.
    expect(allowed.mandatory).not.toContain("Ты стоишь у подъёма, и берег размыт.");
    expect(allowed.facts.some((entry) => entry.content === "Ты стоишь у подъёма, и берег размыт.")).toBe(true);
    // The refusal enters as a citable fact so the composer must select it.
    expect(allowed.facts.some((entry) => entry.content === "Перед тобой нет свободного прохода.")).toBe(true);
  });

  it("keeps the needed portrait and mandatory refusal under saturation (T6)", () => {
    // >24 potential facts, several NPCs, a long backstory: the covered
    // portrait fact and the world-result refusal must both survive the cap.
    const bulk = Array.from({ length: 30 }, (_, i) => fact(`background:${i}`, `Контекст ${i}.`, "established_fact", "background"));
    const longBackstory = "Дорога началась задолго до переправы: " + "изгнанник шёл через burned villages, пустые разъезды и тихие броды. ".repeat(6);
    const saturated = context({
      knowledge: {
        observed: bulk,
        testimony: [
          fact("testimony:north", "Свидетель видел знак на северной дороге.", "testimony", "testimony"),
          fact("testimony:long", longBackstory, "testimony", "testimony"),
        ],
        hypotheses: [fact("hypothesis:course", "Старое русло могло уйти к развалинам.", "inference", "observation")],
      },
      contacts: [
        fact("contact:keeper", "Перевозчик у переправы.", "observed_fact", "observation"),
        fact("contact:miller", "Мельник у запруды.", "observed_fact", "observation"),
        fact("contact:trader", "Торговец с лотком.", "observed_fact", "observation"),
      ],
    });
    const plan = answerPlan([{
      partId: "p-look",
      aspect: "appearance",
      coverage: "covered",
      facts: Object.freeze([planFact("Потёртый плащ")]),
      gapStatement: null,
      gapStatus: null,
    }]);
    const refusalPlan: AnswerPlan = Object.freeze({
      ...plan,
      worldResults: Object.freeze(["Путь к переправе закрыт наводнением."]),
    });
    const allowed = buildAnswerPlanAllowedFacts({
      context: saturated,
      answer: "fallback paragraph",
      answerPlan: refusalPlan,
    });

    expect(allowed.facts.length).toBeLessThanOrEqual(ALLOWED_NARRATIVE_FACTS_MAX);
    // The needed portrait survives saturation…
    expect(allowed.facts.some((entry) => entry.content === "Потёртый плащ")).toBe(true);
    // …and the mandatory refusal survives both as mandatory and as a fact.
    expect(allowed.mandatory).toContain("Путь к переправе закрыт наводнением.");
    expect(allowed.facts.some((entry) => entry.content === "Путь к переправе закрыт наводнением.")).toBe(true);
    expect(allowed.coverageComplete).toBe(true);
  });

  it("keeps the legacy contract without a plan: the answer stays mandatory", () => {
    const allowed = buildAnswerPlanAllowedFacts({
      context: context(),
      answer: "Где я? — Переправа у Чёрного леса.",
    });

    expect(allowed.mandatory).toEqual(["Где я? — Переправа у Чёрного леса."]);
    expect(allowed.coverageComplete).toBe(true);
  });
});
