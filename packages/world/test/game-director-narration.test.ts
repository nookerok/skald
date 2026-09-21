import { describe, it, expect, vi } from "vitest";
import type { TurnPresentation } from "../src/presentation/types.js";
import type { GameDirectorContext } from "../src/game-director/context.js";

const OUTCOME = "Ты шагнул на тропу, и лес насторожился.";

function pres(): TurnPresentation {
  return {
    response: null,
    primary: {
      kind: "action", importance: "primary", discoveryMark: null,
      epistemicClass: "observed_fact", text: OUTCOME, timestamp: 7,
      sourceEventIds: ["e-1"], threadKey: null, threadLabel: null,
    },
    notable: [],
    background: [],
    suppressedEventCount: 0,
    worldTime: 7,
    playerPosition: { x: 1, y: 2 },
  };
}

function director(): GameDirectorContext {
  return {
    characterBackground: {
      name: "путник", backgroundTitle: "Хранитель",
      formerRole: "сторож", rupture: "разрыв", obligation: "долг",
    },
    currentScene: {
      locationName: "Тропа",
      locationDescription: "Ты стоишь на тропе у леса.",
      situationTitle: null,
      situationDescription: null,
    },
    activePlayerGoal: { summary: "дойти до Речного Стража" },
    currentDramaticThread: { source: "player_goal", title: "дойти до Речного Стража" },
    visibleSituation: ["Ты стоишь на тропе у леса."],
    knownContacts: [],
    availableRoutes: [{ label: "Речной Страж", status: "open" }],
    accessibleItemsAndAffordances: [],
    recentConsequences: [],
    knownFacts: ["Ты стоишь на тропе у леса."],
    knownUncertainties: [],
    lastTurns: [
      { speaker: "player", text: "Иду на восток по тропе" },
      { speaker: "master", text: OUTCOME },
    ],
    pendingClarification: null,
    journeyState: { status: "idle", from: null, to: null, elapsedTicks: 0, totalTicks: 0, text: "Путь начнётся." },
    unresolvedPersonalHook: "найти стража",
    sceneRhythm: {
      question: "дойти до Речного Стража",
      pressure: null,
      opportunity: "Открыт путь к «Речному Стражу».",
      inactionCost: null,
      changeAfterActions: OUTCOME,
      completionCondition: null,
    },
    masterBrief: {
      whatJustHappened: OUTCOME,
      whatChanged: OUTCOME,
      whoReacted: null,
      whatIsUrgent: null,
      whatRemainsUncertain: null,
      availableLeads: ["проверить путь к «Речной Страж»"],
      personalConnection: "найти стража",
    },
  };
}

function narrationJson(narration: string, claims: unknown[] = [{ text: narration, sourceFactId: "primary", epistemicClass: "observed_fact" }]): string {
  return JSON.stringify({ narration, claims });
}

async function mockRouter(text: string) {
  const { ModelRouter } = await import("../src/llm/router.js");
  const router = new ModelRouter({ apiKey: "test-key" });
  vi.spyOn(router, "chat").mockResolvedValue({
    text,
    model: "deepseek-v4-flash-free",
    configuredModel: "deepseek-v4-flash-free",
    responseModel: "deepseek-v4-flash-free",
    usedFallback: false,
    latencyMs: 120,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    provider: "opencode_zen",
  });
  return router;
}

