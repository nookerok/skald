import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  rebuildProjection,
  bootstrapWorldEvents,
  START_POSITION,
  type ReadonlyWorld,
} from "@skald/world";

function normalizeWorld(w: ReadonlyWorld): Record<string, unknown> {
  return {
    player: w.player,
    walls: [...w.walls].sort(),
    observations: Object.fromEntries(w.observations),
    consequences: [...w.consequences.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    firedConsequences: [...w.firedConsequences.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    activeSituations: [...w.activeSituations.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    burnedTrees: w.burnedTrees,
    relations: [...w.relations.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    heatSources: [...w.heatSources.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    heatMap: Object.fromEntries(w.heatMap),
    lastActionTick: w.lastActionTick,
    strategy: w.strategy,
    eventNumber: w.eventNumber,
    time: w.time,
  };
}

function e(
  type: string,
  eventId: string,
  payload: unknown = {},
  timestamp = 1,
): DomainEvent {
  return {
    eventId,
    type,
    schemaVersion: 1,
    payload,
    timestamp,
    correlationId: "cmd-1",
    causationId: null,
  };
}

describe("WorldProjector", () => {
  it("starts at the documented start position with no walls and eventNumber 0", () => {
    const p = new WorldProjector();
    const w = p.getSnapshot();
    expect(w.player).toEqual(START_POSITION);
    expect(w.walls.size).toBe(0);
    expect(w.eventNumber).toBe(0);
    expect(w.time).toBe(0);
  });

  it("applying MovementSucceeded updates the player position", () => {
    const p = new WorldProjector();
    p.apply(e("PlayerSpawned", "boot", { x: 0, y: 0 }, 0));
    p.apply(e("MovementSucceeded", "m1", { x: 0, y: 1 }, 1));

    expect(p.getSnapshot().player).toEqual({ x: 0, y: 1 });
    expect(p.getSnapshot().eventNumber).toBe(2);
    expect(p.getSnapshot().time).toBe(1);
  });

  it("applying MovementBlocked leaves the position unchanged but still increments eventNumber/time", () => {
    const p = new WorldProjector();
    p.apply(e("PlayerSpawned", "boot", { x: 0, y: 0 }, 0));
    p.apply(e("MovementBlocked", "b1", { reason: "wall" }, 2));

    expect(p.getSnapshot().player).toEqual({ x: 0, y: 0 });
    expect(p.getSnapshot().eventNumber).toBe(2);
    expect(p.getSnapshot().time).toBe(2);
  });

  it("applying any other event leaves the position/walls unchanged but counts the event", () => {
    const p = new WorldProjector();
    p.apply(e("PlayerSpawned", "boot", { x: 0, y: 0 }, 0));
    p.apply(e("MoveRequested", "req", { direction: "north" }, 3));

    expect(p.getSnapshot().player).toEqual({ x: 0, y: 0 });
    expect(p.getSnapshot().eventNumber).toBe(2);
    expect(p.getSnapshot().time).toBe(3);
  });

  it("PlayerSpawned and WallPlaced populate the projection from the log", () => {
    const events = bootstrapWorldEvents();
    const p = rebuildProjection(events);

    expect(p.getSnapshot().player).toEqual(START_POSITION);
    expect(p.getSnapshot().walls.size).toBe(2);
    expect([...p.getSnapshot().walls].sort()).toEqual(["2,0", "3,3"]);
  });
});

describe("WorldProjector — observations", () => {
  it("applying ObservationUpdated increments an observation counter", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1));
    expect(p.getSnapshot().observations.get("risk_taken")).toBe(1);
  });

  it("applying multiple ObservationUpdated for the same key accumulates", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1));
    p.apply(e("ObservationUpdated", "o-2", { key: "risk_taken", delta: 3 }, 2));
    expect(p.getSnapshot().observations.get("risk_taken")).toBe(4);
  });

  it("applying ObservationUpdated for a new key creates it", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "wall_caution", delta: 5 }, 1));
    expect(p.getSnapshot().observations.get("wall_caution")).toBe(5);
  });

  it("still increments eventNumber and time for ObservationUpdated", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 7));
    expect(p.getSnapshot().eventNumber).toBe(1);
    expect(p.getSnapshot().time).toBe(7);
  });
});

