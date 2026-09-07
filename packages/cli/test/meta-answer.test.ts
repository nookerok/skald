import { describe, expect, it } from "vitest";
import { answerMetaRequest } from "../src/conversation/meta-answer.js";
import { composeMasterTurnResponse } from "../src/conversation/master-turn-response.js";
import type { TurnMetaOperation } from "@skald/intent-parser";

const TURNS = [
  { speaker: "player", text: "осматриваюсь", turnSeq: 1 },
  { speaker: "master", text: "Виден двор.", turnSeq: 1 },
  { speaker: "player", text: "слушаю", turnSeq: 2 },
  { speaker: "master", text: "Слышен плеск.", turnSeq: 2 },
] as const;

describe("closed meta answers", () => {
  it("repeats the last master answer verbatim", () => {
    const answer = answerMetaRequest("repeat_last_answer", { recentTurns: [...TURNS] });

    expect(answer).toEqual({ text: "Слышен плеск." });
    expect(Object.isFrozen(answer)).toBe(true);
  });

  it("honestly reports an empty transcript", () => {
    expect(answerMetaRequest("repeat_last_answer", { recentTurns: [] }).text).not.toHaveLength(0);
  });

  it("explains available actions from the closed registry", () => {
    const { text } = answerMetaRequest("explain_available_actions", { recentTurns: [] });

    for (const verb of ["observe", "journey", "wait", "speak"]) {
      expect(text).toContain(verb);
    }
    expect(text).not.toMatch(/entityId|eventId|diagnostic|admin|deploy/i);
  });

  it("hints the map and the interface with verified UI wording", () => {
    expect(answerMetaRequest("open_map_hint", { recentTurns: [] }).text).toContain("Карта");
    const help = answerMetaRequest("explain_interface", { recentTurns: [] }).text;
    expect(help).toContain("Enter");
    expect(help).toContain("МАСТЕР");
  });

  it("refuses unknown operations without any execution channel", () => {
    const answer = answerMetaRequest("delete_save" as TurnMetaOperation, { recentTurns: [...TURNS] });

    expect(Object.keys(answer)).toEqual(["text"]);
    expect(answer.text).not.toMatch(/delete|deploy|admin|настро/i);
  });

  it("is pure over its inputs", () => {
    const context = { recentTurns: [...TURNS] };
    const before = JSON.stringify(context);
    const first = answerMetaRequest("repeat_last_answer", context);
    const second = answerMetaRequest("repeat_last_answer", context);

    expect(second).toEqual(first);
    expect(JSON.stringify(context)).toBe(before);
  });

  it("feeds the meta composer without sanitization trips", () => {
    const meta = answerMetaRequest("explain_available_actions", { recentTurns: [] });
    const response = composeMasterTurnResponse({
      kind: "meta",
      actionPresentation: null,
      inquiryAnswer: null,
      speechReaction: null,
      metaAnswer: { text: meta.text },
      deferredClauses: [],
      clarification: null,
    });

    expect(response.kind).toBe("meta_answer");
    expect(response.sanitized).toBe(false);
  });
});
