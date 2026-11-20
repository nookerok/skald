/**
 * Conversation Director contract tests (SKALD S0 / P0).
 */

import { describe, expect, it } from "vitest";
import {
  GM_CONTRACT_VERSION,
  GM_CONTEXT_VERSION,
  supportedOperations,
  validateGmTurnDecision,
  type GmContext,
} from "@skald/intent-parser";

const scene = { locationDescription: "Переправа", worldTime: "0", sceneEngagement: null };
const context: GmContext = {
  schemaVersion: GM_CONTEXT_VERSION,
  scene,
  actors: [],
  recentTurns: [],
  pendingQuestion: null,
  knownFacts: [],
  npcFacts: [],
  supportedOperations: supportedOperations(),
};

const base = { schemaVersion: GM_CONTRACT_VERSION, addressee: { kind: "gm" } };

describe("supportedOperations", () => {
  it("returns the closed interaction and legacy vocabularies", () => {
    const ops = supportedOperations();
    expect(ops.some((o) => o.verb === "observe" && o.kind === "interaction")).toBe(true);
    expect(ops.some((o) => o.verb === "approach" && o.kind === "legacy")).toBe(true);
    expect(ops.every((o) => typeof o.verb === "string" && o.verb.length > 0)).toBe(true);
  });
});

