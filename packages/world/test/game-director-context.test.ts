import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  buildGameDirectorContext,
  directorJourneyState,
  directorRecentConsequences,
} from "../src/game-director/context.js";
import type { MasterTurnSceneContext } from "../src/master-turn/observer-context.js";
import type { ReadonlyWorld } from "../src/projection.js";

function scene(overrides: Partial<MasterTurnSceneContext> = {}): MasterTurnSceneContext {
  return {
    schemaVersion: 1,
    revision: { worldTime: 5, eventNumber: 10 },
    currentLocation: { name: "Переправа", description: "Ты стоишь у переправы." },
    visibleObjects: [],
    knownPeople: [{ observerRef: "person_1", kind: "person", label: "перевозчик", knownAs: ["перевозчик"] }],
    knownRoutes: [{ observerRef: "route_1", kind: "route", label: "Речной Страж", knownAs: ["Речной Страж"], status: "open" }],
    accessibleItems: [{ observerRef: "object_1", label: "верёвка", knownAs: ["верёвка"], affordances: ["take"] }],
    availableActions: [],
    currentSituation: { title: "Переправа", description: "Переправа закрыта из-за высокой воды." },
    knownTopics: [],
    ...overrides,
  };
}

function world(overrides: Partial<ReadonlyWorld> = {}): ReadonlyWorld {
  return {
    consequences: new Map(),
    journeys: new Map(),
    activeJourneyId: null,
    locations: new Map([
      ["crossing", { id: "crossing", name: "Переправа", description: "Переправа.", objectIds: [], connections: {} }],
      ["city", { id: "city", name: "Речной Страж", description: "Город.", objectIds: [], connections: {} }],
    ]),
    currentLocationId: "crossing",
    ...overrides,
  } as unknown as ReadonlyWorld;
}

describe("directorJourneyState", () => {
  it("is idle without journeys", () => {
    expect(directorJourneyState(world()).status).toBe("idle");
  });
  it("maps active journeys to planned/in_progress without new state", () => {
    const planned = world({
      journeys: new Map([["j-1", {
        journeyId: "j-1", relationId: "r", fromLocationId: "crossing", toLocationId: "city",
        startedAt: 5, plannedTicks: 2, elapsedTicks: 0, status: "active", blockedReason: null,
      }]]),
      activeJourneyId: "j-1",
    });
    expect(directorJourneyState(planned).status).toBe("planned");
    const progress = world({
      journeys: new Map([["j-1", {
        journeyId: "j-1", relationId: "r", fromLocationId: "crossing", toLocationId: "city",
        startedAt: 5, plannedTicks: 2, elapsedTicks: 1, status: "active", blockedReason: null,
      }]]),
      activeJourneyId: "j-1",
    });
    const state = directorJourneyState(progress);
    expect(state.status).toBe("in_progress");
    expect(state.to).toBe("Речной Страж");
    expect(state.elapsedTicks).toBe(1);
  });
  it("maps completed/interrupted/blocked to arrived/cancelled/blocked", () => {
    for (
      const [stored, expected] of [
        ["completed", "arrived"],
        ["interrupted", "cancelled"],
        ["blocked", "blocked"],
      ] as const
    ) {
      const w = world({
        journeys: new Map([["j-1", {
          journeyId: "j-1", relationId: "r", fromLocationId: "crossing", toLocationId: "city",
          startedAt: 5, plannedTicks: 2, elapsedTicks: 1, status: stored, blockedReason: stored === "blocked" ? "crossing_closed" : null,
        }]]),
      });
      expect(directorJourneyState(w).status).toBe(expected);
    }
  });
  it("names the obstacle instead of an ongoing path", () => {
    const w = world({
      journeys: new Map([["j-1", {
        journeyId: "j-1", relationId: "r", fromLocationId: "crossing", toLocationId: "city",
        startedAt: 5, plannedTicks: 2, elapsedTicks: 2, status: "blocked", blockedReason: "crossing_closed",
      }]]),
      activeJourneyId: "j-1",
    });
    const state = directorJourneyState(w);
    expect(state.status).toBe("blocked");
    expect(state.text).toContain("перекрыт");
    expect(state.text).not.toContain("продолжается");
    expect(state.text).not.toMatch(/blocked/i);
  });
});

