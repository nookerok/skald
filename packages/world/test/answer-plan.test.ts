import { describe, expect, it } from "vitest";
import type { QuestionPlan, ReadingRequest } from "@skald/intent-parser";
import {
  ANSWER_GAP_STATEMENT,
  buildAnswerPlan,
} from "@skald/world";
import type { QuestionReadingRound } from "@skald/world";
import type { QuestionReadingFact, QuestionReadingResult } from "@skald/world";

function questionPlan(parts: QuestionPlan["parts"]): QuestionPlan {
  return Object.freeze({
    subjects: Object.freeze([
      { subject: { id: "here", surface: "здесь", kind: "place" as const }, resolution: "resolved" as const, resolvedRef: null },
    ]),
    parts: Object.freeze([...parts]),
    actionIntent: null,
  });
}

function fact(overrides?: Partial<QuestionReadingFact>): QuestionReadingFact {
  return {
    factId: "scene:here:0",
    text: "Вода прибывает.",
    subjectId: "here",
    aspects: ["current_activity"],
    epistemicClass: "observed_fact",
    temporal: "current",
    usableNow: true,
    source: "scene",
    ...overrides,
  };
}

function result(request: ReadingRequest, partial?: Partial<QuestionReadingResult>): QuestionReadingResult {
  return { request, status: "available", facts: [], gaps: [], ...partial };
}

function round(plan: QuestionPlan, results: readonly QuestionReadingResult[]): QuestionReadingRound {
  return Object.freeze({
    revision: Object.freeze({ worldTime: 1, eventNumber: 4 }),
    questionPlan: plan,
    results: Object.freeze([...results]),
    coveredParts: Object.freeze([]),
  });
}

const P_ACT = { id: "p-act", subjectRefs: ["here"], aspect: "current_activity" as const, time: "current" as const, purpose: "describe" as const };
const P_LOOK = { id: "p-look", subjectRefs: ["here"], aspect: "appearance" as const, time: "current" as const, purpose: "describe" as const };

describe("buildAnswerPlan", () => {
  it("promotes covered facts with provenance, assertion, temporal and availability", () => {
    const plan = questionPlan([P_ACT]);
    const answerPlan = buildAnswerPlan({
      readings: round(plan, [
        result({ partId: "p-act", source: "scene" }, { facts: [fact()] }),
      ]),
    });

    expect(answerPlan.allCovered).toBe(true);
    expect(answerPlan.parts[0]).toMatchObject({ partId: "p-act", coverage: "covered", gapStatement: null });
    expect(answerPlan.statements).toEqual(["Вода прибывает."]);
    expect(answerPlan.narrowClarification).toBeNull();
    const [entry] = answerPlan.parts[0]!.facts;
    expect(entry).toEqual({
      content: "Вода прибывает.",
      provenance: "observation",
      assertion: "observed",
      temporal: "now",
      available: true,
    });
    expect(Object.isFrozen(answerPlan)).toBe(true);
    expect(Object.isFrozen(answerPlan.parts)).toBe(true);
  });

  it("maps hypothesis, testimony, past time and recallability independently", () => {
    const plan = questionPlan([P_ACT]);
    const answerPlan = buildAnswerPlan({
      readings: round(plan, [
        result({ partId: "p-act", source: "known_events" }, {
          facts: [
            fact({ factId: "n1", text: "Знак не от старого дозора.", epistemicClass: "inference" }),
            fact({ factId: "n2", text: "Перевозчик говорит о тумане.", epistemicClass: "testimony" }),
            fact({ factId: "n3", text: "Вчера вода стояла.", temporal: "past" }),
            fact({ factId: "n4", text: "Дальний берег.", usableNow: false }),
          ],
        }),
      ]),
    });

    const facts = answerPlan.parts[0]!.facts;
    expect(facts[0]).toMatchObject({ provenance: "hypothesis", assertion: "inferred" });
    expect(facts[1]).toMatchObject({ provenance: "testimony", assertion: "told" });
    expect(facts[2]).toMatchObject({ temporal: "earlier" });
    expect(facts[3]).toMatchObject({ available: false, temporal: "now" });
  });

  it("states a gap instead of an assertion when no fact serves the part", () => {
    const plan = questionPlan([P_LOOK]);
    const answerPlan = buildAnswerPlan({
      readings: round(plan, [
        // The scene source answered current_activity — wrong aspect for p-look.
        result({ partId: "p-look", source: "scene" }, { facts: [fact()] }),
      ]),
    });

    expect(answerPlan.allCovered).toBe(false);
    expect(answerPlan.parts[0]).toMatchObject({
      coverage: "gap",
      facts: [],
      gapStatement: ANSWER_GAP_STATEMENT,
      gapStatus: "no_data",
    });
    // Gap-without-inversion: the statement is the closed template, never the
    // subject's real fact text.
    expect(answerPlan.statements).toEqual([ANSWER_GAP_STATEMENT]);
    expect(answerPlan.statements.join(" ")).not.toContain("Вода прибывает.");
  });

  it("asks ONE narrow clarification when exactly one part is ambiguous", () => {
    const plan = questionPlan([P_ACT, P_LOOK]);
    const answerPlan = buildAnswerPlan({
      readings: round(plan, [
        result({ partId: "p-act", source: "scene" }, { facts: [fact()] }),
        result({ partId: "p-look", source: "person" }, {
          status: "ambiguous_subject",
          gaps: [{ partId: "p-look", status: "ambiguous_subject", surface: "он" }],
        }),
      ]),
    });

    expect(answerPlan.narrowClarification).toBe("Что именно ты имеешь в виду — «он»?");
    // Answer the rest: the covered part still states its facts, the ambiguous
    // part contributes neither facts nor a gap assertion.
    expect(answerPlan.statements).toEqual(["Вода прибывает."]);
    expect(answerPlan.parts[1]).toMatchObject({ coverage: "gap", gapStatus: "ambiguous_subject" });
  });

  it("keeps every gap explicit when several parts are ambiguous", () => {
    const plan = questionPlan([P_ACT, P_LOOK]);
    const answerPlan = buildAnswerPlan({
      readings: round(plan, [
        result({ partId: "p-act", source: "scene" }, {
          status: "ambiguous_subject",
          gaps: [{ partId: "p-act", status: "ambiguous_subject", surface: "здесь" }],
        }),
        result({ partId: "p-look", source: "person" }, {
          status: "ambiguous_subject",
          gaps: [{ partId: "p-look", status: "ambiguous_subject", surface: "он" }],
        }),
      ]),
    });

    expect(answerPlan.narrowClarification).toBeNull();
    expect(answerPlan.statements).toEqual([ANSWER_GAP_STATEMENT, ANSWER_GAP_STATEMENT]);
  });

  it("carries world results verbatim and returns a vacuous plan without a round", () => {
    const empty = buildAnswerPlan({ worldResults: ["  путь заблокирован  ", ""] });
    expect(empty).toMatchObject({
      parts: [],
      statements: [],
      allCovered: true,
      narrowClarification: null,
      worldResults: ["путь заблокирован"],
    });

    const plan = questionPlan([P_ACT]);
    const withRound = buildAnswerPlan({
      readings: round(plan, [result({ partId: "p-act", source: "scene" }, { facts: [fact()] })]),
      worldResults: ["проход закрыт"],
    });
    expect(withRound.worldResults).toEqual(["проход закрыт"]);
  });
});