describe("gameDirectorPromptSlice", () => {
  it("carries the scene, not technical fields", async () => {
    const { gameDirectorPromptSlice } = await import("../src/narrative-llm.js");
    const slice = gameDirectorPromptSlice(director()) as Record<string, unknown>;
    expect(slice.lastPlayerUtterance).toBe("Иду на восток по тропе");
    expect((slice.lastTurns as unknown[])).toHaveLength(2);
    expect(slice.activePlayerGoal).toBe("дойти до Речного Стража");
    expect(slice.unresolvedPersonalHook).toBe("найти стража");
    expect(slice.availableRoutes).toEqual([{ label: "Речной Страж", status: "open" }]);
    const json = JSON.stringify(slice);
    expect(json).not.toMatch(/eventId|sourceEventIds|observerRef|_id|coordinate/i);
  });
  it("bounds the replica window to twelve", async () => {
    const { gameDirectorPromptSlice } = await import("../src/narrative-llm.js");
    const many = Array.from({ length: 30 }, (_, index) => ({
      speaker: (index % 2 === 0 ? "player" : "master") as "player" | "master",
      text: `реплика ${index + 1}`,
    }));
    const slice = gameDirectorPromptSlice({ ...director(), lastTurns: many }) as Record<string, unknown>;
    expect((slice.lastTurns as unknown[])).toHaveLength(12);
  });
  it("never carries an unmanifested consequence into the prompt", async () => {
    const { buildGameDirectorContext } = await import("../src/game-director/context.js");
    const { gameDirectorAllowedFacts, gameDirectorPromptSlice } = await import("../src/narrative-llm.js");
    const hiddenEvents = [{
      eventId: "cc-noise", type: "ConsequenceCreated", schemaVersion: 1,
      payload: { id: "noise@npc", type: "noise_attention", severity: 2, createdAt: 4, expiresAt: 9, data: {} },
      timestamp: 4, correlationId: "tick-4", causationId: null,
    }];
    const hiddenWorld = {
      consequences: new Map([["noise@npc", { id: "noise@npc", type: "noise_attention" }]]),
      journeys: new Map(),
      activeJourneyId: null,
      locations: new Map([["crossing", { id: "crossing", name: "Переправа", description: "Переправа." }]]),
      currentLocationId: "crossing",
    };
    const scene = {
      schemaVersion: 1 as const,
      revision: { worldTime: 5, eventNumber: 10 },
      currentLocation: { name: "Переправа", description: "Ты стоишь у переправы." },
      visibleObjects: [], knownPeople: [], knownRoutes: [], accessibleItems: [],
      availableActions: [], currentSituation: null, knownTopics: [],
    };
    const built = buildGameDirectorContext(hiddenEvents, hiddenWorld as never, { scene });
    const sliceJson = JSON.stringify(gameDirectorPromptSlice(built));
    expect(sliceJson).not.toMatch(/Отзвук шума|noise_attention|noise@npc/);
    expect(gameDirectorAllowedFacts(built, []).join(" ")).not.toMatch(/Отзвук шума|noise_attention|noise@npc/);
  });
  it("never carries a fired-but-unheard NPC consequence into the prompt", async () => {
    const { buildGameDirectorContext } = await import("../src/game-director/context.js");
    const { gameDirectorAllowedFacts, gameDirectorPromptSlice } = await import("../src/narrative-llm.js");
    // The NPC noise fired, but no player-targeted trigger proves the hero
    // noticed: firing alone is not observation proof.
    const unheardEvents = [
      {
        eventId: "cc-noise", type: "ConsequenceCreated", schemaVersion: 1,
        payload: { id: "noise@npc", type: "noise_attention", severity: 2, createdAt: 4, expiresAt: 7, data: {} },
        timestamp: 4, correlationId: "tick-4", causationId: null,
      },
      {
        eventId: "ce-noise@npc", type: "ConsequenceExpired", schemaVersion: 1,
        payload: { id: "noise@npc" },
        timestamp: 7, correlationId: "tick-7", causationId: null,
      },
      {
        eventId: "cf-noise@npc", type: "ConsequenceFired", schemaVersion: 1,
        payload: { consequenceId: "noise@npc", consequenceType: "noise_attention", firedAt: 7 },
        timestamp: 7, correlationId: "tick-7", causationId: "ce-noise@npc",
      },
    ];
    const hiddenWorld = {
      consequences: new Map(),
      journeys: new Map(),
      activeJourneyId: null,
      locations: new Map([["crossing", { id: "crossing", name: "Переправа", description: "Переправа." }]]),
      currentLocationId: "crossing",
    };
    const scene = {
      schemaVersion: 1 as const,
      revision: { worldTime: 8, eventNumber: 12 },
      currentLocation: { name: "Переправа", description: "Ты стоишь у переправы." },
      visibleObjects: [], knownPeople: [], knownRoutes: [], accessibleItems: [],
      availableActions: [], currentSituation: null, knownTopics: [],
    };
    const built = buildGameDirectorContext(unheardEvents, hiddenWorld as never, { scene });
    expect(built.recentConsequences).toEqual([]);
    const sliceJson = JSON.stringify(gameDirectorPromptSlice(built));
    expect(sliceJson).not.toMatch(/Отзвук шума|noise_attention|noise@npc/);
    expect(gameDirectorAllowedFacts(built, []).join(" ")).not.toMatch(/Отзвук шума|noise_attention|noise@npc/);
  });
});

describe("gameDirectorAllowedFacts", () => {
  it("collects every observer-safe line the model may rephrase", async () => {
    const { gameDirectorAllowedFacts } = await import("../src/narrative-llm.js");
    const facts = gameDirectorAllowedFacts(director(), [OUTCOME]);
    expect(facts).toContain(OUTCOME);
    expect(facts).toContain("Ты стоишь на тропе у леса.");
    expect(facts).toContain("Речной Страж");
    expect(facts).toContain("найти стража");
    expect(facts).toContain("дойти до Речного Стража");
  });
});

describe("narrateTurnLLM with gameDirector", () => {
  it("sends the scene slice inside the prompt", async () => {
    const router = await mockRouter(narrationJson("Ты шагнул на тропу к востоку, и лес вокруг насторожился."));
    const chatSpy = vi.spyOn(router, "chat");
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("Иду на восток по тропе", pres(), router, { gameDirector: director() });
    expect(result.usedFallback).toBe(false);
    const messages = chatSpy.mock.calls[0]?.[1] as unknown as Array<{ content: string }>;
    const user = JSON.parse(messages[1]!.content);
    expect(user.gameDirector.lastPlayerUtterance).toBe("Иду на восток по тропе");
    expect(user.gameDirector.currentScene.locationName).toBe("Тропа");
    expect(user.gameDirector.sceneRhythm.question).toBe("дойти до Речного Стража");
    expect(messages[0]!.content).toContain("четыр");
  });
  it("rejects prose that loses the outcome with a quality deterministic fallback", async () => {
    const router = await mockRouter(narrationJson("Тихое озеро спит под луной."));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("Иду на восток по тропе", pres(), router, { gameDirector: director() });
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("game_quality_violation:outcome_lost");
    expect(result.text).toBe(OUTCOME);
  });
  it("rejects internal identifiers with a quality deterministic fallback", async () => {
    const router = await mockRouter(narrationJson("Ты шагнул на тропу и видишь quest_flag.", [
      { text: "Ты шагнул на тропу и видишь quest_flag.", sourceFactId: "primary", epistemicClass: "observed_fact" },
    ]));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("Иду на восток по тропе", pres(), router, { gameDirector: director() });
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("game_quality_violation:internal_id_leak");
    expect(result.text).toBe(OUTCOME);
  });
  it("keeps the exact legacy behavior without a director", async () => {
    const router = await mockRouter(narrationJson("Тихое озеро спит под луной."));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("Иду на восток по тропе", pres(), router);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Тихое озеро спит под луной.");
  });
});