describe("directorRecentConsequences", () => {
  function expired(id: string, at: number): DomainEvent {
    return {
      eventId: `ce-${id}`, type: "ConsequenceExpired", schemaVersion: 1,
      payload: { id },
      timestamp: at, correlationId: "tick-1", causationId: null,
    };
  }
  function fired(consequenceId: string, consequenceType: string, firedAt: number, expiryEventId: string): DomainEvent {
    return {
      eventId: `cf-${consequenceId}`, type: "ConsequenceFired", schemaVersion: 1,
      payload: { consequenceId, consequenceType, firedAt },
      timestamp: firedAt, correlationId: "tick-1", causationId: expiryEventId,
    };
  }
  function triggered(expiryEventId: string, at: number, target = "player"): DomainEvent {
    return {
      eventId: `at-${expiryEventId}`, type: "AudacityTriggered", schemaVersion: 1,
      payload: { target, severity: 1 },
      timestamp: at, correlationId: "tick-1", causationId: expiryEventId,
    };
  }

  it("lists only player-scoped firings, newest first, in player vocabulary", () => {
    const recent = directorRecentConsequences([
      expired("audacity@s1", 26),
      fired("audacity@s1", "audacity", 26, "ce-audacity@s1"),
      triggered("ce-audacity@s1", 26),
      expired("noise@s2", 31),
      fired("noise@s2", "noise_attention", 31, "ce-noise@s2"),
      triggered("ce-noise@s2", 31),
    ]);
    // Both chains carry a player-targeted trigger from the same expiry.
    expect(recent.map((entry) => entry.label)).toEqual(["Отзвук шума", "Ответ мира"]);
    expect(recent[0]!.detail).toContain("31");
    expect(Object.isFrozen(recent)).toBe(true);
  });

  it("hides merely created consequences, including unheard NPC noise", () => {
    const createdOnly: DomainEvent[] = [{
      eventId: "cc-noise", type: "ConsequenceCreated", schemaVersion: 1,
      payload: { id: "noise@npc", type: "noise_attention", severity: 2, createdAt: 4, expiresAt: 7, data: {} },
      timestamp: 4, correlationId: "tick-4", causationId: null,
    }];
    expect(directorRecentConsequences(createdOnly)).toEqual([]);
  });

  it("hides a fired NPC consequence with no player-targeted trigger", () => {
    const unheard: DomainEvent[] = [
      {
        eventId: "cc-noise", type: "ConsequenceCreated", schemaVersion: 1,
        payload: { id: "noise@npc", type: "noise_attention", severity: 2, createdAt: 4, expiresAt: 7, data: {} },
        timestamp: 4, correlationId: "tick-4", causationId: null,
      },
      expired("noise@npc", 7),
      fired("noise@npc", "noise_attention", 7, "ce-noise@npc"),
    ];
    expect(directorRecentConsequences(unheard)).toEqual([]);
    const director = buildGameDirectorContext(unheard, world(), { scene: scene() });
    expect(director.recentConsequences).toEqual([]);
    expect(JSON.stringify(director)).not.toMatch(/Отзвук шума|noise_attention|noise@npc/);
  });

  it("ignores triggers aimed away from the player", () => {
    const foreign: DomainEvent[] = [
      expired("audacity@x", 9),
      fired("audacity@x", "audacity", 9, "ce-audacity@x"),
      triggered("ce-audacity@x", 9, "npc"),
    ];
    expect(directorRecentConsequences(foreign)).toEqual([]);
  });

  it("is empty without manifested consequences", () => {
    expect(directorRecentConsequences([])).toEqual([]);
  });
});

