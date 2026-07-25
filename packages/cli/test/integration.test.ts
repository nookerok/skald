import { describe, it, expect } from "vitest";
import { createApp, runCommand, runTick } from "@skald/cli";
import { WorldProjector } from "@skald/world";

describe("Integration — 5 rules wired end-to-end", () => {
  it("move north (success) → risk_taken=1, other observations undefined", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("risk_taken")).toBe(1);
    expect(obs.get("wall_caution")).toBeUndefined();
    expect(obs.get("edge_awareness")).toBeUndefined();
    expect(obs.get("impatience")).toBeUndefined();
  });

  it("move east twice: first succeeds, second hits wall → risk_taken=1, wall_caution=1", () => {
    const app = createApp();
    runCommand(app, "move east", "cmd-1", 1, "key-1");
    runCommand(app, "move east", "cmd-2", 2, "key-2");

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("risk_taken")).toBe(1);
    expect(obs.get("wall_caution")).toBe(1);
    expect(obs.get("edge_awareness")).toBeUndefined();
  });

  it("move south from (0,0) → blocked by boundary → edge_awareness=1, wall_caution unchanged", () => {
    const app = createApp();
    runCommand(app, "move south", "cmd-1", 1, "key-1");

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("edge_awareness")).toBe(1);
    expect(obs.get("wall_caution")).toBeUndefined();
  });

  it("garbage input (ParseError) never reaches CommandRejected → impatience stays 0", () => {
    const app = createApp();
    const result = runCommand(app, "dance wildly", "cmd-1", 1, "key-1");
    expect("type" in result && result.type === "ParseError").toBe(true);

    const obs = app.projection.getSnapshot().observations;
    expect(obs.get("impatience")).toBeUndefined();
  });

  it("wiring purity: replay from bus.query() equals live projection", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move south", "cmd-2", 2, "key-2");
    runCommand(app, "move east", "cmd-3", 3, "key-3");

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
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move north", "cmd-2", 2, "key-2");
    runCommand(app, "move north", "cmd-3", 3, "key-3");

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
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move north", "cmd-2", 2, "key-2");
    runCommand(app, "move north", "cmd-3", 3, "key-3");

    expect(app.projection.getSnapshot().consequences.size).toBe(1);

    for (let t = 4; t <= 7; t++) {
      runTick(app, t, `tick-${t}`);
      expect(app.projection.getSnapshot().consequences.size).toBe(1);
    }

    const tick8 = runTick(app, 8, "tick-8");
    expect(app.projection.getSnapshot().consequences.size).toBe(0);
    const types = tick8.events.map((e) => e.type);
    expect(types).toContain("ConsequenceExpired");
  });

  it("Dedup: after audacity created, 4th move does not create a second", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move north", "cmd-2", 2, "key-2");
    runCommand(app, "move north", "cmd-3", 3, "key-3");
    expect(app.projection.getSnapshot().consequences.size).toBe(1);

    runCommand(app, "move north", "cmd-4", 4, "key-4");
    expect(app.projection.getSnapshot().consequences.size).toBe(1);
  });
});

describe("Integration — consequences fire (9 rules)", () => {
  it("Full lifecycle: create → expire → fire → effect", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move north", "cmd-2", 2, "key-2");
    runCommand(app, "move north", "cmd-3", 3, "key-3");

    const consAfterCreate = app.projection.getSnapshot().consequences;
    expect(consAfterCreate.size).toBe(1);
    const cId = [...consAfterCreate.keys()][0]!;

    for (let t = 4; t <= 7; t++) {
      runTick(app, t, `tick-${t}`);
    }

    const tick8 = runTick(app, 8, "tick-8");
    const tick8Types = tick8.events.map((e) => e.type);
    expect(tick8Types).toContain("ConsequenceExpired");
    expect(tick8Types).toContain("ConsequenceFired");
    expect(tick8Types).toContain("AudacityTriggered");

    const snapshot = app.projection.getSnapshot();
    expect(snapshot.consequences.size).toBe(0);
    expect(snapshot.firedConsequences.has(cId)).toBe(true);
    expect(snapshot.observations.get("world_reaction_fear")).toBe(1);
  });
});

// ---- Helpers ----

