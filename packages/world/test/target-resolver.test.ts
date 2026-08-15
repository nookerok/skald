import { describe, expect, it } from "vitest";
import { rebuildProjection } from "../src/projection.js";
import { resolveInteractionTarget, targetFromObject } from "../src/index.js";
import { buildBootstrapEvents } from "../src/setup/index.js";
import { bootstrapWorldEvents } from "../src/bootstrap.js";
import type { ReadonlyWorld } from "../src/projection.js";

function gridWorld(): ReadonlyWorld {
  const projector = rebuildProjection(bootstrapWorldEvents());
  return projector.getSnapshot();
}

function towerWorld(): ReadonlyWorld {
  const projector = rebuildProjection(buildBootstrapEvents("old_tower"));
  return projector.getSnapshot();
}

describe("resolveInteractionTarget — grid scope (entities)", () => {
  it("resolves a nearby entity by exact name", () => {
    const world = gridWorld();
    const r = resolveInteractionTarget(world, "inspect", "cart");
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") throw new Error("unreachable");
    expect(r.target.id).toBe("old-cart");
    expect(r.target.name).toBe("old cart");
  });

  it("resolves by alias", () => {
    const world = gridWorld();
    const r = resolveInteractionTarget(world, "inspect", "old cart");
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") throw new Error("unreachable");
    expect(r.target.id).toBe("old-cart");
  });

  it("exact name beats a partial match", () => {
    const world = gridWorld();
    const r = resolveInteractionTarget(world, "inspect", "cart");
    expect(r.kind).toBe("resolved");
  });

  it("reports missing for an out-of-scope or unknown target", () => {
    const world = gridWorld();
    expect(resolveInteractionTarget(world, "inspect", "lantern").kind).toBe("missing");
    expect(resolveInteractionTarget(world, "inspect", "петли").kind).toBe("missing");
  });

  it("missing when the entity is too far away", () => {
    const events = [
      ...bootstrapWorldEvents(),
      { eventId: "mv-1", type: "MovementSucceeded", schemaVersion: 1, payload: { x: 5, y: 5 }, timestamp: 1, correlationId: "c", causationId: null },
    ];
    const world = rebuildProjection(events).getSnapshot();
    expect(resolveInteractionTarget(world, "inspect", "cart").kind).toBe("missing");
  });

  it("observe/listen without a target resolve to missing in the grid frame", () => {
    const world = gridWorld();
    expect(resolveInteractionTarget(world, "observe", "")).toEqual({ kind: "environment", locationId: "legacy_overworld" });
    expect(resolveInteractionTarget(world, "listen", "")).toEqual({ kind: "environment", locationId: "legacy_overworld" });
  });

  it("keeps pre-location legacy saves observable through the compatibility fallback", () => {
    const world = rebuildProjection([
      { eventId: "old-spawn", type: "PlayerSpawned", schemaVersion: 1, payload: { x: 0, y: 0 }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "old-cart", type: "ObjectPlaced", schemaVersion: 1, payload: { entityId: "old-cart", x: 1, y: 0, name: "old cart", aliases: ["cart"], description: "A cart.", components: {} }, timestamp: 0, correlationId: "boot", causationId: "old-spawn" },
    ]).getSnapshot();
    expect(resolveInteractionTarget(world, "listen", "")).toEqual({ kind: "environment", locationId: "legacy_overworld" });
  });

  it("take without a target is missing, never environment", () => {
    const world = gridWorld();
    expect(resolveInteractionTarget(world, "take", "").kind).toBe("missing");
  });
});

