import { describe, it, expect } from "vitest";
import {
  buildContinuationHint,
  ensureGameMomentum,
  hasGameMomentum,
} from "../src/game-director/continuation.js";
import type { GameDirectorContext } from "../src/game-director/context.js";

type DirectorSlice = Pick<
  GameDirectorContext,
  "journeyState" | "knownContacts" | "availableRoutes" | "accessibleItemsAndAffordances" | "pendingClarification"
>;

function base(overrides: Partial<DirectorSlice> = {}): DirectorSlice {
  return {
    journeyState: { status: "idle", from: null, to: null, elapsedTicks: 0, totalTicks: 0, text: "Путь начнётся." },
    knownContacts: [],
    availableRoutes: [],
    accessibleItemsAndAffordances: [],
    pendingClarification: null,
    ...overrides,
  };
}

describe("buildContinuationHint", () => {
  it("stays silent while a clarification is pending — the question leads", () => {
    expect(buildContinuationHint(base({
      pendingClarification: { question: "О ком ты говоришь?", options: [] },
      knownContacts: [{ label: "перевозчик" }],
    }))).toBeNull();
  });
  it("continues an active journey leg first", () => {
    expect(buildContinuationHint(base({
      journeyState: { status: "in_progress", from: "Переправа", to: "Речной Страж", elapsedTicks: 1, totalTicks: 2, text: "Ты в пути." },
    }))).toBe("Можно продолжить путь к «Речной Страж» или осмотреться перед следующим переходом.");
  });
  it("offers departure for a planned journey", () => {
    expect(buildContinuationHint(base({
      journeyState: { status: "planned", from: "Переправа", to: "Речной Страж", elapsedTicks: 0, totalTicks: 2, text: "Путь намечен." },
    }))).toBe("Можно отправиться в путь к «Речной Страж» или сначала расспросить местных.");
  });
  it("names the obstacle instead of an ongoing path", () => {
    expect(buildContinuationHint(base({
      journeyState: { status: "blocked", from: "Переправа", to: "Речной Страж", elapsedTicks: 2, totalTicks: 2, text: "Путь к «Речной Страж» перекрыт." },
    }))).toBe("Путь к «Речной Страж» перекрыт. Можно поискать обход или переждать.");
  });
  it("combines a known contact with a known route", () => {
    expect(buildContinuationHint(base({
      knownContacts: [{ label: "перевозчик" }],
      availableRoutes: [{ label: "Речной Страж", status: "open" }],
    }))).toBe("Можно расспросить перевозчик или проверить путь к «Речной Страж».");
  });
  it("falls back to contact, route, item, then silence", () => {
    expect(buildContinuationHint(base({ knownContacts: [{ label: "перевозчик" }] })))
      .toBe("Можно расспросить перевозчик о том, что изменилось.");
    expect(buildContinuationHint(base({ availableRoutes: [{ label: "Речной Страж", status: "open" }] })))
      .toBe("Можно проверить путь к «Речной Страж» или осмотреться здесь.");
    expect(buildContinuationHint(base({
      accessibleItemsAndAffordances: [{ label: "верёвка", affordances: ["take"] }],
    }))).toBe("Можно использовать верёвка или осмотреться вокруг.");
    expect(buildContinuationHint(base())).toBeNull();
  });
});

describe("hasGameMomentum", () => {
  it("detects questions and next-step language", () => {
    expect(hasGameMomentum("Ты говоришь о перевозчике или об архивисте?")).toBe(true);
    expect(hasGameMomentum("Можно расспросить перевозчика.")).toBe(true);
    expect(hasGameMomentum("Стоит проверить западный берег.")).toBe(true);
  });
  it("rejects plain statements and empty text", () => {
    expect(hasGameMomentum("Ты находишься у переправы.")).toBe(false);
    expect(hasGameMomentum("   ")).toBe(false);
  });
});

describe("ensureGameMomentum", () => {
  it("appends the hint when momentum is missing", () => {
    expect(ensureGameMomentum("Ты прислушиваешься к воде.", "Можно расспросить перевозчика."))
      .toBe("Ты прислушиваешься к воде. Можно расспросить перевозчика.");
  });
  it("keeps answers that already move the game", () => {
    const text = "Ты говоришь о перевозчике или об архивисте?";
    expect(ensureGameMomentum(text, "Можно расспросить перевозчика.")).toBe(text);
  });
  it("never invents without a hint", () => {
    expect(ensureGameMomentum("Ты прислушиваешься к воде.", null)).toBe("Ты прислушиваешься к воде.");
    expect(ensureGameMomentum("Ты прислушиваешься к воде.", "  ")).toBe("Ты прислушиваешься к воде.");
  });
  it("bounds an overlong hint instead of dropping it", () => {
    const hint = `Можно ${"очень ".repeat(60)}осмотреться.`;
    const result = ensureGameMomentum("Ты слушаешь воду.", hint);
    expect(result.startsWith("Ты слушаешь воду. Можно")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual("Ты слушаешь воду.".length + 1 + 220);
  });
  it("returns the hint alone for an empty base", () => {
    expect(ensureGameMomentum("  ", "Можно осмотреться.")).toBe("Можно осмотреться.");
    expect(ensureGameMomentum("", null)).toBe("");
  });
});
