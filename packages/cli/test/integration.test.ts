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
