/**
 * Conversation Director contract tests (SKALD S0 / P0).
 */

import { describe, expect, it } from "vitest";
import {
  GM_CONTRACT_VERSION,
  supportedOperations,
  validateGmTurnDecision,
  type GmContext,
} from "@skald/intent-parser";

const scene = { locationDescription: "Переправа", worldTime: "0", sceneEngagement: null };
const context: GmContext = {
  schemaVersion: GM_CONTRACT_VERSION,
  scene,
  actors: [],
  recentTurns: [],
  pendingQuestion: null,
  knownFacts: [],
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

  it("accepts an npc decision with a visible handle", () => {
    const result = validateGmTurnDecision({ ...base, addressee: { kind: "npc", handle: "e1" }, kind: "conversation" }, { allowedHandles: ["e1"] });
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
