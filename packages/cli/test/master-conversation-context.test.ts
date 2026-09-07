import { describe, expect, it } from "vitest";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import type { ConversationTurn } from "../src/conversation/types.js";

function row(turnSeq: number, overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnSeq,
    worldId: "w1",
    correlationId: `c${turnSeq}`,
    idempotencyKey: `k${turnSeq}`,
    playerText: "осматриваюсь",
    inputClass: "action",
    worldTimeBefore: 0,
    worldTimeAfter: 1,
    responseKind: "action_outcome",
    responseText: "Описание сцены.",
    createdAt: turnSeq,
    ...overrides,
  };
}

describe("master conversation context", () => {
  it("builds an empty context from no rows", () => {
    expect(buildMasterConversationContext([], "w1")).toEqual({
      recentTurns: [],
      recentFocus: [],
      pendingClarification: null,
    });
  });

  it("keeps only the current world and sorts by turnSeq", () => {
    const context = buildMasterConversationContext([
      row(3, { playerText: "третья" }),
      row(1, { playerText: "первая", worldId: "other" }),
      row(2, { playerText: "вторая" }),
    ], "w1");

    expect(context.recentTurns.map((turn) => turn.text)).toEqual([
      "вторая", "Описание сцены.", "третья", "Описание сцены.",
    ]);
    expect(context.recentTurns.map((turn) => turn.turnSeq)).toEqual([2, 2, 3, 3]);
  });

  it("bounds the window to the last ten turns", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(index + 1, { playerText: `реплика ${index + 1}` }));
    const context = buildMasterConversationContext(rows, "w1");

    expect(context.recentTurns).toHaveLength(20);
    expect(context.recentTurns[0]).toMatchObject({ speaker: "player", text: "реплика 3", turnSeq: 3 });
  });

  it("truncates each replica to 500 characters", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "я".repeat(600), responseText: "м".repeat(600) }),
    ], "w1");

    expect(context.recentTurns[0]?.text).toHaveLength(500);
    expect(context.recentTurns[1]?.text).toHaveLength(500);
  });

  it("drops legacy fallback turns entirely", () => {
    const context = buildMasterConversationContext([
      row(1, { responseText: "Ты начинаешь действовать, но пока не видишь заметного результата." }),
    ], "w1");

    expect(context.recentTurns).toEqual([]);
    expect(context.recentFocus).toEqual([]);
  });

  it("drops technical master texts without inventing facts", () => {
    const context = buildMasterConversationContext([
      row(1, { responseKind: "clarification", inputClass: "clarification", responseText: "proposal does not match schema: unknown operation" }),
    ], "w1");

    expect(context.recentTurns).toEqual([]);
    expect(context.pendingClarification).toBeNull();
  });

  it("extracts target focus from accepted actions", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "осматриваю реку" }),
    ], "w1");

    expect(context.recentFocus).toEqual([{ kind: "target", surface: "реку", turnSeq: 1 }]);
  });

  it("extracts destination focus from accepted journeys", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "иду к Речной Страже" }),
    ], "w1");

    expect(context.recentFocus).toHaveLength(1);
    expect(context.recentFocus[0]?.surface.toLowerCase()).toContain("страж");
  });

  it("takes no focus from rejections and inquiries", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "тронуть", responseKind: "action_rejection", responseText: "Не получилось." }),
      row(2, { playerText: "где я?", inputClass: "inquiry", responseKind: "inquiry_answer", responseText: "У реки." }),
    ], "w1");

    expect(context.recentFocus).toEqual([]);
  });

  it("orders focus most-recent-first and deduplicates surfaces", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "осматриваю реку" }),
      row(2, { playerText: "слушаю" }),
      row(3, { playerText: "осматриваю реку" }),
    ], "w1");

    expect(context.recentFocus).toEqual([{ kind: "target", surface: "реку", turnSeq: 3 }]);
  });

  it("caps focus at eight hints", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1, { playerText: `осматриваю предмет${index}` }));
    const context = buildMasterConversationContext(rows, "w1");

    expect(context.recentFocus).toHaveLength(8);
    expect(context.recentFocus[0]?.turnSeq).toBe(10);
  });

  it("reports the latest clarification as pending", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "сделать что-нибудь", inputClass: "clarification", responseKind: "clarification", responseText: "Что именно сделать?" }),
    ], "w1");

    expect(context.pendingClarification).toEqual({ question: "Что именно сделать?", options: [], turnSeq: 1 });
  });

  it("clears pending once an action or inquiry is accepted", () => {
    const clarified = row(1, { playerText: "сделать что-нибудь", inputClass: "clarification", responseKind: "clarification", responseText: "Что именно сделать?" });
    expect(buildMasterConversationContext([clarified, row(2)], "w1").pendingClarification).toBeNull();
    expect(buildMasterConversationContext([
      clarified,
      row(2, { playerText: "где я?", inputClass: "inquiry", responseKind: "inquiry_answer", responseText: "У реки." }),
    ], "w1").pendingClarification).toBeNull();
  });

  it("keeps the newest clarification when several are open", () => {
    const context = buildMasterConversationContext([
      row(1, { inputClass: "clarification", responseKind: "clarification", responseText: "Первый вопрос?" }),
      row(2, { inputClass: "clarification", responseKind: "clarification", responseText: "Второй вопрос?" }),
    ], "w1");

    expect(context.pendingClarification).toEqual({ question: "Второй вопрос?", options: [], turnSeq: 2 });
  });

  it("is deterministic across reloads and input order", () => {
    const rows = [
      row(1, { playerText: "осматриваю реку" }),
      row(2, { inputClass: "clarification", responseKind: "clarification", responseText: "Что именно?" }),
    ];
    const first = JSON.stringify(buildMasterConversationContext(rows, "w1"));
    const reordered = JSON.stringify(buildMasterConversationContext([...rows].reverse(), "w1"));
    const reloaded = JSON.stringify(buildMasterConversationContext(rows.map((turn) => ({ ...turn })), "w1"));

    expect(reordered).toBe(first);
    expect(reloaded).toBe(first);
  });

  it("takes focus from executed mixed turns like actions", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "осматриваю реку", inputClass: "mixed", responseKind: "mixed_outcome", responseText: "Подошёл. Вижу реку." }),
    ], "w1");

    expect(context.recentFocus).toEqual([{ kind: "target", surface: "реку", turnSeq: 1 }]);
  });

  it("resolves pending clarification on mixed and speech turns", () => {
    const clarified = row(1, { playerText: "сделай что-нибудь", inputClass: "clarification", responseKind: "clarification", responseText: "Что именно сделать?" });
    expect(buildMasterConversationContext([
      clarified,
      row(2, { playerText: "подхожу и смотрю", inputClass: "mixed", responseKind: "mixed_outcome", responseText: "Подошёл." }),
    ], "w1").pendingClarification).toBeNull();
    expect(buildMasterConversationContext([
      clarified,
      row(2, { playerText: "прошу о помощи", inputClass: "speech", responseKind: "speech_reaction", responseText: "Кивает." }),
    ], "w1").pendingClarification).toBeNull();
  });

  it("carries player text verbatim as untrusted data", () => {
    const tricky = "осмотри реку'; DROP TABLE--";
    const context = buildMasterConversationContext([row(1, { playerText: tricky })], "w1");

    expect(context.recentTurns[0]?.text).toBe(tricky);
  });
});
