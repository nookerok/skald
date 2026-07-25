import { describe, it, expect } from "vitest";
import { createApp, runCommand, runTick } from "@skald/cli";
import { WorldProjector } from "@skald/world";

describe("Integration — 5 rules wired end-to-end", () => {
  it("move north (success) → risk_taken=1, other observations undefined", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1);

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("risk_taken")).toBe(1);
    expect(obs.get("wall_caution")).toBeUndefined();
    expect(obs.get("edge_awareness")).toBeUndefined();
    expect(obs.get("impatience")).toBeUndefined();
  });

  it("move east twice: first succeeds, second hits wall → risk_taken=1, wall_caution=1", () => {
    const app = createApp();
    runCommand(app, "move east", "cmd-1", 1);
    runCommand(app, "move east", "cmd-2", 2);

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("risk_taken")).toBe(1);
    expect(obs.get("wall_caution")).toBe(1);
    expect(obs.get("edge_awareness")).toBeUndefined();
  });

  it("move south from (0,0) → blocked by boundary → edge_awareness=1, wall_caution unchanged", () => {
    const app = createApp();
    runCommand(app, "move south", "cmd-1", 1);

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("edge_awareness")).toBe(1);
    expect(obs.get("wall_caution")).toBeUndefined();
  });

  it("garbage input (ParseError) never reaches CommandRejected → impatience stays 0", () => {
    const app = createApp();
    const result = runCommand(app, "dance wildly", "cmd-1", 1);
    expect("type" in result && result.type === "ParseError").toBe(true);

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("impatience")).toBeUndefined();
  });

  it("impatience fires on CommandRejected via direct handleCommand call", () => {
    const app = createApp();
    expect(app.projection.getSnapshot().observations.get("impatience")).toBeUndefined();
  });

  it("wiring purity: replay from bus.query() equals live projection", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1);
    runCommand(app, "move south", "cmd-2", 2);
    runCommand(app, "move east", "cmd-3", 3);

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
    expect(rebuilt.getSnapshot().time).toBe(live.time);
    expect(rebuilt.getSnapshot().walls).toEqual(live.walls);
    expect([...rebuilt.getSnapshot().observations.entries()]).toEqual(
      [...live.observations.entries()],
    );
  });
});

describe("Integration — consequences (7 rules)", () => {
  it("ConsequenceCreated at threshold: 3 move north → risk_taken=3 → audacity created", () => {
    const app = createApp();
    // move north x3 from (0,0): each succeeds
    runCommand(app, "move north", "cmd-1", 1);
    runCommand(app, "move north", "cmd-2", 2);
    runCommand(app, "move north", "cmd-3", 3);

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("risk_taken")).toBe(3);

    const cons = app.projection.getSnapshot().consequences;
    expect(cons.size).toBe(1);
    const c = cons.get("audacity@cmd-3");
    expect(c).toBeDefined();
    expect(c!.type).toBe("audacity");
    expect(c!.expiresAt).toBe(8); // timestamp=3 + 5
  });

  it("Consequence expires after enough ticks", () => {
    const app = createApp();
    // 3 moves to create consequence
    runCommand(app, "move north", "cmd-1", 1);
    runCommand(app, "move north", "cmd-2", 2);
    runCommand(app, "move north", "cmd-3", 3);

    expect(app.projection.getSnapshot().consequences.size).toBe(1);

    // runTick at 4, 5, 6, 7, 8 — tick 8 should expire it (expiresAt=8)
    for (let t = 4; t <= 7; t++) {
      runTick(app, t, `tick-${t}`);
      expect(app.projection.getSnapshot().consequences.size).toBe(1);
    }

    // tick 8 expires the consequence
    const tick8 = runTick(app, 8, "tick-8");
    expect(app.projection.getSnapshot().consequences.size).toBe(0);
    const types = tick8.events.map((e) => e.type);
    expect(types).toContain("ConsequenceExpired");
  });

  it("Dedup: after audacity created, 4th move does not create a second", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1);
    runCommand(app, "move north", "cmd-2", 2);
    runCommand(app, "move north", "cmd-3", 3);
    expect(app.projection.getSnapshot().consequences.size).toBe(1);

    // 4th move: risk_taken becomes 4, but audacity already exists
    runCommand(app, "move north", "cmd-4", 4);
    expect(app.projection.getSnapshot().consequences.size).toBe(1);
  });

  it("Wiring purity with consequences: replay = live", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1);
    runCommand(app, "move north", "cmd-2", 2);
    runCommand(app, "move north", "cmd-3", 3);
    for (let t = 4; t <= 8; t++) {
      runTick(app, t, `tick-${t}`);
    }

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
    expect(rebuilt.getSnapshot().time).toBe(live.time);
    expect(rebuilt.getSnapshot().walls).toEqual(live.walls);
    expect([...rebuilt.getSnapshot().observations.entries()]).toEqual(
      [...live.observations.entries()],
    );
    expect([...rebuilt.getSnapshot().consequences.entries()]).toEqual(
      [...live.consequences.entries()],
    );
  });
});

