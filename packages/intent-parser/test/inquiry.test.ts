import { describe, expect, it } from "vitest";
import { classifyPlayerInput, parseIntent } from "@skald/intent-parser";

describe("player input inquiry classification", () => {
  it.each([
    ["где я?", "current_location"],
    ["что я вижу?", "visible_scene"],
    ["что я слышу?", "auditory_scene"],
    ["кто я?", "character_identity"],
    ["что я знаю об этом месте?", "known_place_knowledge"],
    ["куда можно пойти?", "available_routes"],
    ["что произошло?", "recent_events"],
    ["что у меня с собой?", "inventory"],
    ["с кем я знаком?", "known_contacts"],
    ["почему карта показывает это место?", "map_position"],
  ] as const)("maps %j to %s", (input, queryId) => {
    const result = classifyPlayerInput(input, parseIntent);
    expect(result.kind).toBe("inquiry");
    expect(result.kind === "inquiry" ? result.inquiry.queryId : null).toBe(queryId);
  });

  it("accepts a direct question without a question mark", () => {
    const result = classifyPlayerInput("где я", parseIntent);
    expect(result).toMatchObject({ kind: "inquiry", inquiry: { queryId: "current_location", confidence: 1 } });
  });

  it("does not turn an addressed NPC question into a Master inquiry", () => {
    const result = classifyPlayerInput("Спроси перевозчика, где дорога?", parseIntent);
    expect(result.kind).toBe("speech");
    expect(result.kind === "speech" ? result.intent : null).toMatchObject({ type: "ActionIntentCommand", operation: "speak" });
  });

  it("marks an unknown question for the validated LLM inquiry path", () => {
    const result = classifyPlayerInput("что это за след?", parseIntent);
    expect(result).toEqual({ kind: "inquiry_candidate", rawText: "что это за след?" });
  });
});
