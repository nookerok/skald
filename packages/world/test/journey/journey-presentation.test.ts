import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../../src/projection.js";
import { selectTurnPresentation } from "../../src/presentation/selector.js";

function event(type: string, eventId: string, payload: unknown): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 4, correlationId: "journey", causationId: null };
}

function world(): ReadonlyWorld {
  return {
    player: { x: 0, y: 0 },
    locations: new Map([
      ["home", { id: "home", name: "Южный посад", description: "", connections: {} }],
      ["pass", { id: "pass", name: "Северный проход", description: "", connections: {} }],
    ]),
    journeys: new Map([
      ["journey-1", { journeyId: "journey-1", relationId: "road-1", fromLocationId: "home", toLocationId: "pass", startedAt: 4, plannedTicks: 3, elapsedTicks: 3, status: "completed" }],
    ]),
  } as unknown as ReadonlyWorld;
}

describe("journey presentation", () => {
  it("describes a long natural journey without grid language", () => {
    const presentation = selectTurnPresentation([
      event("JourneyStarted", "start", { journeyId: "journey-1", toLocationId: "pass", plannedTicks: 3 }),
      event("JourneyCompleted", "complete", { journeyId: "journey-1" }),
    ], world());
    expect(presentation.primary?.text).toContain("добрался");
    expect(presentation.notable.some((entry) => entry.text.includes("тяжёлых этапов"))).toBe(true);
    expect(presentation.primary?.text).not.toMatch(/пытаешься|клетк|координат|east/i);
  });

  it("describes waiting as progress while travelling", () => {
    const travellingWorld = {
      ...world(),
      activeJourneyId: "journey-1",
      journeys: new Map([
        ["journey-1", { journeyId: "journey-1", relationId: "road-1", fromLocationId: "home", toLocationId: "pass", startedAt: 4, plannedTicks: 3, elapsedTicks: 1, status: "active" }],
      ]),
    } as unknown as ReadonlyWorld;
    const presentation = selectTurnPresentation([
      event("ActionAttempted", "wait", { operation: "wait", target: null }),
      event("TickPassed", "tick", { delta: 1, journeyId: "journey-1" }),
    ], travellingWorld);
    expect(presentation.primary?.text).toContain("этап пути");
    expect(presentation.primary?.text).toContain("Пройдено");
    expect(presentation.primary?.text).not.toContain("формулируешь");
  });

  it("surfaces a route block as a useful player-facing answer", () => {
    const presentation = selectTurnPresentation([
      event("JourneyBlocked", "blocked", { reason: "unknown_destination", playerText: "Нет известной дороги к северному проходу." }),
    ], world());
    expect(presentation.primary?.text).toBe("Нет известной дороги к северному проходу.");
  });
});
