import { describe, it, expect } from "vitest";
import { composeMasterTurnResponse } from "../src/conversation/master-turn-response.js";
import type { MasterTurnResponseInput } from "../src/conversation/master-turn-response.js";

function actionInput(overrides: Partial<MasterTurnResponseInput> = {}): MasterTurnResponseInput {
  return {
    kind: "action",
    actionPresentation: { text: "Ты прислушиваешься к воде.", rejected: false },
    inquiryAnswers: [],
    speechReaction: null,
    metaAnswer: null,
    deferredClauses: [],
    clarification: null,
    ...overrides,
  };
}

describe("composeMasterTurnResponse continuation hint (plan_9 §10)", () => {
  it("appends the hint when the answer does not move the game yet", () => {
    const response = composeMasterTurnResponse(actionInput({
      continuationHint: "Можно расспросить перевозчика.",
    }));
    expect(response.kind).toBe("action_outcome");
    expect(response.text).toBe("Ты прислушиваешься к воде. Можно расспросить перевозчика.");
  });
  it("keeps byte-identical output without a hint", () => {
    const response = composeMasterTurnResponse(actionInput());
    expect(response.text).toBe("Ты прислушиваешься к воде.");
  });
  it("leaves answers that already ask forward unchanged", () => {
    const response = composeMasterTurnResponse(actionInput({
      actionPresentation: { text: "Ты говоришь о перевозчике или об архивисте?", rejected: false },
      continuationHint: "Можно расспросить перевозчика.",
    }));
    expect(response.text).toBe("Ты говоришь о перевозчике или об архивисте?");
  });
  it("never touches clarification turns — the question leads", () => {
    const response = composeMasterTurnResponse({
      kind: "action",
      actionPresentation: null,
      inquiryAnswers: [],
      speechReaction: null,
      metaAnswer: null,
      deferredClauses: [],
      clarification: { question: "О ком ты говоришь?", options: [] },
      continuationHint: "Можно расспросить перевозчика.",
    });
    expect(response.kind).toBe("clarification");
    expect(response.text).toBe("О ком ты говоришь?");
  });
  it("carries momentum into mixed, inquiry, speech and meta answers", () => {
    const hint = "Можно проверить путь.";
    const mixed = composeMasterTurnResponse({
      ...actionInput({ kind: "mixed", inquiryAnswers: [{ text: "Вода поднялась." }] }),
      continuationHint: hint,
    });
    expect(mixed.text).toContain(hint);
    const inquiry = composeMasterTurnResponse({
      ...actionInput({ kind: "inquiry", actionPresentation: null, inquiryAnswers: [{ text: "Вода поднялась." }] }),
      continuationHint: hint,
    });
    expect(inquiry.text).toContain(hint);
    const speech = composeMasterTurnResponse({
      ...actionInput({ kind: "speech", actionPresentation: null, speechReaction: { text: "Перевозчик кивает." } }),
      continuationHint: hint,
    });
    expect(speech.text).toContain(hint);
    const meta = composeMasterTurnResponse({
      ...actionInput({ kind: "meta", actionPresentation: null, metaAnswer: { text: "Это справка." } }),
      continuationHint: hint,
    });
    expect(meta.text).toContain(hint);
  });
});