describe("WorldProjector — Projection Purity (replay from scratch = current)", () => {
  it("deleting the projection and replaying the whole log reproduces it identically", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("MovementSucceeded", "mv-1", { x: 0, y: 1 }, 1),
      e("MovementBlocked", "mv-2", { reason: "wall" }, 2),
      e("MovementSucceeded", "mv-3", { x: 1, y: 1 }, 3),
    ];

    const original = rebuildProjection(events);
    // "Delete" the projection, then rebuild from the log alone.
    const rebuilt = rebuildProjection(events);

    expect(normalizeWorld(rebuilt.getSnapshot())).toEqual(normalizeWorld(original.getSnapshot()));
  });

  it("purity holds with observations: bootstrap + movements + ObservationUpdated", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("MovementSucceeded", "mv-1", { x: 0, y: 1 }, 1),
      e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1),
      e("MovementBlocked", "mv-2", { reason: "wall" }, 2),
      e("ObservationUpdated", "o-2", { key: "edge_awareness", delta: 1 }, 2),
      e("ObservationUpdated", "o-3", { key: "wall_caution", delta: 1 }, 2),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(normalizeWorld(rebuilt.getSnapshot())).toEqual(normalizeWorld(original.getSnapshot()));
    expect(rebuilt.getSnapshot().observations.get("risk_taken")).toBe(1);
    expect(rebuilt.getSnapshot().observations.get("edge_awareness")).toBe(1);
    expect(rebuilt.getSnapshot().observations.get("wall_caution")).toBe(1);
  });
});

describe("WorldProjector — consequences", () => {
  it("ConsequenceCreated adds a consequence to the map", () => {
    const p = new WorldProjector();
    const payload = {
      id: "aud@1",
      type: "audacity",
      severity: 1,
      createdAt: 5,
      expiresAt: 10,
      data: {},
    };
    p.apply(e("ConsequenceCreated", "c-1", payload, 5));

    const c = p.getSnapshot().consequences.get("aud@1");
    expect(c).toBeDefined();
    expect(c!.type).toBe("audacity");
    expect(c!.expiresAt).toBe(10);
  });

  it("ConsequenceExpired removes a consequence from the map", () => {
    const p = new WorldProjector();
    p.apply(e("ConsequenceCreated", "c-1", {
      id: "aud@1", type: "audacity", severity: 1, createdAt: 5, expiresAt: 10, data: {},
    }, 5));
    p.apply(e("ConsequenceExpired", "c-2", { id: "aud@1" }, 10));

    expect(p.getSnapshot().consequences.has("aud@1")).toBe(false);
  });

  it("TickPassed updates time without mutating consequences", () => {
    const p = new WorldProjector();
    p.apply(e("TickPassed", "t-1", { delta: 1 }, 10));

    expect(p.getSnapshot().time).toBe(10);
    expect(p.getSnapshot().consequences.size).toBe(0);
  });

  it("ConsequenceFired adds a firedConsequence record", () => {
    const p = new WorldProjector();
    p.apply(e("ConsequenceFired", "cf-1", {
      consequenceId: "aud@1", consequenceType: "audacity", firedAt: 10,
    }, 10));

    const f = p.getSnapshot().firedConsequences.get("aud@1");
    expect(f).toBeDefined();
    expect(f!.consequenceType).toBe("audacity");
    expect(f!.firedAt).toBe(10);
  });

  it("AudacityTriggered is no-op for state but increments eventNumber/time", () => {
    const p = new WorldProjector();
    p.apply(e("AudacityTriggered", "at-1", { target: "player", severity: 1 }, 7));

    expect(p.getSnapshot().eventNumber).toBe(1);
    expect(p.getSnapshot().time).toBe(7);
    expect(p.getSnapshot().consequences.size).toBe(0);
    expect(p.getSnapshot().firedConsequences.size).toBe(0);
  });

  it("ConsequenceExpired after ConsequenceFired: consequence removed but fired record persists", () => {
    const p = new WorldProjector();
    p.apply(e("ConsequenceCreated", "c-1", {
      id: "aud@1", type: "audacity", severity: 1, createdAt: 5, expiresAt: 10, data: {},
    }, 5));
    p.apply(e("ConsequenceFired", "cf-1", {
      consequenceId: "aud@1", consequenceType: "audacity", firedAt: 10,
    }, 10));
    p.apply(e("ConsequenceExpired", "ce-1", { id: "aud@1" }, 10));

    expect(p.getSnapshot().consequences.has("aud@1")).toBe(false);
    expect(p.getSnapshot().firedConsequences.has("aud@1")).toBe(true);
  });
});