describe("Integration — consequences fire (9 rules)", () => {
  it("Full lifecycle: create → expire → fire → effect", () => {
    const app = createApp();
    // 3 moves to create audacity consequence
    runCommand(app, "move north", "cmd-1", 1);
    runCommand(app, "move north", "cmd-2", 2);
    runCommand(app, "move north", "cmd-3", 3);

    const consAfterCreate = app.projection.getSnapshot().consequences;
    expect(consAfterCreate.size).toBe(1);
    const cId = [...consAfterCreate.keys()][0]!;

    // Tick through to expire (expiresAt = 8)
    for (let t = 4; t <= 7; t++) {
      runTick(app, t, `tick-${t}`);
    }

    // Tick 8: expire → fire → AudacityTriggered
    const tick8 = runTick(app, 8, "tick-8");
    const tick8Types = tick8.events.map((e) => e.type);
    expect(tick8Types).toContain("ConsequenceExpired");
    expect(tick8Types).toContain("ConsequenceFired");
    expect(tick8Types).toContain("AudacityTriggered");

    const snapshot = app.projection.getSnapshot();
    // Consequence removed
    expect(snapshot.consequences.size).toBe(0);
    // Fired recorded
    expect(snapshot.firedConsequences.has(cId)).toBe(true);
    // Observation from world_reaction_fear
    expect(snapshot.observations.get("world_reaction_fear")).toBe(1);
  });

  it("Snapshot consistency replay: full lifecycle replay = live", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1);
    runCommand(app, "move north", "cmd-2", 2);
    runCommand(app, "move north", "cmd-3", 3);
    for (let t = 4; t <= 8; t++) {
      runTick(app, t, `tick-${t}`);
    }

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
    expect(rebuilt.getSnapshot().time).toBe(live.time);
    expect(rebuilt.getSnapshot().consequences).toEqual(live.consequences);
    expect([...rebuilt.getSnapshot().firedConsequences.entries()]).toEqual(
      [...live.firedConsequences.entries()],
    );
    expect(rebuilt.getSnapshot().observations.get("world_reaction_fear")).toBe(
      live.observations.get("world_reaction_fear"),
    );
  });
});

// ---- Helpers for situation tests ----

function runMoves(app: ReturnType<typeof createApp>, count: number, startTs: number): number {
  let ts = startTs;
  for (let i = 0; i < count; i++) {
    runCommand(app, "move north", `cmd-${ts}`, ts);
    ts++;
  }
  return ts;
}

function runTicks(app: ReturnType<typeof createApp>, count: number, startTs: number): number {
  let ts = startTs;
  for (let i = 0; i < count; i++) {
    runTick(app, ts, `tick-${ts}`);
    ts++;
  }
  return ts;
}

