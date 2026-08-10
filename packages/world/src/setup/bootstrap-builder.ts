import { commandEventId } from "../ids.js";
import type { DomainEvent } from "@skald/event-bus";
import { getWorldTemplate } from "./world-templates.js";
import { OLD_TOWER_OBJECTS, OLD_TOWER_LOCATIONS } from "../objects/definitions.js";
import { LEGACY_LOCATIONS, LEGACY_OBJECTS } from "../objects/definitions.js";
import { buildRegionBootstrapEvents } from "../region/compiler.js";

export function buildBootstrapEvents(templateId: string): readonly DomainEvent[] {
  const template = getWorldTemplate(templateId);
  if (!template && templateId !== "legacy") {
    throw new Error(`Unknown world template: ${templateId}`);
  }
  const events: DomainEvent[] = [];

  if (templateId === "living_region") {
    return buildRegionBootstrapEvents(template?.regionId ?? "riverwatch-basin");
  }

  events.push({
    eventId: commandEventId("bootstrap", "PlayerSpawned"),
    type: "PlayerSpawned",
    schemaVersion: 1,
    payload: { x: 0, y: 0 },
    timestamp: 0,
    correlationId: "bootstrap",
    causationId: null,
  });

  events.push({
    eventId: commandEventId("bootstrap-cart", "ObjectPlaced"),
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
    correlationId: "bootstrap",
    causationId: commandEventId("bootstrap", "PlayerSpawned"),
  });

  if (templateId === "old_tower") {
    events.push({
      eventId: commandEventId("bootstrap-wall-1", "WallPlaced"),
      type: "WallPlaced",
      schemaVersion: 1,
      payload: { x: 2, y: 0 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
    events.push({
      eventId: commandEventId("bootstrap-wall-2", "WallPlaced"),
      type: "WallPlaced",
      schemaVersion: 1,
      payload: { x: 2, y: 1 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
    events.push({
      eventId: commandEventId("bootstrap-wall-3", "WallPlaced"),
      type: "WallPlaced",
      schemaVersion: 1,
      payload: { x: 1, y: 2 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
    events.push({
      eventId: commandEventId("bootstrap-heat", "HeatSourcePlaced"),
      type: "HeatSourcePlaced",
      schemaVersion: 1,
      payload: { x: 0, y: 3, intensity: 5 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });

    // Iteration 15 — Locations (with objectIds pre-populated)
    const objectsByLocation = new Map<string, string[]>();
    for (const obj of OLD_TOWER_OBJECTS) {
      const list = objectsByLocation.get(obj.locationId) ?? [];
      list.push(obj.id);
      objectsByLocation.set(obj.locationId, list);
    }

    let locIdx = 0;
    for (const loc of OLD_TOWER_LOCATIONS) {
      events.push({
        eventId: commandEventId(`bootstrap-loc-${locIdx}`, "LocationDefined"),
        type: "LocationDefined",
        schemaVersion: 1,
        payload: {
          id: loc.id,
          name: loc.name,
          description: loc.description,
          objectIds: objectsByLocation.get(loc.id) ?? [],
          connections: loc.connections,
        },
        timestamp: 0,
        correlationId: "bootstrap",
        causationId: null,
      });
      locIdx++;
    }

    // Iteration 15 — Player starts at tower_approach
    events.push({
      eventId: commandEventId("bootstrap-loc-player", "PlayerLocationChanged"),
      type: "PlayerLocationChanged",
      schemaVersion: 1,
      payload: { locationId: "tower_approach" },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });

    // Iteration 15 — Objects
    let objIdx = 0;
    for (const obj of OLD_TOWER_OBJECTS) {
      events.push({
        eventId: commandEventId(`bootstrap-obj-${objIdx}`, "WorldObjectPlaced"),
        type: "WorldObjectPlaced",
        schemaVersion: 1,
        payload: {
          id: obj.id,
          name: obj.name,
          aliases: obj.aliases ?? [],
          description: obj.description,
          material: obj.material,
          locationId: obj.locationId,
          integrity: obj.integrity,
          temperature: obj.temperature,
          state: obj.initialState,
        },
        timestamp: 0,
        correlationId: "bootstrap",
        causationId: null,
      });
      objIdx++;
    }
  } else if (templateId === "crossroads") {
    events.push({
      eventId: commandEventId("bootstrap-wall-1", "WallPlaced"),
      type: "WallPlaced",
      schemaVersion: 1,
      payload: { x: 2, y: 2 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
    events.push({
      eventId: commandEventId("bootstrap-wall-2", "WallPlaced"),
      type: "WallPlaced",
      schemaVersion: 1,
      payload: { x: 3, y: 3 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
    events.push({
      eventId: commandEventId("bootstrap-heat", "HeatSourcePlaced"),
      type: "HeatSourcePlaced",
      schemaVersion: 1,
      payload: { x: 4, y: 4, intensity: 3 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
  } else {
    // Legacy grid world with a single location for compatibility
    const objectsByLocation = new Map<string, string[]>();
    for (const obj of LEGACY_OBJECTS) {
      const list = objectsByLocation.get(obj.locationId) ?? [];
      list.push(obj.id);
      objectsByLocation.set(obj.locationId, list);
    }

    let locIdx = 0;
    for (const loc of LEGACY_LOCATIONS) {
      events.push({
        eventId: commandEventId(`bootstrap-loc-${locIdx}`, "LocationDefined"),
        type: "LocationDefined",
        schemaVersion: 1,
        payload: {
          id: loc.id,
          name: loc.name,
          description: loc.description,
          objectIds: objectsByLocation.get(loc.id) ?? [],
          connections: loc.connections,
        },
        timestamp: 0,
        correlationId: "bootstrap",
        causationId: null,
      });
      locIdx++;
    }

    events.push({
      eventId: commandEventId("bootstrap-loc-player", "PlayerLocationChanged"),
      type: "PlayerLocationChanged",
      schemaVersion: 1,
      payload: { locationId: "legacy_overworld" },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });

    let objIdx = 0;
    for (const obj of LEGACY_OBJECTS) {
      events.push({
        eventId: commandEventId(`bootstrap-obj-${objIdx}`, "WorldObjectPlaced"),
        type: "WorldObjectPlaced",
        schemaVersion: 1,
        payload: {
          id: obj.id,
          name: obj.name,
          aliases: obj.aliases ?? [],
          description: obj.description,
          material: obj.material,
          locationId: obj.locationId,
          integrity: obj.integrity,
          temperature: obj.temperature,
          state: obj.initialState,
        },
        timestamp: 0,
        correlationId: "bootstrap",
        causationId: null,
      });
      objIdx++;
    }

    events.push({
      eventId: commandEventId("bootstrap-wall-1", "WallPlaced"),
      type: "WallPlaced",
      schemaVersion: 1,
      payload: { x: 2, y: 0 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
    events.push({
      eventId: commandEventId("bootstrap-heat", "HeatSourcePlaced"),
      type: "HeatSourcePlaced",
      schemaVersion: 1,
      payload: { x: 3, y: 3, intensity: 5 },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    });
  }

  events.push({
    eventId: commandEventId("bootstrap-strategy", "StrategySet"),
    type: "StrategySet",
    schemaVersion: 1,
    payload: { entries: [{ condition: "always", action: "idle" }] },
    timestamp: 0,
    correlationId: "bootstrap",
    causationId: null,
  });

  return events;
}