describe("buildGameDirectorContext", () => {
  it("composes scene, conversation, background and rhythm read-side", () => {
    const director = buildGameDirectorContext([], world(), {
      scene: scene(),
      narrativeContext: {
        character: { name: "путник", backgroundTitle: "Хранитель", formerRole: "сторож", rupture: "разрыв", obligation: "долг" },
        arrival: { reason: "причина", personalHook: "найти стража", startingLocation: "Переправа" },
        visibleSituation: {
          facts: [{ id: "situation:location", text: "Переправа: Ты стоишь у переправы.", epistemicClass: "observed_fact", source: "situation", usableNow: true }],
          sensoryContext: [],
        },
        knowledge: { observed: [], testimony: [], hypotheses: [] },
        contacts: [],
        accessibleItems: [],
        unresolvedSituation: [],
        openingWindow: false,
      },
      conversation: {
        lastTurns: [
          { speaker: "player", text: "Я осматриваю переправу" },
          { speaker: "master", text: "Ты видишь поднявшуюся воду." },
        ],
        activePlayerGoal: { summary: "дойти до Речного Стража" },
        currentDramaticThread: { source: "player_goal", title: "дойти до Речного Стража" },
        knownFacts: ["Переправа видна."],
        knownUncertainties: ["Говорят, русло изменилось."],
        pendingClarification: null,
      },
      lastOutcome: "Ты прислушиваешься к воде.",
    });
    expect(director.characterBackground?.obligation).toBe("долг");
    expect(director.currentScene.locationName).toBe("Переправа");
    expect(director.activePlayerGoal?.summary).toBe("дойти до Речного Стража");
    expect(director.knownContacts).toEqual([{ label: "перевозчик" }]);
    expect(director.availableRoutes).toEqual([{ label: "Речной Страж", status: "open" }]);
    expect(director.accessibleItemsAndAffordances).toEqual([{ label: "верёвка", affordances: ["take"] }]);
    expect(director.lastTurns).toHaveLength(2);
    expect(director.unresolvedPersonalHook).toBe("найти стража");
    expect(director.sceneRhythm.question).toBe("дойти до Речного Стража");
    expect(director.sceneRhythm.changeAfterActions).toBe("Ты прислушиваешься к воде.");
    expect(Object.isFrozen(director)).toBe(true);
  });
  it("works without background or conversation — nulls, never inventions", () => {
    const director = buildGameDirectorContext([], world(), { scene: scene({ currentSituation: null }) });
    expect(director.characterBackground).toBeNull();
    expect(director.activePlayerGoal).toBeNull();
    expect(director.pendingClarification).toBeNull();
    expect(director.unresolvedPersonalHook).toBeNull();
    expect(director.visibleSituation).toEqual([]);
    expect(director.sceneRhythm.question).toBeNull();
    expect(director.sceneRhythm.pressure).toBeNull();
  });
  it("bounds long lists to the director window", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      observerRef: `person_${index + 1}`,
      kind: "person" as const,
      label: `контакт-${index + 1}`,
      knownAs: [`контакт-${index + 1}`],
    }));
    const turns = Array.from({ length: 30 }, (_, index) => ({
      speaker: (index % 2 === 0 ? "player" : "master") as "player" | "master",
      text: `реплика ${index + 1}`,
    }));
    const director = buildGameDirectorContext([], world(), {
      scene: scene({ knownPeople: many }),
      conversation: {
        lastTurns: turns,
        activePlayerGoal: null,
        currentDramaticThread: null,
        knownFacts: [],
        knownUncertainties: [],
        pendingClarification: null,
      },
    });
    expect(director.knownContacts).toHaveLength(8);
    expect(director.lastTurns).toHaveLength(12);
  });
  it("derives the opportunity from open routes when no candidate is given", () => {
    const director = buildGameDirectorContext([], world(), { scene: scene() });
    expect(director.sceneRhythm.opportunity).toBe("Открыт путь к «Речной Страж».");
  });
});
