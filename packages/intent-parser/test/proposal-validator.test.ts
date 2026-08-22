import { describe, it, expect } from "vitest";
import { validateActionProposal } from "../src/intent-proposal-validator.js";
import type { ActionIntentCommand, InteractionCommand, JourneyIntent } from "../src/types.js";

function interaction(verb: string, target?: string): InteractionCommand {
  return {
    type: "InteractionCommand",
    verb: verb as InteractionCommand["verb"],
    target: target ? { raw: target } : undefined,
    rawText: target ? verb + " " + target : verb,
    interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
  };
}

describe("validateActionProposal", () => {
  it("accepts ambient observation and listening", () => {
    expect(validateActionProposal(interaction("observe")).ok).toBe(true);
    expect(validateActionProposal(interaction("listen")).ok).toBe(true);
  });

  it("accepts a concrete target", () => {
    expect(validateActionProposal(interaction("observe", "реку")).ok).toBe(true);
    expect(validateActionProposal(interaction("close", "дверь")).ok).toBe(true);
  });

  it("rejects a required target that is missing", () => {
    const result = validateActionProposal(interaction("touch"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing_target");
      expect(result.clarification).toContain("тронуть");
    }
  });

  it("rejects an unregistered verb", () => {
    const result = validateActionProposal(interaction("fly"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_structure");
  });

  it("rejects punctuation-only targets", () => {
    const result = validateActionProposal(interaction("observe", "..."));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed_target");
  });

  it("does not reject an ordinary word that resembles a verb ending", () => {
    expect(validateActionProposal(interaction("observe", "юсь")).ok).toBe(true);
    expect(validateActionProposal(interaction("observe", "ем")).ok).toBe(true);
  });

  it("rejects a compound action but permits coordinated targets", () => {
    const compound = { ...interaction("observe"), rawText: "осматриваюсь и иду к реке" };
    expect(validateActionProposal(compound).ok).toBe(false);
    expect(validateActionProposal({ ...interaction("observe", "река и берег"), rawText: "осмотреть река и берег" }).ok).toBe(true);
  });

  it("validates journeys without resolving their destination", () => {
    const journey: JourneyIntent = {
      type: "JourneyIntent",
      destination: { raw: "Речной Страж" },
      rawText: "иду к Речному Стражу",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    expect(validateActionProposal(journey).ok).toBe(true);
  });

  it("rejects an empty journey destination", () => {
    const journey: JourneyIntent = {
      type: "JourneyIntent",
      destination: { raw: "..." },
      rawText: "иду",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    const result = validateActionProposal(journey);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_target");
  });

  it("keeps non-canonical legacy operations compatible", () => {
    const wait: ActionIntentCommand = {
      type: "ActionIntentCommand",
      mode: "wait",
      operation: "wait",
      rawText: "жду",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    expect(validateActionProposal(wait).ok).toBe(true);
  });
});