describe("WorldProjector — Projection Purity with consequences", () => {
  it("purity holds: bootstrap + moves + observations + ConsequenceCreated + TickPassed + ConsequenceExpired", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("MovementSucceeded", "mv-1", { x: 0, y: 1 }, 1),
      e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1),
      e("MovementSucceeded", "mv-2", { x: 1, y: 1 }, 2),
      e("ObservationUpdated", "o-2", { key: "risk_taken", delta: 1 }, 2),
      e("MovementSucceeded", "mv-3", { x: 1, y: 2 }, 3),
      e("ObservationUpdated", "o-3", { key: "risk_taken", delta: 1 }, 3),
      e("ConsequenceCreated", "cc-1", {
        id: "aud@cmd-3",
        type: "audacity",
        severity: 1,
        createdAt: 3,
        expiresAt: 8,
        data: { threshold: 3 },
      }, 3),
      e("TickPassed", "t-1", { delta: 1 }, 3),
      e("TickPassed", "t-2", { delta: 1 }, 4),
      e("TickPassed", "t-3", { delta: 1 }, 5),
      e("TickPassed", "t-4", { delta: 1 }, 6),
      e("TickPassed", "t-5", { delta: 1 }, 7),
      e("TickPassed", "t-6", { delta: 1 }, 8),
      e("ConsequenceExpired", "ce-1", { id: "aud@cmd-3" }, 8),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(normalizeWorld(rebuilt.getSnapshot())).toEqual(normalizeWorld(original.getSnapshot()));
  });
});

describe("WorldProjector — Projection Purity with fired consequences", () => {
  it("purity holds: full lifecycle including fire and effect", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("MovementSucceeded", "mv-1", { x: 0, y: 1 }, 1),
      e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1),
      e("MovementSucceeded", "mv-2", { x: 1, y: 1 }, 2),
      e("ObservationUpdated", "o-2", { key: "risk_taken", delta: 1 }, 2),
      e("MovementSucceeded", "mv-3", { x: 1, y: 2 }, 3),
      e("ObservationUpdated", "o-3", { key: "risk_taken", delta: 1 }, 3),
      e("ConsequenceCreated", "cc-1", {
        id: "aud@cmd-3", type: "audacity", severity: 1, createdAt: 3, expiresAt: 8, data: { threshold: 3 },
      }, 3),
      e("TickPassed", "t-1", { delta: 1 }, 3),
      e("TickPassed", "t-2", { delta: 1 }, 4),
      e("TickPassed", "t-3", { delta: 1 }, 5),
      e("TickPassed", "t-4", { delta: 1 }, 6),
      e("TickPassed", "t-5", { delta: 1 }, 7),
      e("ConsequenceExpired", "ce-1", { id: "aud@cmd-3" }, 8),
      e("ConsequenceFired", "cf-1", {
        consequenceId: "aud@cmd-3", consequenceType: "audacity", firedAt: 8,
      }, 8),
      e("AudacityTriggered", "at-1", { target: "player", severity: 1 }, 8),
      e("ObservationUpdated", "o-4", { key: "world_reaction_fear", delta: 1 }, 8),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(normalizeWorld(rebuilt.getSnapshot())).toEqual(normalizeWorld(original.getSnapshot()));
  });
});

