import { describe, it, expect } from "vitest";
import { attachTurnNarrations } from "../src/journal/index.js";
import type { JournalTurn } from "../src/journal/types.js";
import type { TurnNarration } from "../src/narrative-llm.js";

function turn(worldTime: number): JournalTurn {
  return {
    turnId: `turn:${worldTime}`,
    worldTime,
    sourceEventIds: [],
    presentation: {
      primary: null, notable: [], background: [], suppressedEventCount: 0,
      worldTime, playerPosition: { x: 0, y: 0 },
    },
  };
}

const narration: TurnNarration = { text: "Тьма ответила шагом.", model: "m", usedFallback: false, fallbackReason: null, latencyMs: 50 };

describe("attachTurnNarrations", () => {
  it("attaches a stored non-fallback narration by worldTime", () => {
    const narrations = new Map<number, TurnNarration>([[3, narration]]);
    const out = attachTurnNarrations([turn(3), turn(4)], narrations);
    expect(out[0]!.narrativeLLM).toEqual(narration);
    expect(out[1]!.narrativeLLM).toBeUndefined();
  });

  it("never surfaces a fallback narration", () => {
    const narrations = new Map<number, TurnNarration>([[3, { ...narration, usedFallback: true }]]);
    const out = attachTurnNarrations([turn(3)], narrations);
    expect(out[0]!.narrativeLLM).toBeUndefined();
  });

  it("keeps the original turn immutable (no mutation)", () => {
    const original = turn(3);
    const narrations = new Map<number, TurnNarration>([[3, narration]]);
    const out = attachTurnNarrations([original], narrations);
    expect(original.narrativeLLM).toBeUndefined();
    expect(out[0]!.narrativeLLM).toBeDefined();
    expect(out[0] === original).toBe(false);
  });
});