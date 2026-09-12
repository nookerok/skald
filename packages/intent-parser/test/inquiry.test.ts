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
    ["кто рядом?", "who_is_nearby"],
    ["кто находится рядом со мной?", "who_is_nearby"],
    ["есть ли кто-нибудь рядом?", "who_is_nearby"],
    ["хочу узнать, кто рядом.", "who_is_nearby"],
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

describe("spatial focus questions", () => {
  it("reads an explicit noun behind as focused visible scene", () => {
    const result = classifyPlayerInput("что за оградой?", parseIntent);
    expect(result.kind).toBe("inquiry");
    if (result.kind !== "inquiry") return;
    expect(result.inquiry.queryId).toBe("visible_scene");
    expect(result.inquiry.relation).toBe("behind");
    expect(result.inquiry.focus?.surface).toBe("оградой");
    expect(result.inquiry.focus?.observerRef).toBeUndefined();
    expect(result.inquiry.source).toBe("deterministic");
  });

  it("reads near and inside relations", () => {
    const near = classifyPlayerInput("что у реки?", parseIntent);
    expect(near.kind).toBe("inquiry");
    if (near.kind !== "inquiry") return;
    expect(near.inquiry.relation).toBe("near");
    expect(near.inquiry.focus?.surface).toBe("реки");

    const inside = classifyPlayerInput("что внутри сундука", parseIntent);
    expect(inside.kind).toBe("inquiry");
    if (inside.kind !== "inquiry") return;
    expect(inside.inquiry.relation).toBe("inside");
    expect(inside.inquiry.focus?.surface).toBe("сундука");
  });

  it("leaves pronoun focus to the contextual interpreter", () => {
    for (const input of ["а что за ней?", "что за ним?", "что за этим?"]) {
      expect(classifyPlayerInput(input, parseIntent).kind).toBe("inquiry_candidate");
    }
  });

  it("leaves punctuation-only focus to the candidate path", () => {
    expect(classifyPlayerInput("что за ...?", parseIntent).kind).toBe("inquiry_candidate");
  });
});
