import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { physicsMovement } from "@skald/world";
import type { ReadonlyWorld, Consequence } from "@skald/world";

function worldWith(
  player: { x: number; y: number },
  walls: string[] = [],
  eventNumber = 0,
  time = 1,
): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ ...player }),
    walls: new Set(walls),
    observations: new Map(),
    consequences: new Map<string, Consequence>(),
    eventNumber,
    time,
  }) as unknown as ReadonlyWorld;
}

function moveRequested(
  eventId: string,
  direction: string,
  timestamp = 1,
): DomainEvent {
  return {
    eventId,
    type: "MoveRequested",
    schemaVersion: 1,
    payload: { direction },
    timestamp,
    correlationId: "cmd-1",
    causationId: null,
  };
}

describe("physics.movement", () => {
  it("emits MovementSucceeded with correct coordinates when no wall and within bounds", () => {
    const event = moveRequested("start-1", "north");
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
    const event = moveRequested("start-2", "east");
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
    const event = moveRequested("start-3", "north");
    const world = worldWith({ x: 0, y: 4 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    const [produced] = out;
    expect(produced!.type).toBe("MovementBlocked");
    expect(produced!.payload).toEqual({ reason: "boundary" });
  });

  it("emits MovementBlocked with reason 'boundary' when moving east at x=4", () => {
    const event = moveRequested("start-4", "east");
    const world = worldWith({ x: 4, y: 0 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MovementBlocked");
    expect(out[0]!.payload).toEqual({ reason: "boundary" });
  });

  it("emits MovementBlocked with reason 'boundary' when moving south at y=0", () => {
    const event = moveRequested("start-5", "south");
    const world = worldWith({ x: 0, y: 0 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MovementBlocked");
    expect(out[0]!.payload).toEqual({ reason: "boundary" });
  });

  it("emits MovementBlocked with reason 'boundary' when moving west at x=0", () => {
    const event = moveRequested("start-6", "west");
    const world = worldWith({ x: 0, y: 0 });

    const out = physicsMovement.handle(event, world);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MovementBlocked");
    expect(out[0]!.payload).toEqual({ reason: "boundary" });
  });

  it("emits exactly one event — never both Succeeded and Blocked", () => {
    const event = moveRequested("start-7", "north");
    const withWall = worldWith({ x: 2, y: -1 }, ["2,0"]);
    const withoutWall = worldWith({ x: 2, y: -1 });
    const atBoundary = worldWith({ x: 0, y: 4 });

    expect(physicsMovement.handle(event, withWall)).toHaveLength(1);
    expect(physicsMovement.handle(event, withoutWall)).toHaveLength(1);
    expect(physicsMovement.handle(event, atBoundary)).toHaveLength(1);
  });

  it("does not mutate the world (player position unchanged)", () => {
    const event = moveRequested("start-8", "east");
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
      const event = moveRequested(`e-${dir}`, dir);
      const world = worldWith(from);
      const [produced] = physicsMovement.handle(event, world);
      expect(produced!.type).toBe("MovementSucceeded");
      expect(produced!.payload).toEqual(expected);
    }
  });
});
