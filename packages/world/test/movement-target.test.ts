/**
 * Movement target classification and morphological connection matching
 * (ADR-0039 §2, T4; Russian morphology T9).
 */

import { describe, expect, it } from "vitest";
import { rebuildProjection } from "../src/projection.js";
import {
  buildBootstrapEvents,
  locationConnectionMatch,
  locationConnectionMatches,
  observerSafeConnectionMatches,
  resolveMovementTarget,
  type ReadonlyWorld,
} from "../src/index.js";
import { bootstrapWorldEvents } from "../src/bootstrap.js";
import { sameRussianStem } from "@skald/intent-parser";

function evt(type: string, eventId: string, payload: unknown): any {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 0, correlationId: "test", causationId: null };
}

function contact(entityId: string, name: string, locationId: string, aliases: readonly string[]): any {
  return evt("ObjectPlaced", entityId, {
    entityId,
    x: 1,
    y: 1,
    name,
    aliases: [...aliases],
    description: name,
    components: {
      contact: {
        locationId,
        profile: { visibleAppearance: [], distinguishingFeatures: [], publicRole: name, knownAs: [name], addressForms: [name] },
      },
    },
  });
}

function hallWorld(): ReadonlyWorld {
  return rebuildProjection([
    evt("PlayerSpawned", "p", { x: 0, y: 0 }),
    evt("LocationDefined", "l-hall", {
      id: "hall",
      name: "Зал",
      description: "hall",
      objectIds: ["c-starosta"],
      connections: { "дверь": "yard", "река": "river_spot", "староста": "vault", "речной страж": "riverwatch" },
    }),
    evt("LocationDefined", "l-yard", { id: "yard", name: "Двор", description: "yard", objectIds: [], connections: {} }),
    evt("LocationDefined", "l-river", { id: "river_spot", name: "Река", description: "river", objectIds: [], connections: {} }),
    evt("LocationDefined", "l-vault", { id: "vault", name: "Подвал", description: "vault", objectIds: [], connections: {} }),
    evt("LocationDefined", "l-rw", { id: "riverwatch", name: "Речной Страж", description: "rw", objectIds: [], connections: {} }),
    evt("PlayerLocationChanged", "pc", { locationId: "hall" }),
    contact("c-starosta", "Староста", "hall", ["старосте", "старосты"]),
    contact("c-ferry", "Перевозчик", "riverwatch", ["перевозчику", "перевозчика"]),
  ]).getSnapshot();
}

function gridWorld(): ReadonlyWorld {
  return rebuildProjection(bootstrapWorldEvents()).getSnapshot();
}

describe("resolveMovementTarget — operation-aware priority", () => {
  it("approach prefers a present contact over a colliding connection", () => {
    const world = hallWorld();
    // «староста» is both a present contact and a connection key.
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "старосте" } }, world)).toEqual({
      kind: "present_contact",
      contactRef: "Староста",
      locationId: "hall",
    });
  });

  it("approach to a connection when no contact owns the name", () => {
    const world = hallWorld();
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "двери" } }, world)).toEqual({
      kind: "connected_location",
      locationId: "yard",
      connectionId: "дверь",
    });
  });

  it("approach to a known but absent contact", () => {
    const world = hallWorld();
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "перевозчику" } }, world)).toEqual({
      kind: "unavailable_contact",
      surface: "перевозчику",
      name: "Перевозчик",
    });
  });

  it("approach to an unknown name", () => {
    const world = hallWorld();
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "фонарю" } }, world)).toEqual({
      kind: "unknown",
      surface: "фонарю",
    });
  });

  it("enter prefers the connection", () => {
    const world = hallWorld();
    expect(resolveMovementTarget({ operation: "enter", target: { raw: "дверь" } }, world)).toEqual({
      kind: "connected_location",
      locationId: "yard",
      connectionId: "дверь",
    });
  });

  it("a journey intent is a remote location", () => {
    const world = hallWorld();
    expect(resolveMovementTarget({ type: "JourneyIntent", destination: { raw: "Речной Страж" } }, world)).toEqual({
      kind: "remote_location",
      surface: "Речной Страж",
    });
  });

  it("a compass target is grid movement only without a location", () => {
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "north" } }, gridWorld())).toEqual({
      kind: "grid_direction",
      direction: "north",
    });
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "north" } }, hallWorld()).kind).toBe("unknown");
  });
});