describe("WorldProjector — clone", () => {
  it("clone copies observations independently", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 3 }, 1));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("ObservationUpdated", "o-2", { key: "risk_taken", delta: 1 }, 2));

    expect(p.getSnapshot().observations.get("risk_taken")).toBe(3);
    expect(clone.getSnapshot().observations.get("risk_taken")).toBe(4);
  });

  it("clone copies consequences independently", () => {
    const p = new WorldProjector();
    p.apply(e("ConsequenceCreated", "c-1", {
      id: "aud@1", type: "audacity", severity: 1, createdAt: 5, expiresAt: 10, data: {},
    }, 5));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("ConsequenceExpired", "c-2", { id: "aud@1" }, 10));

    expect(p.getSnapshot().consequences.size).toBe(1);
    expect(clone.getSnapshot().consequences.size).toBe(0);
  });

  it("clone copies firedConsequences independently", () => {
    const p = new WorldProjector();
    p.apply(e("ConsequenceFired", "cf-1", {
      consequenceId: "aud@1", consequenceType: "audacity", firedAt: 10,
    }, 10));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("ConsequenceFired", "cf-2", {
      consequenceId: "aud@2", consequenceType: "other", firedAt: 11,
    }, 11));

    expect(p.getSnapshot().firedConsequences.size).toBe(1);
    expect(clone.getSnapshot().firedConsequences.size).toBe(2);
  });
});

describe("WorldProjector — situations", () => {
  it("SituationStarted adds an active situation", () => {
    const p = new WorldProjector();
    p.apply(e("SituationStarted", "s-1", {
      situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8, data: {},
    }, 5));

    const s = p.getSnapshot().activeSituations.get("forest_fire");
    expect(s).toBeDefined();
    expect(s!.type).toBe("forest_fire");
    expect(s!.duration).toBe(8);
  });

  it("SituationEnded removes an active situation", () => {
    const p = new WorldProjector();
    p.apply(e("SituationStarted", "s-1", {
      situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8, data: {},
    }, 5));
    p.apply(e("SituationEnded", "s-2", { situationId: "forest_fire" }, 13));

    expect(p.getSnapshot().activeSituations.has("forest_fire")).toBe(false);
  });

  it("TreeBurned increments burnedTrees", () => {
    const p = new WorldProjector();
    p.apply(e("TreeBurned", "t-1", { burnedAt: 5, treeIndex: 0 }, 5));
    expect(p.getSnapshot().burnedTrees).toBe(1);
    p.apply(e("TreeBurned", "t-2", { burnedAt: 7, treeIndex: 1 }, 7));
    expect(p.getSnapshot().burnedTrees).toBe(2);
  });

  it("ForestFireStarted is no-op for state but increments eventNumber/time", () => {
    const p = new WorldProjector();
    p.apply(e("ForestFireStarted", "ff-1", { startedAt: 5 }, 5));

    expect(p.getSnapshot().eventNumber).toBe(1);
    expect(p.getSnapshot().time).toBe(5);
    expect(p.getSnapshot().activeSituations.size).toBe(0);
  });
});

describe("WorldProjector — Projection Purity with situations", () => {
  it("purity holds: full lifecycle with situation, spread, and end", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("SituationStarted", "s-1", {
        situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8, data: {},
      }, 5),
      e("TickPassed", "t-1", { delta: 1 }, 5),
      e("TreeBurned", "tb-1", { burnedAt: 5, treeIndex: 0 }, 5),
      e("TickPassed", "t-2", { delta: 1 }, 6),
      e("TickPassed", "t-3", { delta: 1 }, 7),
      e("TreeBurned", "tb-2", { burnedAt: 7, treeIndex: 1 }, 7),
      e("TickPassed", "t-4", { delta: 1 }, 8),
      e("TickPassed", "t-5", { delta: 1 }, 9),
      e("TickPassed", "t-6", { delta: 1 }, 10),
      e("TreeBurned", "tb-3", { burnedAt: 10, treeIndex: 2 }, 10),
      e("SituationEnded", "se-1", { situationId: "forest_fire" }, 13),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(normalizeWorld(rebuilt.getSnapshot())).toEqual(normalizeWorld(original.getSnapshot()));
  });
});

