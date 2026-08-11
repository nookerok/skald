/**
 * Playable journey integration test.
 * A real living_region world travels only through observer-known destinations.
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "../src/eval/harness.js";
import { runCommandCycle, runOfflineTicks } from "../src/index.js";

describe("playable journey in the living region", () => {
  it("travels from the waystation to an observed forest edge through external travel ticks", () => {
    const harness = createHarness("living_region", "journey-e2e");
    const app = harness.app;

    const before = app.projection.getSnapshot().currentLocationId;
    expect(before).toBe("river_waystation");

    const result = runCommandCycle(app, "\u0438\u0434\u0442\u0438 \u043a \u041a\u0440\u043e\u043c\u043a\u0435 \u0427\u0451\u0440\u043d\u043e\u0433\u043e \u043b\u0435\u0441\u0430", "journey-e2e:go-forest");
    expect(result && typeof result === "object" && "events" in result).toBe(true);
    const events = (result as { events: Array<{ type: string }> }).events;

    const types = events.map((e) => e.type);
    expect(types).toContain("JourneyRequested");
    expect(types).toContain("JourneyValidated");
    expect(types).toContain("JourneyStarted");
    expect(types).not.toContain("PlayerLocationChanged");
    expect(types).not.toContain("JourneyCompleted");

    const world = app.projection.getSnapshot();
    expect(world.currentLocationId).toBe("river_waystation");
    expect(world.activeJourneyId).not.toBeNull();

    const firstWait = runCommandCycle(app, "ждать", "journey-e2e:wait-1");

    expect((firstWait as { tickEvents: Array<{ type: string }> }).tickEvents.some((e) => e.type === "TickPassed")).toBe(true);
    const secondWait = runCommandCycle(app, "ждать", "journey-e2e:wait-2");
    expect((secondWait as { tickEvents: Array<{ type: string }> }).tickEvents.some((e) => e.type === "JourneyCompleted")).toBe(true);
    const completed = app.projection.getSnapshot();
    expect(completed.currentLocationId).toBe("blackwood_edge");
    expect(completed.activeJourneyId).toBeNull();
    expect(completed.spatialKnowledge?.locations.get("blackwood_edge")?.knowledge).toBe("traversed");
    expect(completed.spatialKnowledge?.relations.get("road_waystation_forest")?.knowledge).toBe("traversed");
  });

  it("stops a journey without revealing the destination", () => {
    const app = createHarness("living_region", "interrupt-e2e").app;
    runCommandCycle(app, "идти к Кромке Чёрного леса", "interrupt-e2e:start");

    const result = runCommandCycle(app, "остановиться", "interrupt-e2e:stop");

    const events = (result as { events: Array<{ type: string }> }).events;
    expect(events.some((event) => event.type === "JourneyInterrupted")).toBe(true);
    const world = app.projection.getSnapshot();
    expect(world.activeJourneyId).toBeNull();
    expect(world.currentLocationId).toBe("river_waystation");
    expect(world.spatialKnowledge?.locations.get("riverwatch_city")?.knowledge).not.toBe("traversed");
    expect(world.spatialKnowledge?.relations.get("road_waystation_forest")?.knowledge).toBe("observed");
  });

  it("keeps an active journey paused during offline ticks", () => {
    const app = createHarness("living_region", "offline-e2e").app;
    runCommandCycle(app, "идти к Кромке Чёрного леса", "offline-e2e:start");
    const before = app.projection.getSnapshot();
    const result = runOfflineTicks(app, 3, "offline-e2e:wait");
    expect(result && "tickEvents" in result).toBe(true);
    const after = app.projection.getSnapshot();
    expect(after.activeJourneyId).toBe(before.activeJourneyId);
    const journey = after.activeJourneyId ? after.journeys.get(after.activeJourneyId) : undefined;
    const beforeJourney = before.activeJourneyId ? before.journeys.get(before.activeJourneyId) : undefined;
    expect(journey?.elapsedTicks).toBe(beforeJourney?.elapsedTicks);
    expect(after.currentLocationId).toBe("river_waystation");
  });

  it("does not navigate to canonical content that the observer has not discovered", () => {
    const harness = createHarness("living_region", "content-e2e");
    const app = harness.app;

    const result = runCommandCycle(app, "\u0438\u0434\u0442\u0438 \u043a \u0432\u043e\u0434\u043e\u043f\u0430\u0434\u0430\u043c", "content-e2e:go-waterfalls");
    const events = (result as { events: Array<{ type: string }> }).events;
    expect(events.some((event) => event.type === "JourneyBlocked")).toBe(true);
    expect(app.projection.getSnapshot().currentLocationId).toBe("river_waystation");
  });

  it("reports an unknown destination honestly without moving", () => {
    const harness = createHarness("living_region", "journey-e2e-blocked");
    const app = harness.app;

    const result = runCommandCycle(app, "\u0438\u0434\u0442\u0438 \u0432 \u043d\u0438\u043a\u0443\u0434\u0430", "journey-e2e:blocked");
    const events = (result as { events: Array<{ type: string }> }).events;
    expect(events.some((e) => e.type === "JourneyBlocked")).toBe(true);
    expect(app.projection.getSnapshot().currentLocationId).toBe("river_waystation");
  });
});
