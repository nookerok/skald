import { type DomainEvent, EventBus } from "@skald/event-bus";
import { START_POSITION, WALLS } from "./map.js";
import { LEGACY_LOCATIONS, LEGACY_OBJECTS } from "./objects/definitions.js";

/**
 * World bootstrap. For MVP-0 the fixed map (player start + walls) must be
 * reproducible from the canonical Event Log alone (Projection Purity /
 * AGENTS invariant #2). We therefore seed the log with one `PlayerSpawned`
 * and a `WallPlaced` domain event per wall at startup, before any player
 * command.
 *
 * These are domain events (they shape the projection) and are appended once
 * at composition time. They are NOT produced by a Rule and never pass
 * through the RuleEngine queue.
 *
 * `commitBootstrap` writes the bootstrap batch directly to the canonical
 * log+projection. Deterministic eventIds: "boot#PlayerSpawned" and
 * "boot#WallPlaced#${i}".
 */
export function bootstrapWorldEvents(): DomainEvent[] {
  const events: DomainEvent[] = [
    {
      eventId: "boot#PlayerSpawned",
      type: "PlayerSpawned",
      schemaVersion: 1,
      payload: { x: START_POSITION.x, y: START_POSITION.y },
      timestamp: 0,
      correlationId: "boot",
      causationId: null,
    },
  ];
  events.push({
    eventId: "boot#ObjectPlaced#old-cart",
    type: "ObjectPlaced",
    schemaVersion: 1,
    payload: {
      entityId: "old-cart",
      x: 1,
      y: 0,
      name: "old cart",
      aliases: ["cart", "old cart"],
      description: "A weathered wooden cart rests on one broken wheel.",
      components: { physical: { intact: false, weight: 200 } },
    },
    timestamp: 0,
    correlationId: "boot",
    causationId: "boot#PlayerSpawned",
  });
  // Preserve the location interaction model for the historical legacy world.
  for (const location of LEGACY_LOCATIONS) {
    events.push({
      eventId: `boot#LocationDefined#${location.id}`,
      type: "LocationDefined",
      schemaVersion: 1,
      payload: {
        id: location.id,
        name: location.name,
        description: location.description,
        objectIds: LEGACY_OBJECTS.filter((object) => object.locationId === location.id).map((object) => object.id),
        connections: location.connections,
      },
      timestamp: 0,
      correlationId: "boot",
      causationId: "boot#PlayerSpawned",
    });
  }
  for (const object of LEGACY_OBJECTS) {
    events.push({
      eventId: `boot#WorldObjectPlaced#${object.id}`,
      type: "WorldObjectPlaced",
      schemaVersion: 1,
      payload: {
        id: object.id,
        name: object.name,
        aliases: object.aliases ?? [],
        description: object.description,
        material: object.material,
        locationId: object.locationId,
        integrity: object.integrity,
        temperature: object.temperature,
        state: object.initialState,
      },
      timestamp: 0,
      correlationId: "boot",
      causationId: "boot#PlayerSpawned",
    });
  }
  WALLS.forEach((w, i) => {
    events.push({
      eventId: `boot#WallPlaced#${i}`,
      type: "WallPlaced",
      schemaVersion: 1,
      payload: { x: w.x, y: w.y },
      timestamp: 0,
      correlationId: "boot",
      causationId: "boot#PlayerSpawned",
    });
  });
  events.push({
    eventId: `boot#HeatSourcePlaced#${WALLS.length}`,
    type: "HeatSourcePlaced",
    schemaVersion: 1,
    payload: { x: 1, y: 1, intensity: 10 },
    timestamp: 0,
    correlationId: "boot",
    causationId: "boot#PlayerSpawned",
  });
  events.push({
    eventId: "boot#StrategySet",
    type: "StrategySet",
    schemaVersion: 1,
    payload: {
      entries: [
        { condition: "danger_nearby", action: "move_south" },
        { condition: "heat_at_player", action: "move_north" },
        { condition: "always", action: "give_help_to_guild" },
      ],
    },
    timestamp: 0,
    correlationId: "boot",
    causationId: "boot#PlayerSpawned",
  });
  return events;
}

/** Apply bootstrap events to the canonical log and projection. */
export function commitBootstrap(bus: EventBus, apply: (e: DomainEvent) => void): void {
  for (const e of bootstrapWorldEvents()) {
    bus.append(e);
    apply(e);
  }
}