describe("WorldProjector — clone with situations", () => {
  it("clone copies activeSituations independently", () => {
    const p = new WorldProjector();
    p.apply(e("SituationStarted", "s-1", {
      situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8, data: {},
    }, 5));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("SituationEnded", "s-2", { situationId: "forest_fire" }, 13));

    expect(p.getSnapshot().activeSituations.size).toBe(1);
    expect(clone.getSnapshot().activeSituations.size).toBe(0);
  });

  it("clone copies burnedTrees independently", () => {
    const p = new WorldProjector();
    p.apply(e("TreeBurned", "tb-1", { burnedAt: 5, treeIndex: 0 }, 5));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("TreeBurned", "tb-2", { burnedAt: 6, treeIndex: 1 }, 6));

    expect(p.getSnapshot().burnedTrees).toBe(1);
    expect(clone.getSnapshot().burnedTrees).toBe(2);
  });
});

describe("WorldProjector — relations", () => {
  it("RelationChanged creates or updates an edge", () => {
    const p = new WorldProjector();
    p.apply(e("RelationChanged", "rc-1", { from: "player", to: "guild", kind: "help", delta: 1 }, 1));

    const r = p.getSnapshot().relations.get("player>guild:help");
    expect(r).toBeDefined();
    expect(r!.value).toBe(1);

    p.apply(e("RelationChanged", "rc-2", { from: "player", to: "guild", kind: "help", delta: 1 }, 2));
    expect(p.getSnapshot().relations.get("player>guild:help")!.value).toBe(2);
  });

  it("RelationChanged delta that zeros value removes the edge", () => {
    const p = new WorldProjector();
    p.apply(e("RelationChanged", "rc-1", { from: "player", to: "guild", kind: "help", delta: 2 }, 1));
    p.apply(e("RelationChanged", "rc-2", { from: "player", to: "guild", kind: "help", delta: -2 }, 2));

    expect(p.getSnapshot().relations.has("player>guild:help")).toBe(false);
  });
});

describe("WorldProjector — heat", () => {
  it("HeatSourcePlaced adds a heat source", () => {
    const p = new WorldProjector();
    p.apply(e("HeatSourcePlaced", "hp-1", { x: 1, y: 1, intensity: 10 }, 0));

    const hs = p.getSnapshot().heatSources.get("1,1");
    expect(hs).toBeDefined();
    expect(hs!.intensity).toBe(10);
  });

  it("HeatRadiated accumulates in heatMap", () => {
    const p = new WorldProjector();
    p.apply(e("HeatRadiated", "hr-1", { x: 1, y: 1, delta: 10 }, 1));
    expect(p.getSnapshot().heatMap.get("1,1")).toBe(10);
    p.apply(e("HeatRadiated", "hr-2", { x: 1, y: 1, delta: 5 }, 2));
    expect(p.getSnapshot().heatMap.get("1,1")).toBe(15);
  });
});

describe("WorldProjector — purity with relations and heat", () => {
  it("bootstrap with heat source + give + tick → rebuild equals original", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("RelationChanged", "rc-1", { from: "player", to: "guild", kind: "help", delta: 1 }, 1),
      e("TickPassed", "t-1", { delta: 1 }, 1),
      e("HeatRadiated", "hr-1", { x: 1, y: 1, delta: 10 }, 1),
      e("HeatRadiated", "hr-2", { x: 2, y: 1, delta: 5 }, 1),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(normalizeWorld(rebuilt.getSnapshot())).toEqual(normalizeWorld(original.getSnapshot()));
  });
});

describe("WorldProjector — clone with relations and heat", () => {
  it("clone copies relations independently", () => {
    const p = new WorldProjector();
    p.apply(e("RelationChanged", "rc-1", { from: "player", to: "guild", kind: "help", delta: 1 }, 1));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("RelationChanged", "rc-2", { from: "player", to: "guild", kind: "help", delta: 1 }, 2));

    expect(p.getSnapshot().relations.get("player>guild:help")!.value).toBe(1);
    expect(clone.getSnapshot().relations.get("player>guild:help")!.value).toBe(2);
  });

  it("clone copies heatSources independently", () => {
    const p = new WorldProjector();
    p.apply(e("HeatSourcePlaced", "hp-1", { x: 1, y: 1, intensity: 10 }, 0));
    const clone = p.clone() as WorldProjector;
    const sourceClone = clone.getSnapshot().heatSources.get("1,1");
    expect(sourceClone).toBeDefined();
    expect(sourceClone!.intensity).toBe(10);
  });
});