describe("locationConnectionMatch — Russian morphology (T9)", () => {
  it("matches declined forms of a connection name", () => {
    const world = hallWorld();
    expect(locationConnectionMatch(world, "двери")?.destinationId).toBe("yard");
    expect(locationConnectionMatch(world, "дверью")?.destinationId).toBe("yard");
    expect(locationConnectionMatch(world, "к реке")?.destinationId).toBe("river_spot");
    expect(locationConnectionMatch(world, "Речного Стража")?.destinationId).toBe("riverwatch");
    expect(locationConnectionMatch(world, "Речному Стражу")?.destinationId).toBe("riverwatch");
  });

  it("does not match coincidental stems", () => {
    const world = hallWorld();
    expect(locationConnectionMatch(world, "рука")).toBeNull();
    expect(locationConnectionMatch(world, "мост")).toBeNull();
    expect(locationConnectionMatch(world, "страна")).toBeNull();
  });

  it("the shared stemmer rejects coincidences", () => {
    expect(sameRussianStem("река", "рука")).toBe(false);
    expect(sameRussianStem("мост", "место")).toBe(false);
    expect(sameRussianStem("страж", "страна")).toBe(false);
    expect(sameRussianStem("дверь", "двери")).toBe(true);
  });
});

function gatesWorld(): ReadonlyWorld {
  return rebuildProjection([
    evt("PlayerSpawned", "p", { x: 0, y: 0 }),
    evt("LocationDefined", "l-hall", {
      id: "hall",
      name: "Зал",
      description: "hall",
      objectIds: [],
      connections: {
        "северные ворота": "north_gate",
        "старые ворота": "old_gate",
        "северный перевозчик": "north_ferry",
        "вход": "tower_entrance",
      },
    }),
    evt("LocationDefined", "l-north", { id: "north_gate", name: "Северные ворота", description: "n", objectIds: [], connections: {} }),
    evt("LocationDefined", "l-old", { id: "old_gate", name: "Старые ворота", description: "o", objectIds: [], connections: {} }),
    evt("LocationDefined", "l-ferry", { id: "north_ferry", name: "Северный перевозчик", description: "f", objectIds: [], connections: {} }),
    evt("LocationDefined", "l-tower", { id: "tower_entrance", name: "Вход в башню", description: "t", objectIds: [], connections: {} }),
    evt("PlayerLocationChanged", "pc", { locationId: "hall" }),
  ]).getSnapshot();
}

describe("connection ranking, ties and observer-safe surface", () => {
  it("returns ambiguity for equal connection candidates", () => {
    const world = gatesWorld();
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "воротам" } }, world)).toEqual({
      kind: "ambiguous",
      candidates: ["северные ворота", "старые ворота"],
    });
  });

  it("prefers the all-word match over a single shared word", () => {
    const world = gatesWorld();
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "северным воротам" } }, world)).toEqual({
      kind: "connected_location",
      locationId: "north_gate",
      connectionId: "северные ворота",
    });
  });

  it("does not resolve an internal connection id used as a surface", () => {
    const world = gatesWorld();
    expect(locationConnectionMatches(world, "tower_entrance")).toEqual([]);
    expect(resolveMovementTarget({ operation: "enter", target: { raw: "tower_entrance" } }, world)).toEqual({
      kind: "unknown",
      surface: "tower_entrance",
    });
  });

  it("prefers an exact connection label over a longer all-word match", () => {
    const world = rebuildProjection([
      evt("PlayerSpawned", "p", { x: 0, y: 0 }),
      evt("LocationDefined", "l-hall", {
        id: "hall",
        name: "Зал",
        description: "hall",
        objectIds: [],
        connections: { "ворота": "gate", "северные ворота": "north_gate" },
      }),
      evt("LocationDefined", "l-gate", { id: "gate", name: "Ворота", description: "g", objectIds: [], connections: {} }),
      evt("LocationDefined", "l-north", { id: "north_gate", name: "Северные ворота", description: "n", objectIds: [], connections: {} }),
      evt("PlayerLocationChanged", "pc", { locationId: "hall" }),
    ]).getSnapshot();
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "ворота" } }, world)).toEqual({
      kind: "connected_location",
      locationId: "gate",
      connectionId: "ворота",
    });
  });
});

