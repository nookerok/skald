import { describe, expect, it } from "vitest";
import {
  QUESTION_PLAN_MAX_PARTS,
  READING_MAX_REQUESTS,
  diagnoseTurnProposalShape,
  parseProposedQuestionPlan,
  parseReadingRequests,
  parseTurnProposal,
  validateTurnProposal,
} from "@skald/intent-parser";

function groupQuestionPlan() {
  return {
    subjects: [
      { id: "people", surface: "они", kind: "group", members: ["person_1", "person_2"] },
    ],
    parts: [
      { id: "look", subjectRefs: ["people"], aspect: "appearance", time: "current", purpose: "describe" },
      { id: "reaction", subjectRefs: ["people"], aspect: "observed_reaction", time: "current", purpose: "describe" },
    ],
  };
}

function inquiryProposal(questionPlan?: unknown, readings?: unknown) {
  return {
    schemaVersion: 2,
    kind: "inquiry",
    primaryIntent: { kind: "inquiry", queryId: "current_location", sourceText: "где я и как они выглядят" },
    supportingClauses: [],
    referents: [],
    ...(questionPlan !== undefined ? { questionPlan } : {}),
    ...(readings !== undefined ? { readings } : {}),
  };
}

describe("parseProposedQuestionPlan", () => {
  it("accepts a compound group question with one subject and two parts", () => {
    const plan = parseProposedQuestionPlan(groupQuestionPlan());
    expect(plan).not.toBeNull();
    expect(plan!.parts).toHaveLength(2);
    expect(plan!.subjects[0]!.kind).toBe("group");
    expect(plan!.subjects[0]!.members).toEqual(["person_1", "person_2"]);
  });

  it("accepts entity, topic, place, self and ordinal subjects", () => {
    const plan = parseProposedQuestionPlan({
      subjects: [
        { id: "ferryman", surface: "перевозчик", kind: "entity", observerRef: "person_1" },
        { id: "sign", surface: "знак", kind: "topic", observerRef: "topic_1" },
        { id: "here", surface: "здесь", kind: "place", observerRef: "route_1" },
        { id: "me", surface: "я", kind: "self" },
        { id: "first", surface: "первый перевозчик", kind: "ordinal", listRef: "scene_people", position: 1 },
      ],
      parts: [
        { id: "arrival", subjectRefs: ["me"], aspect: "background_arrival", time: "past", purpose: "explain" },
        { id: "who", subjectRefs: ["first"], aspect: "identity_role", time: "unspecified", purpose: "recall" },
      ],
    });
    expect(plan).not.toBeNull();
    expect(plan!.parts[0]!.purpose).toBe("explain");
    expect(plan!.subjects[4]!.position).toBe(1);
  });

  it("rejects an unknown aspect, time, purpose or subject kind", () => {
    const base = groupQuestionPlan();
    expect(parseProposedQuestionPlan({
      ...base,
      parts: [{ id: "p", subjectRefs: ["people"], aspect: "secret_lore", time: "current", purpose: "describe" }],
    })).toBeNull();
    expect(parseProposedQuestionPlan({
      ...base,
      parts: [{ id: "p", subjectRefs: ["people"], aspect: "appearance", time: "future", purpose: "describe" }],
    })).toBeNull();
    expect(parseProposedQuestionPlan({
      ...base,
      parts: [{ id: "p", subjectRefs: ["people"], aspect: "appearance", time: "current", purpose: "prove" }],
    })).toBeNull();
    expect(parseProposedQuestionPlan({
      subjects: [{ id: "x", surface: "они", kind: "crowd" }],
      parts: [{ id: "p", subjectRefs: ["x"], aspect: "appearance", time: "current", purpose: "describe" }],
    })).toBeNull();
  });

  it("rejects a part referencing an undeclared subject and duplicate ids", () => {
    const base = groupQuestionPlan();
    expect(parseProposedQuestionPlan({
      ...base,
      parts: [{ id: "look", subjectRefs: ["ghost"], aspect: "appearance", time: "current", purpose: "describe" }],
    })).toBeNull();
    expect(parseProposedQuestionPlan({
      subjects: [
        { id: "people", surface: "они", kind: "group", members: ["person_1"] },
        { id: "people", surface: "толпа", kind: "group", members: ["person_2"] },
      ],
      parts: base.parts,
    })).toBeNull();
  });

  it("enforces the part limit", () => {
    const parts = Array.from({ length: QUESTION_PLAN_MAX_PARTS + 1 }, (_unused, index) => ({
      id: "p" + index,
      subjectRefs: ["people"],
      aspect: "appearance",
      time: "current",
      purpose: "describe",
    }));
    expect(parseProposedQuestionPlan({ subjects: groupQuestionPlan().subjects, parts })).toBeNull();
  });

  it("enforces per-kind subject requirements", () => {
    expect(parseProposedQuestionPlan({
      subjects: [{ id: "g", surface: "люди", kind: "group" }],
      parts: [{ id: "p", subjectRefs: ["g"], aspect: "appearance", time: "current", purpose: "describe" }],
    })).toBeNull();
    expect(parseProposedQuestionPlan({
      subjects: [{ id: "e", surface: "перевозчик", kind: "entity", members: ["person_1"] }],
      parts: [{ id: "p", subjectRefs: ["e"], aspect: "appearance", time: "current", purpose: "describe" }],
    })).toBeNull();
    expect(parseProposedQuestionPlan({
      subjects: [{ id: "o", surface: "первый", kind: "ordinal", listRef: "scene_people" }],
      parts: [{ id: "p", subjectRefs: ["o"], aspect: "identity_role", time: "current", purpose: "describe" }],
    })).toBeNull();
    expect(parseProposedQuestionPlan({
      subjects: [{ id: "o", surface: "первый", kind: "ordinal", listRef: "scene_people", position: 0 }],
      parts: [{ id: "p", subjectRefs: ["o"], aspect: "identity_role", time: "current", purpose: "describe" }],
    })).toBeNull();
  });

  it("rejects unknown keys", () => {
    expect(parseProposedQuestionPlan({ ...groupQuestionPlan(), hidden: true })).toBeNull();
    expect(parseProposedQuestionPlan({
      subjects: [{ ...groupQuestionPlan().subjects[0], entityId: "npc-7" }],
      parts: groupQuestionPlan().parts,
    })).toBeNull();
  });
});