describe("WorldProjector — lastActionTick", () => {
  it("MovementSucceeded updates lastActionTick", () => {
    const p = new WorldProjector();
    p.apply(e("MovementSucceeded", "m-1", { x: 0, y: 1 }, 5));
    expect(p.getSnapshot().lastActionTick).toBe(5);
  });

  it("MovementBlocked updates lastActionTick", () => {
    const p = new WorldProjector();
    p.apply(e("MovementBlocked", "b-1", { reason: "wall" }, 7));
    expect(p.getSnapshot().lastActionTick).toBe(7);
  });

  it("RelationChanged updates lastActionTick", () => {
    const p = new WorldProjector();
    p.apply(e("RelationChanged", "rc-1", { from: "player", to: "guild", kind: "help", delta: 1 }, 9));
    expect(p.getSnapshot().lastActionTick).toBe(9);
  });

  it("ActionRejected does NOT update lastActionTick", () => {
    const p = new WorldProjector();
    p.apply(e("ActionRejected", "ar-1", { reason: "insufficient_time" }, 5));
    expect(p.getSnapshot().lastActionTick).toBe(0);
  });

  it("ActionValidated does NOT update lastActionTick", () => {
    const p = new WorldProjector();
    p.apply(e("ActionValidated", "av-1", { actionType: "MoveRequested", originalEventId: "m-1" }, 5));
    expect(p.getSnapshot().lastActionTick).toBe(0);
  });

  it("clone copies lastActionTick independently", () => {
    const p = new WorldProjector();
    p.apply(e("MovementSucceeded", "m-1", { x: 0, y: 1 }, 5));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("MovementSucceeded", "m-2", { x: 1, y: 1 }, 10));

    expect(p.getSnapshot().lastActionTick).toBe(5);
    expect(clone.getSnapshot().lastActionTick).toBe(10);
  });
});

describe("WorldProjector — strategy", () => {
  it("StrategySet sets the player strategy", () => {
    const p = new WorldProjector();
    p.apply(e("StrategySet", "ss-1", { entries: [{ condition: "always", action: "move_south" }] }, 0));

    expect(p.getSnapshot().strategy).toHaveLength(1);
    expect(p.getSnapshot().strategy[0]!.condition).toBe("always");
    expect(p.getSnapshot().strategy[0]!.action).toBe("move_south");
  });

  it("second StrategySet replaces (not append)", () => {
    const p = new WorldProjector();
    p.apply(e("StrategySet", "ss-1", { entries: [{ condition: "always", action: "move_south" }] }, 0));
    p.apply(e("StrategySet", "ss-2", { entries: [{ condition: "never", action: "idle" }] }, 1));

    expect(p.getSnapshot().strategy).toHaveLength(1);
    expect(p.getSnapshot().strategy[0]!.condition).toBe("never");
  });
});

describe("WorldProjector — purity with strategy", () => {
  it("bootstrap includes strategy → rebuild equals original", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(normalizeWorld(rebuilt.getSnapshot())).toEqual(normalizeWorld(original.getSnapshot()));
  });
});

describe("WorldProjector — clone with strategy", () => {
  it("clone copies strategy independently", () => {
    const p = new WorldProjector();
    p.apply(e("StrategySet", "ss-1", { entries: [{ condition: "always", action: "move_south" }] }, 0));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("StrategySet", "ss-2", { entries: [{ condition: "never", action: "idle" }] }, 1));

    expect(p.getSnapshot().strategy[0]!.condition).toBe("always");
    expect(clone.getSnapshot().strategy[0]!.condition).toBe("never");
  });
});