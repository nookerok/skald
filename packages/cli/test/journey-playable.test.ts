/**
 * Playable journey integration test.
 * A real living_region world (via the eval harness composition root) travels
 * from the waystation to the city through the full command cycle:
 * "идти к Речному Стражу" -> JourneyRequested -> JourneyValidated ->
 * JourneyStarted -> TickPassed*N -> PlayerLocationChanged -> JourneyCompleted.
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "../src/eval/harness.js";
import { runCommandCycle } from "../src/index.js";

describe("playable journey in the living region", () => {
  it("travels from the waystation to the city in one command cycle", () => {
    const harness = createHarness("living_region", "journey-e2e");
    const app = harness.app;

    const before = app.projection.getSnapshot().currentLocationId;
    expect(before).toBe("river_waystation");

    const result = runCommandCycle(app, "идти к Речному Стражу", "journey-e2e:go-city");
    expect(result && typeof result === "object" && "events" in result).toBe(true);
    const events = (result as { events: Array<{ type: string }> }).events;

    const types = events.map((e) => e.type);
    expect(types).toContain("JourneyRequested");
    expect(types).toContain("JourneyValidated");
    expect(types).toContain("JourneyStarted");
    expect(types).toContain("PlayerLocationChanged");
    expect(types).toContain("JourneyCompleted");

    const world = app.projection.getSnapshot();
    expect(world.currentLocationId).toBe("riverwatch_city");
    expect(world.activeJourneyId).toBeNull();
  });

  it("reports an unknown destination honestly without moving", () => {
    const harness = createHarness("living_region", "journey-e2e-blocked");
    const app = harness.app;

    const result = runCommandCycle(app, "идти в никуда", "journey-e2e:blocked");
    const events = (result as { events: Array<{ type: string }> }).events;
    expect(events.some((e) => e.type === "JourneyBlocked")).toBe(true);
    expect(app.projection.getSnapshot().currentLocationId).toBe("river_waystation");
  });
});
