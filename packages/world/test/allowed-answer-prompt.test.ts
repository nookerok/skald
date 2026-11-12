import { describe, expect, it } from "vitest";
import { buildAllowedNarrativeFacts } from "../src/allowed-narrative-facts.js";
import { buildAllowedAnswerMessages, verifyAllowedNarration } from "../src/narrative-llm.js";

describe("buildAllowedAnswerMessages", () => {
  it("uses the production closed-facts policy and serializes only allowed facts", () => {
    const allowed = buildAllowedNarrativeFacts({
      question: "Что у переправы?",
      extraFacts: [{
        content: "У переправы стоит деревянная лодка.",
        provenance: "observation",
        assertion: "observed",
      }],
      mandatory: ["У переправы стоит деревянная лодка."],
    });

    const messages = buildAllowedAnswerMessages(allowed);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Нельзя добавлять сведения");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("У переправы стоит деревянная лодка.");
    expect(messages[1]?.content).not.toContain("sourceEventIds");
    expect(Object.isFrozen(messages)).toBe(true);
    expect(messages.every((message) => Object.isFrozen(message))).toBe(true);
  });

  it("keeps the same verifier as the production narration path", () => {
    const allowed = buildAllowedNarrativeFacts({
      extraFacts: [{
        content: "У переправы стоит деревянная лодка.",
        provenance: "observation",
        assertion: "observed",
      }],
      mandatory: ["У переправы стоит деревянная лодка."],
    });

    expect(buildAllowedAnswerMessages(allowed)[0]?.content).toContain("Поле ref обязательно");
    expect(verifyAllowedNarration(
      JSON.stringify({
        narration: "У переправы стоит деревянная лодка.",
        claims: [{ text: "У переправы стоит деревянная лодка.", ref: "f1", assertion: "observed" }],
        coveredMandatory: ["У переправы стоит деревянная лодка."],
      }),
      allowed,
    ).ok).toBe(true);
  });
});
