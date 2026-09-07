import { describe, expect, it } from "vitest";
import { composeMasterTurnResponse } from "../src/conversation/master-turn-response.js";
import type { MasterTurnResponseInput } from "../src/conversation/master-turn-response.js";

function input(overrides: Partial<MasterTurnResponseInput> = {}): MasterTurnResponseInput {
  return {
    kind: "action",
    actionPresentation: null,
    inquiryAnswer: null,
    speechReaction: null,
    metaAnswer: null,
    deferredClauses: [],
    clarification: null,
    ...overrides,
  };
}

describe("master turn response composer", () => {
  it("composes each turn kind", () => {
    expect(composeMasterTurnResponse(input({
      actionPresentation: { text: "Ты подходишь к ограде.", rejected: false },
    }))).toMatchObject({ kind: "action_outcome", text: "Ты подходишь к ограде.", sanitized: false });

    expect(composeMasterTurnResponse(input({
      kind: "inquiry",
      inquiryAnswer: { text: "Виден пустой двор." },
    }))).toMatchObject({ kind: "inquiry_answer", text: "Виден пустой двор." });

    expect(composeMasterTurnResponse(input({
      kind: "speech",
      speechReaction: { text: "Перевозчик кивает." },
    }))).toMatchObject({ kind: "speech_reaction", text: "Перевозчик кивает." });

    expect(composeMasterTurnResponse(input({
      kind: "meta",
      metaAnswer: { text: "Доступно: осмотреться, подойти, спросить." },
    }))).toMatchObject({ kind: "meta_answer" });

    const clarification = composeMasterTurnResponse(input({
      clarification: { question: "Что именно сделать?", options: [{ optionId: "rephrase", label: "Уточнить" }] },
    }));
    expect(clarification).toMatchObject({ kind: "clarification", text: "Что именно сделать?" });
    expect(clarification.options).toEqual([{ optionId: "rephrase", label: "Уточнить" }]);
  });

  it("orders mixed answers as outcome, knowledge, undone part", () => {
    const response = composeMasterTurnResponse(input({
      kind: "mixed",
      actionPresentation: { text: "Ты подходишь к ограде.", rejected: false },
      inquiryAnswer: { text: "За жердями виден пустой двор." },
      deferredClauses: [{ text: "осмотреть двор", reason: "secondary_action" }],
    }));

    expect(response.kind).toBe("mixed_outcome");
    expect(response.text).toBe(
      "Ты подходишь к ограде. За жердями виден пустой двор. Пока осталось невыполненным: осмотреть двор.",
    );
    expect(response.options).toEqual([]);
  });

  it("keeps rejected actions inside mixed answers", () => {
    const response = composeMasterTurnResponse(input({
      kind: "mixed",
      actionPresentation: { text: "Подойти не вышло.", rejected: true },
      inquiryAnswer: { text: "Со своего места видно немногое." },
      deferredClauses: [],
    }));

    expect(response.kind).toBe("mixed_outcome");
    expect(response.text).toBe("Подойти не вышло. Со своего места видно немногое.");
  });

  it("omits the undone note without deferred clauses", () => {
    const response = composeMasterTurnResponse(input({
      kind: "mixed",
      actionPresentation: { text: "Ты подходишь к ограде.", rejected: false },
      inquiryAnswer: { text: "Виден двор." },
      deferredClauses: [],
    }));

    expect(response.text).toBe("Ты подходишь к ограде. Виден двор.");
  });

  it("scrubs every forbidden marker into a safe fallback", () => {
    const markers = [
      "operation unknown",
      "model confidence 0.5",
      "see observerRef person_1",
      "bad schema here",
      "with additionalClauses",
      "одна цель и одно действие",
      "validateActionProposal failed",
      "entityId hidden_tower",
    ];
    for (const marker of markers) {
      const response = composeMasterTurnResponse(input({
        actionPresentation: { text: `Ты действуешь, ${marker}.`, rejected: false },
      }));
      expect(response.sanitized).toBe(true);
      expect(response.text).not.toContain(marker);
    }
  });

  it("keeps honest Russian prose untouched", () => {
    const response = composeMasterTurnResponse(input({
      kind: "mixed",
      actionPresentation: { text: "Ты подходишь к ограде.", rejected: false },
      inquiryAnswer: { text: "Схема двора проста: забор, сарай, плеск воды." },
      deferredClauses: [],
    }));

    expect(response.sanitized).toBe(false);
    expect(response.text).toContain("Схема двора");
  });

  it("falls back to clarification instead of empty answers", () => {
    for (const partial of [
      input({ kind: "action" }),
      input({ kind: "inquiry" }),
      input({ kind: "speech" }),
      input({ kind: "meta" }),
      input({ kind: "mixed" }),
    ]) {
      const response = composeMasterTurnResponse(partial);
      expect(response.kind).toBe("clarification");
      expect(response.text.length).toBeGreaterThan(0);
    }
  });

  it("freezes the composed response", () => {
    const response = composeMasterTurnResponse(input({
      actionPresentation: { text: "Ты действуешь.", rejected: false },
    }));

    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.options)).toBe(true);
  });
});
