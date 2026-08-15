import { describe, expect, it } from "vitest";
import { INTENT_CAPABILITIES, parseIntentProposal, validateIntentProposal } from "@skald/intent-parser";

describe("IntentProposalV1", () => {
  it("maps a journey proposal to an existing JourneyIntent", () => {
    const result = validateIntentProposal({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня", routeHint: "с запада" },
    }, "обхожу башню с запада");

    expect(result).toEqual({
      status: "accepted",
      intent: {
        type: "JourneyIntent",
        destination: { raw: "башня" },
        routeHint: { raw: "с запада" },
        rawText: "обхожу башню с запада",
        interpretation: { source: "llm", confidence: 1, ambiguities: [] },
      },
    });
  });

  it("requires clarification instead of dropping an additional action", () => {
    const result = validateIntentProposal({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня" },
      additionalClauses: [{ kind: "interaction", summary: "наблюдать за огнями" }],
    }, "идти к башне и наблюдать за огнями");

    expect(result.status).toBe("clarification");
  });

  it("rejects model authority fields and unknown verbs", () => {
    expect(parseIntentProposal({
      schemaVersion: 1,
      primary: { kind: "interaction", verb: "inspect", target: "дверь" },
      success: true,
    })).toBeNull();

    expect(validateIntentProposal({
      schemaVersion: 1,
      primary: { kind: "interaction", verb: "cast_spell", target: "дверь" },
    }, "заколдовать дверь")).toEqual({
      status: "invalid",
      reason: "proposal primary intent is incomplete or unsupported",
    });
  });

  it("does not allow event ids, control characters, or oversized text", () => {
    expect(parseIntentProposal({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня", locationId: "hidden" },
    })).toBeNull();
    expect(parseIntentProposal({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня\u0000" },
    })).toBeNull();
    expect(parseIntentProposal({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "x".repeat(241) },
    })).toBeNull();
  });

  it("clarifies low-confidence model proposals and preserves confidence", () => {
    expect(validateIntentProposal({
      schemaVersion: 1,
      primary: { kind: "interaction", verb: "observe" },
      modelConfidence: 0.5,
    }, "look around").status).toBe("clarification");
    const accepted = validateIntentProposal({
      schemaVersion: 1,
      primary: { kind: "interaction", verb: "observe" },
      modelConfidence: 0.8,
    }, "look around");
    expect(accepted.status === "accepted" && accepted.intent.interpretation.confidence).toBe(0.8);
  });

  it("keeps a finite capability manifest", () => {
    expect(INTENT_CAPABILITIES.onePrimaryIntentOnly).toBe(true);
    expect(INTENT_CAPABILITIES.interactionVerbs).toHaveLength(10);
  });
});