describe("validateGmTurnDecision — accepted", () => {
  it("accepts a gm conversation", () => {
    const result = validateGmTurnDecision({ ...base, kind: "conversation" });
    expect(result.ok).toBe(true);
  });

  it("accepts the closed player-gratitude acknowledgement act", () => {
    const result = validateGmTurnDecision({
      ...base,
      kind: "conversation",
      response: { segments: [{ kind: "social", act: "gratitude_acknowledgement" }] },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an npc decision with a visible handle", () => {
    const result = validateGmTurnDecision({ ...base, addressee: { kind: "npc", handle: "e1" }, kind: "conversation" }, { allowedHandles: ["e1"] });
    expect(result.ok).toBe(true);
  });

  it("accepts an NPC dossier fact only for its visible NPC addressee", () => {
    const result = validateGmTurnDecision({
      ...base,
      addressee: { kind: "npc", handle: "e1" },
      kind: "conversation",
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef" }] },
    }, {
      allowedActorHandles: ["e1", "e2"],
      allowedNpcFacts: [{ factId: "nf1234567890abcdef", subjectHandle: "e1" }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a clarification with candidate handles", () => {
    const result = validateGmTurnDecision({ ...base, kind: "clarification", clarification: { question: "Кого?", candidateHandles: ["e1", "e2"] } });
    expect(result.ok).toBe(true);
  });

  it("accepts an action classification without executable steps", () => {
    const result = validateGmTurnDecision({ ...base, kind: "action" });
    expect(result.ok).toBe(true);
  });
});

describe("validateGmTurnDecision — rejected", () => {
  const reject = (raw: unknown, needle: string) => {
    const result = validateGmTurnDecision(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain(needle);
  };

  it("rejects a non-object and a wrong version", () => {
    reject("nope", "not an object");
    reject({ ...base, schemaVersion: 999, kind: "conversation" }, "schemaVersion");
  });

  it("rejects unknown top-level fields", () => {
    reject({ ...base, kind: "conversation", extra: 1 }, "unknown field");
  });

  it("rejects an unknown addressee kind", () => {
    reject({ ...base, addressee: { kind: "alien" }, kind: "conversation" }, "addressee.kind");
  });

  it("rejects an invalid or invisible npc handle", () => {
    reject({ ...base, addressee: { kind: "npc", handle: "" }, kind: "conversation" }, "invalid handle");
    const invisible = validateGmTurnDecision({ ...base, addressee: { kind: "npc", handle: "e9" }, kind: "conversation" }, { allowedHandles: ["e1"] });
    expect(invisible.ok).toBe(false);
    if (!invisible.ok) expect(invisible.errors.join("\n")).toContain("not a visible actor");
  });

  it.each(["gm", "meta"])("rejects handles on the %s addressee variant, visible or fabricated", (kind) => {
    for (const schemaVersion of [1, GM_CONTRACT_VERSION]) for (const handle of ["e1", "fabricated-outside-scene"]) {
      const result = validateGmTurnDecision(
        { ...base, schemaVersion, addressee: { kind, handle }, kind: "world_question" },
        { allowedHandles: ["e1"] },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain('addressee: unknown field "handle"');
    }
  });

  it("rejects a fabricated clarification candidate against the scene allowlist", () => {
    // Visible candidates pass; one invisible candidate poisons the whole list.
    const visible = validateGmTurnDecision(
      { ...base, kind: "clarification", clarification: { question: "?", candidateHandles: ["e1"] } },
      { allowedHandles: ["e1", "e2"] },
    );
    expect(visible.ok).toBe(true);
    const fabricated = validateGmTurnDecision(
      { ...base, kind: "clarification", clarification: { question: "?", candidateHandles: ["e1", "e9"] } },
      { allowedHandles: ["e1", "e2"] },
    );
    expect(fabricated.ok).toBe(false);
    if (!fabricated.ok) expect(fabricated.errors.join("\n")).toContain("not a visible actor");
  });

  it("validates subjectHandle: visible topic on questions only", () => {
    // A question about a person: master responds, the person is the subject.
    const ok = validateGmTurnDecision(
      { ...base, addressee: { kind: "gm" }, kind: "world_question", subjectHandle: "e1" },
      { allowedHandles: ["e1", "e2"] },
    );
    expect(ok.ok).toBe(true);
    // Invisible subject is a fabricated actor.
    const invisible = validateGmTurnDecision(
      { ...base, addressee: { kind: "gm" }, kind: "world_question", subjectHandle: "e9" },
      { allowedHandles: ["e1"] },
    );
    expect(invisible.ok).toBe(false);
    if (!invisible.ok) expect(invisible.errors.join("\n")).toContain("subjectHandle");
    // A conversation or an action has no separate subject from its addressee.
    const wrongKind = validateGmTurnDecision({ ...base, kind: "conversation", subjectHandle: "e1" }, { allowedHandles: ["e1"] });
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.errors.join("\n")).toContain("subjectHandle");
  });

  it("rejects an unknown kind", () => {
    reject({ ...base, kind: "banana" }, "kind");
  });

  it("rejects arbitrary executable steps and requires clarification payload", () => {
    reject({ ...base, kind: "action", steps: [{ kind: "action", verb: "approach" }] }, "unknown field");
    reject({ ...base, kind: "action", steps: [{ kind: "action", verb: "approach", target: "person_1" }] }, "unknown field");
    reject({ ...base, kind: "clarification" }, "clarification: required");
    reject({ ...base, kind: "action", clarification: { question: "?" } }, "clarification");
  });

  it("rejects NPC fact ids when they are unknown, cross-NPC, or addressed to the GM", () => {
    const allowedNpcFacts = [{ factId: "nf1234567890abcdef", subjectHandle: "e1" }];
    const baseFact = { kind: "npc_fact", factId: "nf1234567890abcdef" };
    const unknown = validateGmTurnDecision({
      ...base, addressee: { kind: "npc", handle: "e1" }, kind: "conversation",
      response: { segments: [{ kind: "npc_fact", factId: "nf0000000000000000" }] },
    }, { allowedActorHandles: ["e1"], allowedNpcFacts });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.join("\n")).toContain("unknown NPC dossier fact");

    const crossNpc = validateGmTurnDecision({
      ...base, addressee: { kind: "npc", handle: "e2" }, kind: "conversation",
      response: { segments: [baseFact] },
    }, { allowedActorHandles: ["e1", "e2"], allowedNpcFacts });
    expect(crossNpc.ok).toBe(false);
    if (!crossNpc.ok) expect(crossNpc.errors.join("\n")).toContain("different actor");

    const gm = validateGmTurnDecision({
      ...base, kind: "conversation", response: { segments: [baseFact] },
    }, { allowedNpcFacts });
    expect(gm.ok).toBe(false);
    if (!gm.ok) expect(gm.errors.join("\n")).toContain("require an NPC addressee");

    const freeText = validateGmTurnDecision({
      ...base,
      addressee: { kind: "npc", handle: "e1" },
      kind: "conversation",
      response: { segments: [{ ...baseFact, text: "выдуманный ответ" }] },
    }, { allowedActorHandles: ["e1"], allowedNpcFacts });
    expect(freeText.ok).toBe(false);
    if (!freeText.ok) expect(freeText.errors.join("\n")).toContain("unknown field");
  });

  it("rejects an empty clarification question", () => {
    reject({ ...base, kind: "clarification", clarification: { question: "  " } }, "clarification.question");
  });

  it("records several errors at once", () => {
    const result = validateGmTurnDecision({ schemaVersion: 999, addressee: { kind: "alien" }, kind: "banana", nope: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("GmContext shape", () => {
  it("carries only observer-safe fields", () => {
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/targetRef|internalId|contactId|locationId/);
    expect(context.scene.sceneEngagement).toBeNull();
  });
});

describe("validateGmTurnDecision — conversation questionPlan (P3 multi-part)", () => {
  const allowedNpcFacts = [{ factId: "nf1234567890abcdef", subjectHandle: "e1" }];
  const npcBase = {
    schemaVersion: GM_CONTRACT_VERSION,
    addressee: { kind: "npc" as const, handle: "e1" },
    kind: "conversation" as const,
  };
  const plan = {
    subjects: [{ id: "s", surface: "перевозчик", kind: "entity" as const }],
    parts: [
      { id: "p1", subjectRefs: ["s"], aspect: "identity_role" as const, time: "current" as const, purpose: "describe" as const },
      { id: "p2", subjectRefs: ["s"], aspect: "current_activity" as const, time: "current" as const, purpose: "describe" as const },
    ],
    fragments: [
      { partId: "p1", text: "кто ты" },
      { partId: "p2", text: "чем ты занят" },
    ],
  };
  const options = { allowedActorHandles: ["e1"], allowedNpcFacts };

  it("accepts a multi-part question plan with per-part segment bindings", () => {
    const result = validateGmTurnDecision({
      ...npcBase,
      questionPlan: { ...plan, subjects: [{ ...plan.subjects[0]!, observerRef: "e1" }] },
      response: { segments: [
        { kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" },
        { kind: "social", act: "no_knowledge", partId: "p2" },
      ] },
    }, options);
    expect(result.ok).toBe(true);
  });

  it("accepts a social preamble segment alongside part-bound answers", () => {
    const result = validateGmTurnDecision({
      ...npcBase,
      questionPlan: plan,
      response: { segments: [
        { kind: "social", act: "greeting" },
        { kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" },
        { kind: "social", act: "no_knowledge", partId: "p2" },
      ] },
    }, options);
    expect(result.ok).toBe(true);
  });

  const rejectWith = (raw: unknown, message: string): void => {
    const result = validateGmTurnDecision(raw, options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain(message);
  };

  it("rejects a question plan outside the conversation kind", () => {
    rejectWith({ ...npcBase, kind: "world_question", questionPlan: plan }, "questionPlan: only allowed for conversation");
  });

  it("rejects a part without a verbatim fragment binding", () => {
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, fragments: [plan.fragments[0]] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "has no fragment");
  });

  it("rejects fragments with unknown, duplicate or malformed part bindings", () => {
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, fragments: [{ ...plan.fragments[0], partId: "missing" }, plan.fragments[1]] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "unknown partId");
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, fragments: [plan.fragments[0], plan.fragments[0]] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "duplicate partId");
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, fragments: [{ partId: "p1", text: "   " }, plan.fragments[1]] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "required 1..360 char text");
  });

  it("rejects an unclosed question vocabulary in the plan", () => {
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, parts: [{ ...plan.parts[0], aspect: "motivation" }, plan.parts[1]] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "invalid closed subjects/parts");
    // The rejection names the exact violated rule (sanitized counts/tokens).
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, parts: [{ ...plan.parts[0], aspect: "motivation" }, plan.parts[1]] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "aspectOutsideVocabulary");
    rejectWith({
      ...npcBase,
      questionPlan: {
        ...plan,
        parts: [
          { id: "px", subjectRefs: ["missing"], aspect: "identity_role", time: "current", purpose: "describe" },
          plan.parts[1]!,
        ],
      },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "danglingSubjectRefs=1");
  });

  it("rejects subject handles that are not visible actors in this scene", () => {
    // The model only ever receives opaque e-handles; a raw scene ref or a
    // fabricated handle is not an acceptable subject reference.
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, subjects: [{ ...plan.subjects[0]!, observerRef: "person_1" }] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "questionPlan.subject.observerRef: \"person_1\" is not a visible actor");
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, subjects: [{ ...plan.subjects[0]!, observerRef: "e9" }] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, 'questionPlan.subject.observerRef: "e9" is not a visible actor');
  });

  it("rejects segment part bindings without a plan or with an unknown part", () => {
    rejectWith({
      ...npcBase,
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, "partId requires a questionPlan");
    rejectWith({
      ...npcBase,
      questionPlan: plan,
      response: { segments: [
        { kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p9" },
        { kind: "social", act: "no_knowledge", partId: "p2" },
      ] },
    }, "unknown questionPlan partId");
  });

  it("rejects a part binding on player facts", () => {
    const result = validateGmTurnDecision({
      ...base,
      kind: "conversation",
      questionPlan: { ...plan, subjects: [{ id: "s", surface: "ты", kind: "entity" }] },
      response: { segments: [{ kind: "fact", factId: "k1", partId: "p1" }] },
    }, { allowedFactIds: ["k1"], allowedActorHandles: ["e1"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("partId is not allowed on player facts");
  });

  it("rejects unknown extra fields inside the plan and fragments", () => {
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, extra: 1 },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, 'questionPlan: unknown field "extra"');
    rejectWith({
      ...npcBase,
      questionPlan: { ...plan, fragments: [{ ...plan.fragments[0], source: "model" }, plan.fragments[1]] },
      response: { segments: [{ kind: "npc_fact", factId: "nf1234567890abcdef", partId: "p1" }] },
    }, 'questionPlan.fragment: unknown field "source"');
  });
});
