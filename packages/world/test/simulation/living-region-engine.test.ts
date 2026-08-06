/**
 * Living region engine cycle.
 *
 * Proves the new simulation systems run through the real RuleEngine path
 * (working clone with seeded read views), not just in direct rule.handle()
 * unit tests: weather, river and settlement all emit from one TickPassed.
 */

import { describe, it, expect } from "vitest";
import { EventBus } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import { WorldProjector, createRules, buildPilotRegionBootstrapEvents } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

function tick(ts: number, eventId: string): DomainEvent {
  return {
    eventId,
    type: "TickPassed",
    schemaVersion: 1,
    payload: { delta: 1 },
    timestamp: ts,
    correlationId: `tick-${ts}`,
    causationId: null,
  };
}

describe("living region engine cycle", () => {
  it("drives weather, river and settlement from a single tick", () => {
    const bus = new EventBus();
    const projection = new WorldProjector();
    for (const e of buildPilotRegionBootstrapEvents()) {
      bus.append(e);
      projection.apply(e);
    }
    const engine = new RuleEngine(createRules(), projection, bus);

    const { committed } = engine.process(tick(1, "t-1"));
    const types = new Set(committed.map((e) => e.type));
    expect(types.has("WeatherStateChanged")).toBe(true);
    expect(types.has("RiverLevelChanged")).toBe(true);
    expect(types.has("SettlementStateChanged")).toBe(true);
  });

  it("keeps evolving read views across a run of ticks", () => {
    const bus = new EventBus();
    const projection = new WorldProjector();
    for (const e of buildPilotRegionBootstrapEvents()) {
      bus.append(e);
      projection.apply(e);
    }
    const engine = new RuleEngine(createRules(), projection, bus);

    const allTypes = new Set<string>();
    for (let ts = 1; ts <= 8; ts++) {
      const { committed } = engine.process(tick(ts, `t-${ts}`));
      for (const e of committed) allTypes.add(e.type);
    }

    // River crosses the "difficult" threshold during the rising half-cycle,
    // proving the spatial read view stays live across engine ticks.
    expect(allTypes.has("CrossingConditionChanged")).toBe(true);

    // Weather keeps changing and the read view is derived from committed events.
    const world = projection.getSnapshot();
    expect(world.weather?.weatherStates.get("weather-region")).toBeDefined();
    expect(world.spatial?.riverStates.get("river_basin")?.level).toBeGreaterThan(40);
  });
});
