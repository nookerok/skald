import { describe, expect, it } from "vitest";
import { bindGmProposal, parseGmProposal, validateGmTurnDecision } from "@skald/intent-parser";

const handle = "e0123456789ab";
const proposal = {
  schemaVersion: 2, kind: "action",
  primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к человеку" },
  target: { role: "target", observerRef: handle, surface: "человеку" },
  supportingClauses: [], referents: [],
};
describe("opaque Director proposals", () => {
  it("checks the existing closed schema and binds handles without rewriting surfaces", () => {
    const parsed = parseGmProposal(proposal, [handle]);
    expect(parsed).toEqual(proposal);
    const bound = bindGmProposal(parsed!, new Map([[handle, "person_3"]]));
    expect(bound?.target).toEqual({ role: "target", observerRef: "person_3", surface: "человеку" });
    expect(proposal.target.observerRef).toBe(handle);
  });
  it("fails closed on fabricated, internal-looking or stale refs and extra authority", () => {
    expect(parseGmProposal(proposal, [])).toBeNull();
    expect(parseGmProposal({ ...proposal, target: { ...proposal.target, observerRef: "person_3" } }, ["person_3"])).toBeNull();
    expect(bindGmProposal(proposal as never, new Map())).toBeNull();
    expect(parseGmProposal({ ...proposal, success: true }, [handle])).toBeNull();
    expect(parseGmProposal(JSON.parse(JSON.stringify(proposal).replace('"referents":[]', '"referents":[],"__proto__":{"success":true}')), [handle])).toBeNull();
  });
  it("binds question group members and rejects an invisible group member", () => {
    const question = {
      schemaVersion: 2, kind: "inquiry", primaryIntent: { kind: "inquiry", queryId: "who_is_nearby", sourceText: "Кто они?" },
      supportingClauses: [], referents: [],
      questionPlan: {
        subjects: [{ id: "people", kind: "group", surface: "они", members: [handle] }],
        parts: [{ id: "appearance", subjectRefs: ["people"], aspect: "appearance", time: "current", purpose: "describe" }],
      },
      readings: [{ partId: "appearance", source: "person" }],
    };
    expect(parseGmProposal(question, [handle])).not.toBeNull();
    expect(bindGmProposal(question as never, new Map([[handle, "person_2"]]))?.questionPlan?.subjects[0]).toMatchObject({ members: ["person_2"] });
    expect(parseGmProposal(question, [])).toBeNull();
  });
});
describe("Director live payload", () => {
  const base = { schemaVersion: 2, kind: "conversation", addressee: { kind: "gm" } };
  it("accepts one-call social/fact drafts, not arbitrary prose or unknown facts", () => {
    const response = { segments: [{ kind: "social", act: "greeting" }, { kind: "fact", factId: "k1" }] };
    expect(validateGmTurnDecision({ ...base, response }, { allowedFactIds: ["k1"] }).ok).toBe(true);
    expect(validateGmTurnDecision({ ...base, response }).ok).toBe(false);
    for (const segment of [{ kind: "social", act: ["greeting"] }, { kind: "social", act: "greeting", text: "Проход разрешён." }]) {
      expect(validateGmTurnDecision({ ...base, response: { segments: [segment] } }).ok).toBe(false);
    }
  });
  it("does not promote player knowledge into NPC knowledge or accept objects as speakers", () => {
    expect(validateGmTurnDecision({
      ...base, addressee: { kind: "npc", handle },
      response: { segments: [{ kind: "fact", factId: "k1" }] },
    }, { allowedHandles: [handle], allowedFactIds: ["k1"] }).ok).toBe(false);
    expect(validateGmTurnDecision({
      ...base, addressee: { kind: "npc", handle },
    }, { allowedHandles: [handle], allowedActorHandles: [] }).ok).toBe(false);
  });
  it("keeps v1 classification compatible, but requires v2 for live payloads", () => {
    expect(validateGmTurnDecision({ schemaVersion: 1, kind: "conversation", addressee: { kind: "gm" } }).ok).toBe(true);
    expect(validateGmTurnDecision({ schemaVersion: 1, kind: "conversation", addressee: { kind: "gm" },
      response: { segments: [{ kind: "social", act: "greeting" }] } }).ok).toBe(false);
  });
  it("accepts only an agreed action/mixed/inquiry proposal kind", () => {
    expect(validateGmTurnDecision({ ...base, kind: "action", proposal }, { allowedHandles: [handle] }).ok).toBe(true);
    expect(validateGmTurnDecision({ ...base, proposal }, { allowedHandles: [handle] }).ok).toBe(false);
  });
});
