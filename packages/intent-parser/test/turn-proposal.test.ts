import { describe, expect, it } from "vitest";
import {
  findAuthorityField,
  parseTurnProposal,
  validateTurnProposal,
} from "@skald/intent-parser";

function actionProposal() {
  return {
    schemaVersion: 2,
    kind: "action",
    primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю реку" },
    supportingClauses: [],
    target: { role: "target", observerRef: "object_1", surface: "реку" },
    referents: [{ role: "target", observerRef: "object_1", surface: "реку" }],
  };
}

describe("TurnProposalV2 schema", () => {
  it("accepts an action turn with a declared referent", () => {
    const result = validateTurnProposal(actionProposal());
    expect(result.status).toBe("accepted");
  });

  it("accepts journey, inquiry, speech, mixed and meta kinds", () => {
    const journey = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: {
        kind: "journey",
        destination: { role: "destination", observerRef: "route_1", surface: "Речная Стража" },
        routeHint: "по лесной дороге",
        sourceText: "иду к Речной Страже",
      },
      supportingClauses: [],
      referents: [{ role: "destination", observerRef: "route_1", surface: "Речная Стража" }],
    };
    expect(validateTurnProposal(journey).status).toBe("accepted");

    const inquiry = {
      schemaVersion: 2,
      kind: "inquiry",
      primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: "что я вижу" },
      supportingClauses: [],
      referents: [],
    };
    expect(validateTurnProposal(inquiry).status).toBe("accepted");

    const speech = {
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "Помоги мне", sourceText: "прошу о помощи" },
      supportingClauses: [],
      addressedEntity: { role: "addressee", observerRef: "person_1", surface: "перевозчик" },
      referents: [{ role: "addressee", observerRef: "person_1", surface: "перевозчик" }],
    };
    expect(validateTurnProposal(speech).status).toBe("accepted");

    const mixed = {
      schemaVersion: 2,
      kind: "mixed",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "подхожу к ограде" },
      supportingClauses: [{ kind: "deferred_action", summary: "осмотреть двор" }],
      target: { role: "target", observerRef: "object_1", surface: "ограда" },
      question: { queryId: "visible_scene", focus: { role: "target", observerRef: "object_2", surface: "двор" } },
      referents: [
        { role: "target", observerRef: "object_1", surface: "ограда" },
        { role: "target", observerRef: "object_2", surface: "двор" },
      ],
    };
    expect(validateTurnProposal(mixed).status).toBe("accepted");

    const meta = {
      schemaVersion: 2,
      kind: "meta",
      primaryIntent: { kind: "meta", operation: "explain_available_actions", sourceText: "что я могу делать" },
      supportingClauses: [],
      referents: [],
    };
    expect(validateTurnProposal(meta).status).toBe("accepted");
  });

  it("rejects unknown top-level and nested fields", () => {
    expect(validateTurnProposal({ ...actionProposal(), extra: 1 }).status).toBe("invalid");
    expect(validateTurnProposal({
      ...actionProposal(),
      target: { role: "target", surface: "реку", color: "blue" },
    }).status).toBe("invalid");
    expect(validateTurnProposal({
      ...actionProposal(),
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "x", confidence: 0.9 },
    }).status).toBe("invalid");
  });

  it("rejects oversized strings", () => {
    const long = "x".repeat(241);
    expect(validateTurnProposal({
      ...actionProposal(),
      target: { role: "target", surface: long },
      referents: [],
    }).status).toBe("invalid");
    expect(validateTurnProposal({
      ...actionProposal(),
      supportingClauses: [{ kind: "deferred_action", summary: long }],
    }).status).toBe("invalid");
  });

  it("rejects control characters in strings", () => {
    expect(validateTurnProposal({
      ...actionProposal(),
      target: { role: "target", surface: "реку" + String.fromCharCode(0) },
      referents: [],
    }).status).toBe("invalid");
  });

  it("rejects authority fields with an explicit reason", () => {
    for (const raw of [
      { ...actionProposal(), success: true },
      { ...actionProposal(), difficulty: "easy" },
      { ...actionProposal(), events: ["DoorOpened"] },
      {
        ...actionProposal(),
        target: { role: "target", surface: "реку", entityId: "hidden_tower" },
        referents: [],
      },
    ]) {
      const result = validateTurnProposal(raw);
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") expect(result.reason).toMatch(/authority/);
    }
    expect(findAuthorityField({ nested: [{ entityId: "x" }] })).toBe("entityId");
    expect(findAuthorityField(actionProposal())).toBeNull();
  });

  it("rejects malformed observer refs", () => {
    for (const observerRef of ["entity_1", "person_0", "person_100", "p1", "person1", ""]) {
      const result = validateTurnProposal({
        ...actionProposal(),
        target: { role: "target", observerRef, surface: "реку" },
        referents: [{ role: "target", observerRef, surface: "реку" }],
      });
      expect(result.status).toBe("invalid");
    }
    for (const observerRef of ["person_1", "object_2", "route_1", "topic_3"]) {
      const result = validateTurnProposal({
        ...actionProposal(),
        target: { role: "target", observerRef, surface: "реку" },
        referents: [{ role: "target", observerRef, surface: "реку" }],
      });
      expect(result.status).toBe("accepted");
    }
  });

  it("rejects a turn-level question on action, speech and meta turns", () => {
    const question = { queryId: "visible_scene" };
    expect(validateTurnProposal({ ...actionProposal(), question }).status).toBe("invalid");

    const speech = {
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "Привет", sourceText: "здороваюсь" },
      supportingClauses: [],
      question,
      referents: [],
    };
    expect(validateTurnProposal(speech).status).toBe("invalid");
  });

  it("accepts speech with a topic clause and rejects speech without utterance", () => {
    const speechTopic = {
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "Что скажешь о воде?", sourceText: "спрашиваю о воде" },
      supportingClauses: [{ kind: "speech_topic", topic: { role: "topic", observerRef: "topic_1", surface: "вода" } }],
      addressedEntity: { role: "addressee", observerRef: "person_1", surface: "перевозчик" },
      referents: [
        { role: "addressee", observerRef: "person_1", surface: "перевозчик" },
        { role: "topic", observerRef: "topic_1", surface: "вода" },
      ],
    };
    expect(validateTurnProposal(speechTopic).status).toBe("accepted");

    const noUtterance = {
      schemaVersion: 2,
      kind: "speech",
      primaryIntent: { kind: "speech", utterance: "", sourceText: "x" },
      supportingClauses: [],
      referents: [],
    };
    expect(validateTurnProposal(noUtterance).status).toBe("invalid");
  });

  it("enforces the closed meta registry", () => {
    for (const operation of ["repeat_last_answer", "explain_available_actions", "open_map_hint", "explain_interface"]) {
      expect(validateTurnProposal({
        schemaVersion: 2,
        kind: "meta",
        primaryIntent: { kind: "meta", operation, sourceText: "справка" },
        supportingClauses: [],
        referents: [],
      }).status).toBe("accepted");
    }
    expect(validateTurnProposal({
      schemaVersion: 2,
      kind: "meta",
      primaryIntent: { kind: "meta", operation: "delete_save", sourceText: "удали сохранение" },
      supportingClauses: [],
      referents: [],
    }).status).toBe("invalid");
  });

  it("accepts several supporting clauses and rejects too many", () => {
    const clauses = [
      { kind: "constraint", value: "тихо" },
      { kind: "manner", value: "внимательно" },
      { kind: "question", queryId: "visible_scene" },
      { kind: "deferred_action", summary: "осмотреть двор" },
    ];
    expect(validateTurnProposal({ ...actionProposal(), supportingClauses: clauses }).status).toBe("accepted");
    expect(validateTurnProposal({ ...actionProposal(), supportingClauses: [...clauses, ...clauses] }).status).toBe("invalid");
  });

  it("turns ambiguity into clarification with candidates as options", () => {
    const result = validateTurnProposal({
      ...actionProposal(),
      ambiguity: { kind: "referent", question: "Кого ты имеешь в виду?", candidates: ["перевозчик", "страж"] },
    });
    expect(result.status).toBe("clarification");
    if (result.status === "clarification") {
      expect(result.question).toBe("Кого ты имеешь в виду?");
      expect(result.options.map((option) => option.label)).toEqual(["перевозчик", "страж"]);
    }
  });

  it("rejects null primary without ambiguity", () => {
    expect(validateTurnProposal({
      schemaVersion: 2,
      kind: "action",
      primaryIntent: null,
      supportingClauses: [],
      referents: [],
    }).status).toBe("invalid");
  });

  it("enforces target valency for required and forbidden operations", () => {
    const touchNoTarget = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "touch", sourceText: "тронуть" },
      supportingClauses: [],
      referents: [],
    };
    expect(validateTurnProposal(touchNoTarget).status).toBe("invalid");

    const ambientObserve = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваюсь" },
      supportingClauses: [],
      referents: [],
    };
    expect(validateTurnProposal(ambientObserve).status).toBe("accepted");

    const waitWithTarget = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "wait", sourceText: "ждать" },
      supportingClauses: [],
      target: { role: "target", surface: "реку" },
      referents: [],
    };
    expect(validateTurnProposal(waitWithTarget).status).toBe("invalid");
  });

  it("rejects undeclared or mismatched referents", () => {
    expect(validateTurnProposal({
      ...actionProposal(),
      target: { role: "target", observerRef: "object_9", surface: "реку" },
    }).status).toBe("invalid");
    expect(validateTurnProposal({
      ...actionProposal(),
      target: { role: "target", observerRef: "object_1", surface: "озеро" },
    }).status).toBe("invalid");
  });

  it("rejects kind/primary mismatches and wrong referent roles", () => {
    expect(validateTurnProposal({
      ...actionProposal(),
      kind: "inquiry",
    }).status).toBe("invalid");
    expect(validateTurnProposal({
      ...actionProposal(),
      kind: "mixed",
    }).status).toBe("invalid");
    expect(validateTurnProposal({
      ...actionProposal(),
      target: { role: "topic", observerRef: "object_1", surface: "реку" },
    }).status).toBe("invalid");
  });

  it("rejects non-V2 input shapes", () => {
    expect(parseTurnProposal(null)).toBeNull();
    expect(parseTurnProposal("text")).toBeNull();
    expect(parseTurnProposal([])).toBeNull();
    expect(parseTurnProposal({ schemaVersion: 1, kind: "action" })).toBeNull();
    expect(validateTurnProposal({ schemaVersion: 1, kind: "action" }).status).toBe("invalid");
  });

  it("accepts an optional conversationRelation within the closed set", () => {
    for (const relation of ["continuation", "new_topic", "cancel_pending"]) {
      const result = validateTurnProposal({ ...actionProposal(), conversationRelation: relation });
      expect(result.status).toBe("accepted");
      if (result.status === "accepted") expect(result.proposal.conversationRelation).toBe(relation);
    }
    expect(parseTurnProposal({ ...actionProposal(), conversationRelation: "maybe" })).toBeNull();
    expect(validateTurnProposal({ ...actionProposal(), conversationRelation: "maybe" }).status).toBe("invalid");
    expect(parseTurnProposal({ ...actionProposal(), conversationRelation: 1 })).toBeNull();
  });

  it("rejects a hostile model payload before any command mapping", () => {
    const hostile = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осмотри башню" },
      supportingClauses: [],
      target: { role: "target", surface: "secret_location", entityId: "hidden_tower" },
      referents: [],
      success: true,
      difficulty: 3,
      events: ["DoorOpened"],
      consequence: "collapse",
    };
    expect(parseTurnProposal(hostile)).toBeNull();
    const result = validateTurnProposal(hostile);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.reason).toMatch(/authority/);
    expect(findAuthorityField(hostile)).not.toBeNull();
  });
});
