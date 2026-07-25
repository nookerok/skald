import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { physicsMovement } from "@skald/world";
import type { ReadonlyWorld } from "@skald/world";

function worldWith(
  player: { x: number; y: number },
  walls: string[] = [],
): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ ...player }),
    walls: new Set(walls),
    observations: new Map<string, number>(),
    consequences: new Map(),
    firedConsequences: new Map(),
    activeSituations: new Map(),
    burnedTrees: 0,
    relations: new Map(),
    heatSources: new Map(),
    heatMap: new Map(),
    lastActionTick: 0,
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function actionValidated(
  eventId: string,
  direction: string,
  timestamp = 1,
): DomainEvent {
  return {
    eventId,
    type: "ActionValidated",
    schemaVersion: 1,
    payload: {
      actionType: "MoveRequested",
      originalEventId: `${eventId}-orig`,
      originalPayload: { direction },
    },
    timestamp,
    correlationId: "cmd-1",
    causationId: `${eventId}-orig`,
  };
}

describe("physics.movement (via ActionValidated gate)", () => {
  it("emits MovementSucceeded with correct coordinates when no wall and within bounds", () => {
    const event = actionValidated("start-1", "north");
    const world = worldWith({ x: 0, y: 0 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    const [produced] = out;
    expect(produced!.type).toBe("MovementSucceeded");
    expect(produced!.payload).toEqual({ x: 0, y: 1 });
    expect(produced!.causationId).toBe("start-1");
    expect(produced!.correlationId).toBe("cmd-1");
    expect(produced!.timestamp).toBe(1);
    expect(produced!.eventId).toBe("start-1>MovementSucceeded#0");
  });

  it("emits MovementBlocked with reason 'wall' when destination is a wall", () => {
    const event = actionValidated("start-2", "east");
    const world = worldWith({ x: 0, y: 0 }, ["1,0"]);

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    const [produced] = out;
    expect(produced!.type).toBe("MovementBlocked");
    expect(produced!.payload).toEqual({ reason: "wall" });
    expect(produced!.causationId).toBe("start-2");
    expect(produced!.eventId).toBe("start-2>MovementBlocked#0");
  });

  it("emits MovementBlocked with reason 'boundary' when moving north at y=4", () => {
    const event = actionValidated("start-3", "north");
    const world = worldWith({ x: 0, y: 4 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    const [produced] = out;
    expect(produced!.type).toBe("MovementBlocked");
    expect(produced!.payload).toEqual({ reason: "boundary" });
  });

  it("emits MovementBlocked with reason 'boundary' when moving east at x=4", () => {
    const event = actionValidated("start-4", "east");
    const world = worldWith({ x: 4, y: 0 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MovementBlocked");
    expect(out[0]!.payload).toEqual({ reason: "boundary" });
  });

  it("emits MovementBlocked with reason 'boundary' when moving south at y=0", () => {
    const event = actionValidated("start-5", "south");
    const world = worldWith({ x: 0, y: 0 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MovementBlocked");
    expect(out[0]!.payload).toEqual({ reason: "boundary" });
  });

  it("emits MovementBlocked with reason 'boundary' when moving west at x=0", () => {
    const event = actionValidated("start-6", "west");
    const world = worldWith({ x: 0, y: 0 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MovementBlocked");
    expect(out[0]!.payload).toEqual({ reason: "boundary" });
  });

  it("emits exactly one event — never both Succeeded and Blocked", () => {
    const event = actionValidated("start-7", "north");
    const withWall = worldWith({ x: 2, y: -1 }, ["2,0"]);
    const withoutWall = worldWith({ x: 2, y: -1 });
    const atBoundary = worldWith({ x: 0, y: 4 });

    expect(physicsMovement.handle(event, withWall)).toHaveLength(1);
    expect(physicsMovement.handle(event, withoutWall)).toHaveLength(1);
    expect(physicsMovement.handle(event, atBoundary)).toHaveLength(1);
  });

  it("does not mutate the world (player position unchanged)", () => {
    const event = actionValidated("start-8", "east");
    const world = worldWith({ x: 0, y: 0 }, ["1,0"]);

    physicsMovement.handle(event, world);

    expect(world.player).toEqual({ x: 0, y: 0 });
  });

  it("handles all four directions correctly when unobstructed", () => {
    const cases: Array<[string, { x: number; y: number }, { x: number; y: number }]> = [
      ["north", { x: 1, y: 1 }, { x: 1, y: 2 }],
      ["south", { x: 1, y: 1 }, { x: 1, y: 0 }],
      ["east", { x: 1, y: 1 }, { x: 2, y: 1 }],
      ["west", { x: 1, y: 1 }, { x: 0, y: 1 }],
    ];
    for (const [dir, from, expected] of cases) {
      const event = actionValidated(`e-${dir}`, dir);
      const world = worldWith(from);
      const [produced] = physicsMovement.handle(event, world);
      expect(produced!.type).toBe("MovementSucceeded");
      expect(produced!.payload).toEqual(expected);
    }
  });
});