describe("resolveInteractionTarget — location scope (WorldObjects)", () => {
  it("resolves a WorldObject in the current location", () => {
    const world = towerWorld();
    const r = resolveInteractionTarget(world, "inspect", "пепел");
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") throw new Error("unreachable");
    expect(r.target.id).toBe("ash_pile");
    expect(r.target.worldObject).not.toBeNull();
    expect(r.target.components.material?.kind).toBe("ash");
  });

  it("resolves object aliases (inflected forms like пепел for Кучка пепла)", () => {
    const world = towerWorld();
    expect(resolveInteractionTarget(world, "inspect", "жаровня").kind).toBe("resolved");
    const byName = resolveInteractionTarget(world, "inspect", "кучка пепла");
    expect(byName.kind).toBe("resolved");
    if (byName.kind !== "resolved") throw new Error("unreachable");
    expect(byName.target.id).toBe("ash_pile");
  });

  it("does not resolve an object in another location", () => {
    const world = towerWorld();
    // Player is at tower_approach; the door lives at tower_entrance.
    expect(resolveInteractionTarget(world, "inspect", "дверь").kind).toBe("missing");
  });

  it("resolves after the player moves to the object's location", () => {
    const events = [
      ...buildBootstrapEvents("old_tower"),
      { eventId: "plc-1", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId: "tower_entrance" }, timestamp: 1, correlationId: "c", causationId: null },
    ];
    const world = rebuildProjection(events).getSnapshot();
    const r = resolveInteractionTarget(world, "inspect", "дверь");
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") throw new Error("unreachable");
    expect(r.target.id).toBe("tower_door");
    expect(resolveInteractionTarget(world, "inspect", "петли").kind).toBe("resolved");
    expect(resolveInteractionTarget(world, "inspect", "окно").kind).toBe("resolved");
  });

  it("exact name resolves even when an alias also exists", () => {
    const events = [
      ...buildBootstrapEvents("old_tower"),
      { eventId: "plc-1", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId: "tower_entrance" }, timestamp: 1, correlationId: "c", causationId: null },
    ];
    const world = rebuildProjection(events).getSnapshot();
    const exact = resolveInteractionTarget(world, "inspect", "Башенная дверь");
    expect(exact.kind).toBe("resolved");
    if (exact.kind !== "resolved") throw new Error("unreachable");
    expect(exact.target.id).toBe("tower_door");
  });

  it("observe/listen with no target resolve to the current environment", () => {
    const world = towerWorld();
    const r = resolveInteractionTarget(world, "observe", "");
    expect(r).toEqual({ kind: "environment", locationId: "tower_approach" });
    const l = resolveInteractionTarget(world, "listen", "");
    expect(l.kind).toBe("environment");
  });
});

describe("resolveInteractionTarget — ambiguity", () => {
  it("two equal matches are ambiguous with player-facing names", () => {
    const events = [
      ...bootstrapWorldEvents(),
      {
        eventId: "obj-2",
        type: "ObjectPlaced",
        schemaVersion: 1,
        payload: {
          entityId: "new-cart",
          x: 0,
          y: 0,
          name: "new cart",
          aliases: ["cart"],
          description: "A second cart.",
          components: {},
        },
        timestamp: 1,
        correlationId: "c",
        causationId: null,
      },
    ];
    const world = rebuildProjection(events).getSnapshot();
    const r = resolveInteractionTarget(world, "inspect", "cart");
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") throw new Error("unreachable");
    expect(r.candidates.map((c) => c.name)).toEqual(["new cart", "old cart"]);
    for (const candidate of r.candidates) {
      expect(candidate).not.toHaveProperty("id");
    }
  });

  it("a single partial match resolves", () => {
    const world = gridWorld();
    const r = resolveInteractionTarget(world, "inspect", "cart");
    expect(r.kind).toBe("resolved");
  });
});