describe("parseReadingRequests", () => {
  const plan = parseProposedQuestionPlan(groupQuestionPlan())!;

  it("accepts up to READING_MAX_REQUESTS requests for declared parts", () => {
    const requests = parseReadingRequests([
      { partId: "look", source: "person" },
      { partId: "reaction", source: "scene" },
    ], plan);
    expect(requests).not.toBeNull();
    expect(requests).toHaveLength(2);
  });

  it("rejects more than the limit, unknown sources and unknown parts", () => {
    expect(parseReadingRequests([
      { partId: "look", source: "person" },
      { partId: "look", source: "scene" },
      { partId: "reaction", source: "scene" },
      { partId: "reaction", source: "items" },
    ], plan)).toBeNull();
    expect(parseReadingRequests([{ partId: "look", source: "canon" }], plan)).toBeNull();
    expect(parseReadingRequests([{ partId: "ghost", source: "person" }], plan)).toBeNull();
    expect(parseReadingRequests([{ partId: "look", source: "person", worldId: "w" }], plan)).toBeNull();
  });

  it("rejects duplicate part/source pairs", () => {
    expect(parseReadingRequests([
      { partId: "look", source: "person" },
      { partId: "look", source: "person" },
    ], plan)).toBeNull();
  });

  it("exposes the declared limits", () => {
    expect(READING_MAX_REQUESTS).toBe(3);
    expect(QUESTION_PLAN_MAX_PARTS).toBe(4);
  });
});

describe("TurnProposalV2 questionPlan integration", () => {
  it("accepts an inquiry proposal carrying a plan and readings", () => {
    const result = validateTurnProposal(inquiryProposal(groupQuestionPlan(), [
      { partId: "look", source: "person" },
    ]));
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.proposal.questionPlan?.parts).toHaveLength(2);
    expect(result.proposal.readings).toHaveLength(1);
  });

  it("keeps proposals without a plan accepted (backward compatible)", () => {
    expect(validateTurnProposal(inquiryProposal()).status).toBe("accepted");
  });

  it("rejects readings without a question plan", () => {
    expect(validateTurnProposal(inquiryProposal(undefined, [
      { partId: "look", source: "person" },
    ])).status).toBe("invalid");
    expect(diagnoseTurnProposalShape(inquiryProposal(undefined, [
      { partId: "look", source: "person" },
    ]))).toEqual({ code: "nested_invalid", key: "readings" });
  });

  it("diagnoses a malformed question plan by key", () => {
    const broken = inquiryProposal({ subjects: [], parts: [] });
    expect(validateTurnProposal(broken).status).toBe("invalid");
    expect(diagnoseTurnProposalShape(broken)).toEqual({ code: "nested_invalid", key: "questionPlan" });
  });

  it("rejects a question plan on a turn without a question", () => {
    const action = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю реку" },
      supportingClauses: [],
      referents: [],
      questionPlan: groupQuestionPlan(),
    };
    const result = validateTurnProposal(action);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.code).toBe("question_placement");
  });

  it("parses via parseTurnProposal and stays frozen", () => {
    const proposal = parseTurnProposal(inquiryProposal(groupQuestionPlan(), [
      { partId: "look", source: "person" },
    ]));
    expect(proposal).not.toBeNull();
    expect(Object.isFrozen(proposal!.questionPlan)).toBe(true);
    expect(Object.isFrozen(proposal!.questionPlan!.parts[0])).toBe(true);
    expect(Object.isFrozen(proposal!.readings)).toBe(true);
  });
});