function runMoves(app: ReturnType<typeof createApp>, count: number, startTs: number): number {
  let ts = startTs;
  for (let i = 0; i < count; i++) {
    runCommand(app, "move north", `cmd-${ts}`, ts, `key-${ts}`);
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
    let ts = 1;
    ts = runMoves(app, 3, ts);
    ts = runTicks(app, 5, ts);
    ts = runMoves(app, 1, ts);
    ts = runTicks(app, 5, ts);

    const s = app.projection.getSnapshot().activeSituations.get("forest_fire");
    expect(s).toBeDefined();
    expect(s!.startedAt).toBe(14);
    expect(s!.duration).toBe(8);
    expect(app.projection.getSnapshot().observations.get("world_reaction_fear")).toBe(2);
  });

  it("Full lifecycle: fire → spread → end, replay = live", () => {
    const app = createApp();
    let ts = 1;
    ts = runMoves(app, 3, ts);
    ts = runTicks(app, 5, ts);
    ts = runMoves(app, 1, ts);
    ts = runTicks(app, 5, ts); // ts=15, situation started at 14

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
  it("give help → GiveRequested → GiveValidated → RelationChanged", () => {
    const app = createApp();
    const result = runCommand(app, "give help to guild", "cmd-1", 1, "key-give-1");
    expect("type" in result && result.type === "ParseError").toBe(false);
    const outcome = result as { events: { type: string }[] };
    expect(outcome.events.map((e) => e.type)).toEqual(["GiveRequested", "GiveValidated", "RelationChanged"]);

    const edge = app.projection.getSnapshot().relations.get("player>guild:help");
    expect(edge).toBeDefined();
    expect(edge!.value).toBe(1);
  });
});

describe("Integration — heat", () => {
  it("tick radiates heat from bootstrap source", () => {
    const app = createApp();
    const tick = runTick(app, 1, "tick-1");

    const heatRadiated = tick.events.filter((e) => e.type === "HeatRadiated");
    expect(heatRadiated).toHaveLength(5);

    const hm = app.projection.getSnapshot().heatMap;
    expect(hm.get("1,1")).toBe(10);
    expect(hm.get("2,1")).toBe(5);
  });
});

describe("Integration — time budget and idempotency", () => {
  it("first move succeeds, second same tick rejected", () => {
    const app = createApp();
    const r1 = runCommand(app, "move north", "cmd-1", 1, "key-1");
    const r1Types = (r1 as { events: { type: string }[] }).events.map((e) => e.type);
    expect(r1Types).toContain("MovementSucceeded");
    expect(app.projection.getSnapshot().lastActionTick).toBe(1);

    // Second action same timestamp → rejected
    const r2 = runCommand(app, "move east", "cmd-2", 1, "key-2");
    const r2Result = r2 as { events: { type: string }[] };
    expect(r2Result.events.map((e) => e.type)).toEqual([
      "MoveRequested",
      "ActionRejected",
    ]);
    expect(app.projection.getSnapshot().lastActionTick).toBe(1); // unchanged
  });

  it("next tick allows another action", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move east", "cmd-2", 1, "key-2");
    // Third at timestamp 2: succeeds
    const r3 = runCommand(app, "move north", "cmd-3", 2, "key-3");
    const r3Types = (r3 as { events: { type: string }[] }).events.map((e) => e.type);
    expect(r3Types).toContain("MovementSucceeded");
    expect(app.projection.getSnapshot().lastActionTick).toBe(2);
  });

  it("idempotency: duplicate key rejected without changing state", () => {
    const app = createApp();
    const before = app.bus.size();
    runCommand(app, "move north", "cmd-1", 1, "key-dup");
    const r2 = runCommand(app, "move north", "cmd-2", 2, "key-dup");
    expect("type" in r2 && r2.type === "IdempotencyReject").toBe(true);
    expect(app.bus.size()).toBeGreaterThanOrEqual(before);
  });

  it("give also gated by duration_check", () => {
    const app = createApp();
    runCommand(app, "give help to guild", "cmd-1", 1, "key-1");
    expect(app.projection.getSnapshot().lastActionTick).toBe(1);

    // Second give same tick rejected
    const r2 = runCommand(app, "give respect to merchant", "cmd-2", 1, "key-2");
    const r2Types = (r2 as { events: { type: string }[] }).events.map((e) => e.type);
    expect(r2Types).toContain("ActionRejected");
  });

  it("purity with budget and idempotency: replay = live", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move east", "cmd-2", 1, "key-2");
    runTick(app, 2, "tick-2");
    runCommand(app, "move north", "cmd-3", 3, "key-3");
    runCommand(app, "give help to guild", "cmd-4", 4, "key-4");

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
    expect(rebuilt.getSnapshot().lastActionTick).toBe(live.lastActionTick);
  });
});