describe("resolveInteractionTarget — carried items for place/use (P2)", () => {
  function campWithCarried(extra: readonly import("@skald/event-bus").DomainEvent[] = []): ReadonlyWorld {
    const events: import("@skald/event-bus").DomainEvent[] = [
      { eventId: "spawn", type: "PlayerSpawned", schemaVersion: 1, payload: { x: 0, y: 0 }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "loc", type: "LocationDefined", schemaVersion: 1, payload: { id: "camp", name: "Camp", description: "A camp.", objectIds: ["pouch"], connections: {} }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "plc", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId: "camp" }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "pouch", type: "WorldObjectPlaced", schemaVersion: 1, payload: { id: "pouch", name: "pouch", aliases: ["pouch"], description: "A pouch.", locationId: "camp", integrity: 100, temperature: 20, state: { open: true, portable: true, containerCapacityMass: 5 }, mass: 1, portable: true, containerCapacity: 5 }, timestamp: 0, correlationId: "boot", causationId: null },
      ...extra,
    ];
    return rebuildProjection(events).getSnapshot();
  }

  it("place resolves the carried item to place", () => {
    const world = campWithCarried([
      { eventId: "stone", type: "WorldObjectPlaced", schemaVersion: 1, payload: { id: "stone", name: "stone", aliases: ["stone"], description: "A stone.", locationId: "camp", integrity: 100, temperature: 20, state: { portable: true }, mass: 2, portable: true }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "carry", type: "ItemMoved", schemaVersion: 1, payload: { itemId: "stone", from: { kind: "location", locationId: "camp" }, to: { kind: "carried", holderId: "player" }, subjectId: "player" }, timestamp: 0, correlationId: "boot", causationId: null },
    ]);
    const r = resolveInteractionTarget(world, "place", "stone");
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") throw new Error("unreachable");
    expect(r.target.id).toBe("stone");
  });

  it("use resolves the carried instrument", () => {
    const world = campWithCarried([
      { eventId: "torch", type: "WorldObjectPlaced", schemaVersion: 1, payload: { id: "torch", name: "torch", aliases: ["torch"], description: "A torch.", locationId: "camp", integrity: 100, temperature: 20, state: { portable: true, affordances: ["ignite"] }, mass: 1, portable: true, affordances: ["ignite"] }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "carry", type: "ItemMoved", schemaVersion: 1, payload: { itemId: "torch", from: { kind: "location", locationId: "camp" }, to: { kind: "carried", holderId: "player" }, subjectId: "player" }, timestamp: 0, correlationId: "boot", causationId: null },
    ]);
    const r = resolveInteractionTarget(world, "use", "torch");
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") throw new Error("unreachable");
    expect(r.target.id).toBe("torch");
  });

  it("place is ambiguous when a carried and a location item share the name", () => {
    const world = campWithCarried([
      { eventId: "stone-a", type: "WorldObjectPlaced", schemaVersion: 1, payload: { id: "stone-a", name: "stone", aliases: ["stone"], description: "A stone on the ground.", locationId: "camp", integrity: 100, temperature: 20, state: { portable: true }, mass: 2, portable: true }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "stone-b", type: "WorldObjectPlaced", schemaVersion: 1, payload: { id: "stone-b", name: "stone", aliases: ["stone"], description: "A carried stone.", locationId: "camp", integrity: 100, temperature: 20, state: { portable: true }, mass: 2, portable: true }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "carry", type: "ItemMoved", schemaVersion: 1, payload: { itemId: "stone-b", from: { kind: "location", locationId: "camp" }, to: { kind: "carried", holderId: "player" }, subjectId: "player" }, timestamp: 0, correlationId: "boot", causationId: null },
    ]);
    const r = resolveInteractionTarget(world, "place", "stone");
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") throw new Error("unreachable");
    expect(r.candidates).toEqual([
      { name: "stone", description: "A stone on the ground." },
      { name: "stone", description: "A carried stone." },
    ]);
  });

  it("an item inside a closed container is not a use candidate", () => {
    const world = campWithCarried([
      { eventId: "tinder", type: "WorldObjectPlaced", schemaVersion: 1, payload: { id: "tinder", name: "tinder", aliases: ["tinder"], description: "Tinder.", locationId: "camp", integrity: 100, temperature: 20, state: { portable: true, flammable: true }, mass: 1, portable: true }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "store", type: "ItemMoved", schemaVersion: 1, payload: { itemId: "tinder", from: { kind: "carried", holderId: "player" }, to: { kind: "container", containerId: "pouch" }, subjectId: "player", containerId: "pouch" }, timestamp: 0, correlationId: "boot", causationId: null },
      { eventId: "close", type: "ContainerClosed", schemaVersion: 1, payload: { containerId: "pouch", subjectId: "player" }, timestamp: 0, correlationId: "boot", causationId: null },
    ]);
    expect(resolveInteractionTarget(world, "use", "tinder").kind).toBe("missing");
  });
});

describe("targetFromObject — adapter over the physical model", () => {
  it("derives generic components from WorldObjectPlaced data", () => {
    const world = towerWorld();
    const object = world.objects.get("door_hinges");
    expect(object).toBeDefined();
    const target = targetFromObject(object!);
    expect(target.id).toBe("door_hinges");
    expect(target.components.material?.kind).toBe("iron");
    expect(target.components.thermal?.temperature).toBe(20);
    expect(target.components.physical?.intact).toBe(true);
    expect(target.worldObject).toBe(object);
  });
});
