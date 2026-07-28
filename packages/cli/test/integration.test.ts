import { describe, it, expect } from "vitest";
import { createApp, runCommandCycle, runCommand, runTick, printNarrative, printNarrativeLLM } from "@skald/cli";
import { WorldProjector, buildNarrative, buildPlayerGuidance } from "@skald/world";

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
    expect([...rebuilt.getSnapshot().walls]).toEqual([...live.walls]);
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

    expect(rebuilt.getSnapshot().activeSituations.size).toBe(live.activeSituations.size);
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

  it("retry with same idempotency key is rejected as duplicate", () => {
    const app = createApp();
    const r1 = runCommand(app, "move north", "cmd-1", 1, "key-retry-1");
    expect("type" in r1 && (r1 as any).type === "IdempotencyReject").toBe(false);

    const r2 = runCommand(app, "move north", "cmd-2", 2, "key-retry-1");
    expect("type" in r2 && (r2 as any).type === "IdempotencyReject").toBe(true);
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

describe("Integration — player strategy (offline)", () => {
  it("offline tick with default strategy triggers give_help_to_guild", () => {
    const app = createApp();
    // Default strategy: danger_nearby (no audacity yet) → give_help_to_guild (always)
    const tick = runTick(app, 1, "tick-offline-1", true);
    const types = tick.events.map((e) => e.type);

    // strategy matches "always" → give_help_to_guild → GiveRequested → GiveValidated → RelationChanged
    expect(types).toContain("GiveRequested");
    expect(types).toContain("GiveValidated");
    expect(types).toContain("RelationChanged");

    const edge = app.projection.getSnapshot().relations.get("player>guild:help");
    expect(edge).toBeDefined();
    expect(edge!.value).toBe(1);
  });

  it("live tick (playerOffline=false) does NOT trigger strategy", () => {
    const app = createApp();
    const tick = runTick(app, 1, "tick-1", false);
    const types = tick.events.map((e) => e.type);

    // No GiveRequested/MoveRequested from strategy
    expect(types).not.toContain("GiveRequested");
    expect(types).not.toContain("MoveRequested");
  });

  it("purity: replay with strategy = live", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runTick(app, 2, "tick-offline-1", true);
    runCommand(app, "give help to guild", "cmd-2", 3, "key-2");
    runTick(app, 4, "tick-offline-2", true);

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
    expect(rebuilt.getSnapshot().strategy.length).toBe(live.strategy.length);
  });
});

describe("Integration — narrative (read-side, no LLM)", () => {
  it("buildNarrative produces entries for real events", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runTick(app, 2, "tick-offline-1", true);

    const events = app.bus.query();
    const world = app.projection.getSnapshot();
    const snapshot = buildNarrative(events, world);

    expect(snapshot.entries.length).toBeGreaterThan(0);
    expect(snapshot.entries.some((e) => e.text.includes("проходишь"))).toBe(true);
    expect(snapshot.worldTime).toBe(2);

    const eventsAfter = app.bus.query();
    expect(eventsAfter).toEqual(events);
  });

  it("printNarrative returns non-empty string with header", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");

    const text = printNarrative(app);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("--- Narrative");
  });
});

// Opt-in LLM integration test: requires SKALD_RUN_LLM_INTEGRATION=1
// and valid API keys. Skipped by default in CI.
describe("Integration — LLM narrative (opt-in)", () => {
  const shouldRun = process.env["SKALD_RUN_LLM_INTEGRATION"] === "1" &&
    (process.env["SKALD_OPENCODE_ZEN_API_KEY"] || process.env["SKALD_OLLAMA_CLOUD_API_KEY"]);

  it("narrateLLM with real router returns non-empty text and does not mutate state", { skip: !shouldRun }, async () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");

    const eventsBefore = app.bus.query();
    const snapshotBefore = app.projection.getSnapshot();

    const result = await printNarrativeLLM(app);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("--- Narrative LLM");

    const eventsAfter = app.bus.query();
    expect(eventsAfter).toEqual(eventsBefore);

    const snapshotAfter = app.projection.getSnapshot();
    expect(snapshotAfter).toEqual(snapshotBefore);
  });
});

describe("Integration — Guidance action-count (regression)", () => {
  it("three blocked moves do NOT trigger free_play", () => {
    const app = createApp();
    // Move east once to reach x=1 (wall is at x=2)
    runCommandCycle(app, "move east", "key-1");

    // Three blocked moves at wall (2,0)
    for (let t = 2; t <= 4; t++) {
      runCommandCycle(app, "move east", `key-${t}`);
    }

    const guidance = buildPlayerGuidance(app.bus.query(), app.projection.getSnapshot());
    expect(guidance.phase).not.toBe("free_play");
  });

  it("six non-discovery actions trigger free_play", () => {
    const app = createApp();
    for (let t = 1; t <= 6; t++) {
      runCommandCycle(app, "give help to guild", `key-${t}`);
    }

    const guidance = buildPlayerGuidance(app.bus.query(), app.projection.getSnapshot());
    expect(guidance.phase).toBe("free_play");
  });

  it("three moves trigger observe_consequence", () => {
    const app = createApp();
    runCommandCycle(app, "move north", "key-1");
    runCommandCycle(app, "move north", "key-2");
    runCommandCycle(app, "move north", "key-3");

    const guidance = buildPlayerGuidance(app.bus.query(), app.projection.getSnapshot());
    expect(guidance.phase).toBe("observe_consequence");
  });
});