describe("observer-safe connections (T10)", () => {
  function spatialWorld(): ReadonlyWorld {
    return {
      currentLocationId: "hall",
      locations: new Map([
        ["hall", { id: "hall", name: "Зал", connections: { "дверь": "yard", "скрытый": "secret" }, objectIds: [] }],
        ["yard", { id: "yard", name: "Двор" }],
        ["secret", { id: "secret", name: "Секрет" }],
      ]),
      spatial: {
        travelRelations: new Map([
          ["r-yard", { id: "r-yard", fromId: "hall", toId: "yard", kind: "road" }],
          ["r-secret", { id: "r-secret", fromId: "hall", toId: "secret", kind: "road" }],
          ["r-plaza", { id: "r-plaza", fromId: "hall", toId: "plaza", kind: "road" }],
        ]),
        locations: new Map([["yard", { name: "Двор" }], ["secret", { name: "Секрет" }], ["plaza", { name: "Площадь" }]]),
      },
      spatialKnowledge: { relations: new Map([["r-yard", { knowledge: "observed" }], ["r-plaza", { knowledge: "observed" }]]) },
      entities: new Map(),
      objects: new Map(),
    } as unknown as ReadonlyWorld;
  }

  it("hides a connection the player has not observed from preflight", () => {
    const world = spatialWorld();
    // The authoritative rule still sees the full graph.
    expect(locationConnectionMatches(world, "скрытый")).toEqual([{ connectionName: "скрытый", destinationId: "secret" }]);
    // Preflight sees only observed routes.
    expect(observerSafeConnectionMatches(world, "скрытый")).toEqual([]);
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "скрытый" } }, world)).toEqual({
      kind: "unknown",
      surface: "скрытый",
    });
  });

  it("still resolves an observed connection from preflight", () => {
    const world = spatialWorld();
    expect(observerSafeConnectionMatches(world, "двери")).toEqual([{ connectionName: "дверь", destinationId: "yard" }]);
    expect(resolveMovementTarget({ operation: "approach", target: { raw: "двери" } }, world)).toEqual({
      kind: "connected_location",
      locationId: "yard",
      connectionId: "дверь",
    });
  });

  it("does not turn an observed-but-unconnected endpoint into a connection", () => {
    const world = spatialWorld();
    // "plaza" is an observed endpoint but hall has no connection to it.
    const target = resolveMovementTarget({ operation: "approach", target: { raw: "площадь" } }, world);
    expect(target.kind).not.toBe("connected_location");
    expect(target).toEqual({ kind: "unknown", surface: "площадь" });
  });

  it("resolves a legacy authored connection without prior observation", () => {
    // A world without a spatial model keeps its authored graph, so a visible
    // exit works on the first turn (no hidden-connection filter applies).
    const world = rebuildProjection(buildBootstrapEvents("old_tower")).getSnapshot();
    expect(resolveMovementTarget({ operation: "enter", target: { raw: "enter" } }, world)).toEqual({
      kind: "connected_location",
      locationId: "tower_entrance",
      connectionId: "enter",
    });
  });
});

describe("Russian stemmer regression table (T9)", () => {
  it("matches adjective inflections", () => {
    for (const [left, right] of [
      ["речной", "речным"], ["речной", "речному"],
      ["старый", "старым"], ["старый", "старому"],
      ["северный", "северным"], ["северный", "северному"],
    ]) {
      expect(sameRussianStem(left!, right!), `${left} ~ ${right}`).toBe(true);
    }
  });

  it("rejects coincidental stems", () => {
    for (const [left, right] of [
      ["речной", "речка"], ["старый", "страж"], ["северный", "перевозчик"],
    ]) {
      expect(sameRussianStem(left!, right!), `${left} !~ ${right}`).toBe(false);
    }
  });
});