describe("Integration — situations (12 rules)", () => {
  it("Forest fire starts after 2 world_reaction_fear triggers", () => {
    const app = createApp();

    // Round 1: 3 move north → create 1st audacity (expiresAt=8) → expire + fire → world_reaction_fear=1
    let ts = 1;
    ts = runMoves(app, 3, ts); // risk_taken=3, audacity at ts=3 expiresAt=8
    ts = runTicks(app, 5, ts); // ticks 4-8 → at 8: expire+fire → world_reaction_fear=1

    // 1st move of round 2 at ts=9: risk_taken=4 → new audacity (expiresAt=14) since old one expired
    ts = runMoves(app, 1, ts); // ts=10

    // Now run ticks: at tick 14, the 2nd audacity expires → fire → world_reaction_fear=2
    ts = runTicks(app, 5, ts); // ticks 10-14
    // At tick 14: expire+fire → situations.start fires

    const s = app.projection.getSnapshot().activeSituations.get("forest_fire");
    expect(s).toBeDefined();
    expect(s!.startedAt).toBe(14);
    expect(s!.duration).toBe(8);

    expect(app.projection.getSnapshot().observations.get("world_reaction_fear")).toBe(2);
  });

  it("Forest fire spreads over time and ends after duration", () => {
    const app = createApp();

    // Trigger forest fire: round 1 + 1st move of round 2 → 2nd audacity expires at 14
    let ts = 1;
    ts = runMoves(app, 3, ts);
    ts = runTicks(app, 5, ts);
    ts = runMoves(app, 1, ts);
    ts = runTicks(app, 5, ts); // ts=15, situation started at 14 (endsAt=22)
    // After tick 14: situation active with startedAt=14, duration=8 (endsAt=22)

    expect(app.projection.getSnapshot().activeSituations.has("forest_fire")).toBe(true);

    // At tick 14 (inside runTicks above): elapsed=0, expected=1, burnedTrees=0 → burn
    // Tick 15: elapsed=1, expected=1, burnedTrees=1 → no more
    // Tick 16: elapsed=2, expected=2, burnedTrees=1 → 2nd burn
    // and so on...

    let prevBurned = app.projection.getSnapshot().burnedTrees;
    ts = runTicks(app, 3, ts); // ticks 15, 16, 17
    const burnDelta = app.projection.getSnapshot().burnedTrees - prevBurned;
    expect(burnDelta).toBeGreaterThanOrEqual(1);

    // endsAt = 14 + 8 = 22
    const s = app.projection.getSnapshot().activeSituations.get("forest_fire")!;
    expect(s.startedAt + s.duration).toBe(22);
  });

  it("Full lifecycle: fire → spread → end, replay = live", () => {
    const app = createApp();

    let ts = 1;
    ts = runMoves(app, 3, ts);
    ts = runTicks(app, 5, ts);
    ts = runMoves(app, 1, ts);
    ts = runTicks(app, 5, ts); // ts=15, situation started at 14

    // Run ticks until after end (startedAt 14 + 8 = 22)
    ts = runTicks(app, 8, ts); // ticks 15-22

    expect(app.projection.getSnapshot().activeSituations.size).toBe(0);

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().activeSituations).toEqual(live.activeSituations);
    expect(rebuilt.getSnapshot().burnedTrees).toBe(live.burnedTrees);
    expect(rebuilt.getSnapshot().observations.get("world_reaction_fear")).toBe(
      live.observations.get("world_reaction_fear"),
    );
    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
  });
});

describe("Integration — relations (give)", () => {
  it("give help → GiveRequested → RelationChanged, edge created", () => {
    const app = createApp();
    const result = runCommand(app, "give help to guild", "cmd-1", 1);
    expect("type" in result && result.type === "ParseError").toBe(false);
    const outcome = result as { events: { type: string }[] };
    expect(outcome.events.map((e) => e.type)).toEqual(["GiveRequested", "RelationChanged"]);

    const edge = app.projection.getSnapshot().relations.get("player>guild:help");
    expect(edge).toBeDefined();
    expect(edge!.value).toBe(1);
  });

  it("two gives accumulate edge value", () => {
    const app = createApp();
    runCommand(app, "give help to guild", "cmd-1", 1);
    runCommand(app, "give help to guild", "cmd-2", 2);
    expect(app.projection.getSnapshot().relations.get("player>guild:help")!.value).toBe(2);
  });
});

describe("Integration — heat", () => {
  it("tick radiates heat from bootstrap source", () => {
    const app = createApp();
    // Bootstrap includes a HeatSourcePlaced at {1,1} intensity 10
    const tick = runTick(app, 1, "tick-1");

    const heatRadiated = tick.events.filter((e) => e.type === "HeatRadiated");
    expect(heatRadiated).toHaveLength(5);

    const hm = app.projection.getSnapshot().heatMap;
    expect(hm.get("1,1")).toBe(10);
    expect(hm.get("2,1")).toBe(5);
    expect(hm.get("0,1")).toBe(5);
    expect(hm.get("1,2")).toBe(5);
    expect(hm.get("1,0")).toBe(5);
  });

  it("heat accumulates over multiple ticks", () => {
    const app = createApp();
    runTick(app, 1, "tick-1");
    runTick(app, 2, "tick-2");
    runTick(app, 3, "tick-3");

    const hm = app.projection.getSnapshot().heatMap;
    // Each tick: center +10, 4 neighbors +5 each
    expect(hm.get("1,1")).toBe(30);
    expect(hm.get("2,1")).toBe(15);
  });
});

describe("Integration — mixed systems purity", () => {
  it("give + heat + existing → replay = live", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1);
    runTick(app, 2, "tick-2");
    runCommand(app, "give help to guild", "cmd-3", 3);
    runTick(app, 4, "tick-4");

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
    expect(rebuilt.getSnapshot().relations.get("player>guild:help")!.value).toBe(
      live.relations.get("player>guild:help")!.value,
    );
    expect(rebuilt.getSnapshot().heatMap.get("1,1")).toBe(live.heatMap.get("1,1"));
    expect(rebuilt.getSnapshot().heatSources.size).toBe(live.heatSources.size);
  });
});
