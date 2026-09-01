import { describe, expect, it } from "vitest";
import { FixedNarrationProvider } from "../src/acceptance/fixed-narration-provider.js";

describe("FixedNarrationProvider", () => {
  it("returns the structured narration contract used by acceptance", async () => {
    const provider = new FixedNarrationProvider();
    const result = await provider.chat("narrate", [
      { role: "system", content: "narrate" },
      {
        role: "user",
        content: JSON.stringify({
          turnFacts: [{ text: "Вода у переправы поднялась.", epistemicClass: "observed_fact" }],
        }),
      },
    ]);

    expect(result.usedFallback).toBe(false);
    expect(JSON.parse(result.text)).toEqual({
      narration: "Вода у переправы поднялась.",
      claims: [{ text: "Вода у переправы поднялась.", sourceFactId: "primary", epistemicClass: "observed_fact" }],
    });
  });
});
