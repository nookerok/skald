/**
 * Conversation turn DTO (T3-fix): a read-side answer that contains a Latin
 * character name is not "internal text" and must not be replaced by the
 * generic fallback, while world-changing text is still scrubbed.
 */

import { describe, expect, it } from "vitest";
import { toConversationTurnDTO } from "../src/conversation/builder.js";

function turn(responseKind: string, responseText: string) {
  return {
    worldId: "w",
    turnSeq: 1,
    correlationId: "conversation:x",
    idempotencyKey: "x",
    requestHash: "h",
    playerText: "вопрос",
    inputClass: responseKind === "inquiry_answer" ? "inquiry" : "action",
    worldTimeBefore: 0,
    worldTimeAfter: 0,
    responseKind,
    responseText,
    contextMetadata: null,
    createdAt: 1,
  } as never;
}

describe("conversation turn DTO", () => {
  it("keeps a read-side answer that contains a Latin name", () => {
    const answer = "Ты — Score-abc. Твоя предыстория: Изгнанник с северной дороги.";
    expect(toConversationTurnDTO(turn("inquiry_answer", answer)).responseText).toBe(answer);
    expect(toConversationTurnDTO(turn("meta_answer", answer)).responseText).toBe(answer);
  });
  it("still scrubs world-changing text that looks internal", () => {
    expect(toConversationTurnDTO(turn("action_outcome", "Ты видишь object_1 поблизости.")).responseText).not.toContain("object_1");
  });
});
