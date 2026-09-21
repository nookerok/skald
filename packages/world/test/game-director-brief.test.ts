import { describe, expect, it } from "vitest";
import { buildMasterBrief, type MasterBriefInput } from "@skald/world";
import type { SceneRhythm } from "@skald/world";

function rhythm(overrides: Partial<SceneRhythm> = {}): SceneRhythm {
  return {
    question: null,
    pressure: null,
    opportunity: null,
    inactionCost: null,
    changeAfterActions: null,
    completionCondition: null,
    ...overrides,
  };
}

function input(overrides: Partial<MasterBriefInput> = {}): MasterBriefInput {
  return {
    sceneRhythm: rhythm(),
    journey: { status: "idle", to: null },
    knownContacts: [],
    availableRoutes: [],
    accessibleItems: [],
    recentConsequences: [],
    knownUncertainties: [],
    lastMasterText: null,
    pendingQuestion: null,
    personalHook: null,
    ...overrides,
  };
}

describe("buildMasterBrief (plan P2)", () => {
  it("selects what just happened, what changed, who reacted and what is urgent", () => {
    const brief = buildMasterBrief(input({
      sceneRhythm: rhythm({ changeAfterActions: "Ты прислушиваешься к воде.", pressure: "Уровень продолжает подниматься." }),
      journey: { status: "in_progress", to: "Речной Страж" },
      knownContacts: [{ label: "Перевозчик у переправы" }],
      availableRoutes: [{ label: "Речной Страж" }],
      accessibleItems: [{ label: "Фонарь" }],
      knownUncertainties: ["Причина подъёма воды неясна."],
      personalHook: "Найти того, кто изменил знак.",
      lastMasterText: "Ты осматриваешься.",
    }));

    expect(brief.whatJustHappened).toBe("Ты прислушиваешься к воде.");
    expect(brief.whatChanged).toBe("Ты прислушиваешься к воде.");
    expect(brief.whoReacted).toBe("Перевозчик у переправы");
    expect(brief.whatIsUrgent).toBe("Уровень продолжает подниматься.");
    expect(brief.whatRemainsUncertain).toBe("Причина подъёма воды неясна.");
    expect(brief.personalConnection).toBe("Найти того, кто изменил знак.");
    expect(brief.availableLeads).toEqual([
      "продолжить путь к «Речной Страж»",
      "расспросить Перевозчик у переправы",
      "проверить путь к «Речной Страж»",
    ]);
  });

  it("falls back to the master line and pending question when rhythm is empty", () => {
    const brief = buildMasterBrief(input({
      lastMasterText: "Ты осматриваешься.",
      pendingQuestion: "Кого ты имеешь в виду?",
      sceneRhythm: rhythm({ inactionCost: "Путь прерван: дальше без решения не пройти." }),
    }));
    expect(brief.whatJustHappened).toBe("Ты осматриваешься.");
    expect(brief.whatChanged).toBeNull();
    expect(brief.whatIsUrgent).toBe("Путь прерван: дальше без решения не пройти.");
    expect(brief.whatRemainsUncertain).toBe("Кого ты имеешь в виду?");
    expect(brief.availableLeads).toEqual([]);
    expect(brief.personalConnection).toBeNull();
  });

  it("offers a detour lead when the journey is blocked", () => {
    const brief = buildMasterBrief(input({ journey: { status: "blocked", to: "Речной Страж" } }));
    expect(brief.availableLeads[0]).toBe("поискать обход к «Речной Страж»");
  });

  it("is deterministic, bounded and frozen", () => {
    const source = input({ sceneRhythm: rhythm({ pressure: "x".repeat(400) }) });
    const first = buildMasterBrief(source);
    const second = buildMasterBrief(source);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.availableLeads)).toBe(true);
    expect(first.whatIsUrgent!.length).toBeLessThanOrEqual(220);
  });

  it("never invents a hook from an empty context", () => {
    const brief = buildMasterBrief(input());
    expect(brief).toEqual({
      whatJustHappened: null,
      whatChanged: null,
      whoReacted: null,
      whatIsUrgent: null,
      whatRemainsUncertain: null,
      availableLeads: [],
      personalConnection: null,
    });
  });
});
