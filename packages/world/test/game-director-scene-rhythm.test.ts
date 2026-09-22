import { describe, it, expect } from "vitest";
import {
  buildSceneRhythm,
  rhythmCompletion,
  rhythmInactionCost,
  rhythmOpportunity,
  rhythmPressure,
  rhythmQuestion,
} from "../src/game-director/scene-rhythm.js";
import type { JourneyView } from "../src/game-shell/types.js";

function idleJourney(): JourneyView {
  return { status: "idle", from: null, to: null, elapsedTicks: 0, totalTicks: 0, text: "Путь начнётся." };
}

function travelingJourney(): JourneyView {
  return { status: "traveling", from: "Переправа", to: "Речной Страж", elapsedTicks: 1, totalTicks: 2, text: "Ты в пути." };
}

describe("rhythmQuestion", () => {
  it("prefers the pending clarification over goal and situation", () => {
    expect(rhythmQuestion({
      situation: { title: "Переправа", description: "Вода поднялась." },
      activeGoal: "дойти до города",
      pendingQuestion: "Ты говоришь о перевозчике или об архивисте?",
    })).toBe("Ты говоришь о перевозчике или об архивисте?");
  });
  it("falls back to goal, then situation, then null", () => {
    expect(rhythmQuestion({ situation: null, activeGoal: "дойти до города" })).toBe("дойти до города");
    expect(rhythmQuestion({
      situation: { title: "Переправа", description: "Вода поднялась." },
    })).toBe("Переправа: Вода поднялась.");
    expect(rhythmQuestion({ situation: null })).toBeNull();
  });
  it("treats blank inputs as absent", () => {
    expect(rhythmQuestion({ situation: null, activeGoal: "  ", pendingQuestion: "" })).toBeNull();
  });
});

describe("rhythmPressure", () => {
  it("names the active journey leg", () => {
    expect(rhythmPressure({ situation: null, journey: travelingJourney(), recentConsequences: [] }))
      .toBe("Путь к «Речной Страж» продолжается: 1 из 2.");
  });
  it("surfaces closed and difficult crossings from the situation", () => {
    expect(rhythmPressure({
      situation: { title: "Переправа", description: "Переправа закрыта из-за высокой воды." },
      journey: idleJourney(),
      recentConsequences: [],
    })).toBe("Переправа закрыта из-за высокой воды.");
    expect(rhythmPressure({
      situation: { title: "Переправа", description: "Переправа трудна." },
      journey: idleJourney(),
      recentConsequences: [],
    })).toBe("Переправа трудна.");
  });
  it("falls back to the freshest consequence, else null — never invented", () => {
    expect(rhythmPressure({
      situation: null,
      journey: idleJourney(),
      recentConsequences: [{ label: "Ответ мира", detail: "заметно с хода 3" }],
    })).toBe("Ответ мира: заметно с хода 3");
    expect(rhythmPressure({ situation: null, journey: idleJourney(), recentConsequences: [] })).toBeNull();
  });
});

describe("rhythmOpportunity", () => {
  it("passes one honest line through, blanks become null", () => {
    expect(rhythmOpportunity("Открыт путь к «Речному Стражу».")).toBe("Открыт путь к «Речному Стражу».");
    expect(rhythmOpportunity("   ")).toBeNull();
    expect(rhythmOpportunity(null)).toBeNull();
    expect(rhythmOpportunity(undefined)).toBeNull();
  });
});

describe("rhythmInactionCost", () => {
  it("names interruption and closure, otherwise stays silent", () => {
    expect(rhythmInactionCost({
      situation: null,
      journey: { ...idleJourney(), status: "interrupted" },
    })).toBe("Путь прерван: дальше без нового решения не пройти.");
    expect(rhythmInactionCost({
      situation: { title: "Переправа", description: "Переправа закрыта из-за высокой воды." },
      journey: idleJourney(),
    })).toBe("Пока переправа закрыта, прямой путь остаётся недоступен.");
    expect(rhythmInactionCost({ situation: null, journey: idleJourney() })).toBeNull();
  });
});

describe("blocked journey rhythm", () => {
  function blockedJourney() {
    return {
      status: "blocked" as const,
      from: "Переправа",
      to: "Речной Страж",
      elapsedTicks: 2,
      totalTicks: 2,
      text: "Путь к «Речной Страж» перекрыт: переправа закрыта.",
    };
  }
  it("pressure names the standing obstacle, never an ongoing path", () => {
    const pressure = rhythmPressure({ situation: null, journey: blockedJourney(), recentConsequences: [] });
    expect(pressure).toContain("перекрыт");
    expect(pressure).not.toContain("продолжается");
  });
  it("completion names reopening or a detour", () => {
    expect(rhythmCompletion({ situation: null, journey: blockedJourney(), pendingQuestion: null }))
      .toBe("Когда путь откроется или найдётся обход, переход завершится.");
  });
});

describe("rhythmCompletion", () => {
  it("derives arrival, pending-question and situation completions", () => {
    expect(rhythmCompletion({ situation: null, journey: travelingJourney(), pendingQuestion: null }))
      .toBe("Прибытие к «Речной Страж» закроет этот переход.");
    expect(rhythmCompletion({
      situation: null,
      journey: { ...travelingJourney(), status: "completed" },
      pendingQuestion: null,
    })).toBe("Путь к «Речной Страж» завершён.");
    expect(rhythmCompletion({ situation: null, journey: idleJourney(), pendingQuestion: "Кто здесь?" }))
      .toBe("Ответ на открытый вопрос мастера закроет эту сцену.");
    expect(rhythmCompletion({
      situation: { title: "Переправа", description: "Вода поднялась." },
      journey: idleJourney(),
      pendingQuestion: null,
    })).toBe("Выбор пути, свидетельство или причина изменения течения закроют эту сцену.");
    expect(rhythmCompletion({ situation: null, journey: idleJourney(), pendingQuestion: null })).toBeNull();
  });
});

describe("buildSceneRhythm", () => {
  it("assembles the full rhythm for the crossing scene", () => {
    const rhythm = buildSceneRhythm({
      situation: { title: "Переправа", description: "Переправа закрыта из-за высокой воды." },
      journey: idleJourney(),
      recentConsequences: [],
      pendingQuestion: "Ты хочешь остаться у переправы или начать путь?",
      opportunityCandidate: "Перевозчик знает старое русло.",
      lastOutcome: "Ты прислушиваешься к воде.",
    });
    expect(rhythm.question).toBe("Ты хочешь остаться у переправы или начать путь?");
    expect(rhythm.pressure).toBe("Переправа закрыта из-за высокой воды.");
    expect(rhythm.opportunity).toBe("Перевозчик знает старое русло.");
    expect(rhythm.inactionCost).toBe("Пока переправа закрыта, прямой путь остаётся недоступен.");
    expect(rhythm.changeAfterActions).toBe("Ты прислушиваешься к воде.");
    expect(rhythm.completionCondition).toBe("Ответ на открытый вопрос мастера закроет эту сцену.");
    expect(Object.isFrozen(rhythm)).toBe(true);
  });
  it("stays honest with an empty scene: nulls, not inventions", () => {
    const rhythm = buildSceneRhythm({ situation: null, journey: idleJourney(), recentConsequences: [] });
    expect(rhythm).toEqual({
      question: null,
      pressure: null,
      opportunity: null,
      approaches: [],
      inactionCost: null,
      changeAfterActions: null,
      completionCondition: null,
    });
  });
});
