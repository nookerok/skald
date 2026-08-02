/**
 * Object projection for Iteration 15.
 *
 * Handles WorldObjectPlaced, ObjectTemperatureChanged, ObjectIntegrityChanged,
 * PassageOpened events to maintain object state in the projection.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { WorldObject, Location } from "./types.js";

export interface ObjectProjectionState {
  readonly objects: ReadonlyMap<string, WorldObject>;
  readonly locations: ReadonlyMap<string, Location>;
  readonly currentLocationId: string;
}

export function applyObjectEvent(
  state: {
    objects: Map<string, WorldObject>;
    locations: Map<string, Location>;
    currentLocationId: string;
  },
  event: DomainEvent,
): void {
  switch (event.type) {
    case "WorldObjectPlaced": {
      const p = event.payload as {
        id: string;
        name: string;
        aliases?: string[];
        description: string;
        material: string;
        locationId: string;
        integrity: number;
        temperature: number;
        state: Record<string, unknown>;
      };
      state.objects.set(p.id, {
        id: p.id,
        name: p.name,
        aliases: Object.freeze([...(p.aliases ?? [])]),
        description: p.description,
        material: p.material as WorldObject["material"],
        locationId: p.locationId,
        integrity: p.integrity,
        temperature: p.temperature,
        state: Object.freeze({ ...p.state }),
      });
      // Also add object to its location's objectIds
      const loc = state.locations.get(p.locationId);
      if (loc && !loc.objectIds.includes(p.id)) {
        const newObjectIds = [...loc.objectIds, p.id];
        state.locations.set(p.locationId, { ...loc, objectIds: newObjectIds });
      }
      break;
    }
    case "LocationDefined": {
      const p = event.payload as {
        id: string;
        name: string;
        description: string;
        objectIds: string[];
        connections: Record<string, string>;
      };
      state.locations.set(p.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        objectIds: [...p.objectIds],
        connections: Object.freeze({ ...p.connections }),
      });
      break;
    }
    case "PlayerLocationChanged": {
      const p = event.payload as { locationId: string };
      state.currentLocationId = p.locationId;
      break;
    }
    case "ObjectTemperatureChanged": {
      const p = event.payload as { objectId: string; temperature: number };
      const obj = state.objects.get(p.objectId);
      if (obj) {
        state.objects.set(p.objectId, { ...obj, temperature: p.temperature });
      }
      break;
    }
    case "ObjectIntegrityChanged": {
      const p = event.payload as { objectId: string; integrity: number; stateChange?: Record<string, unknown> };
      const obj = state.objects.get(p.objectId);
      if (obj) {
        const newState = p.stateChange ? { ...obj.state, ...p.stateChange } : obj.state;
        state.objects.set(p.objectId, { ...obj, integrity: p.integrity, state: Object.freeze(newState) });
      }
      break;
    }
    case "PassageOpened": {
      const p = event.payload as { fromLocationId: string; toLocationId: string; via: string };
      const loc = state.locations.get(p.fromLocationId);
      if (loc) {
        const newConnections = { ...loc.connections, [p.via]: p.toLocationId };
        state.locations.set(p.fromLocationId, { ...loc, connections: Object.freeze(newConnections) });
      }
      break;
    }
    default:
      break;
  }
}

export function cloneObjectState(state: {
  objects: Map<string, WorldObject>;
  locations: Map<string, Location>;
  currentLocationId: string;
}): {
  objects: Map<string, WorldObject>;
  locations: Map<string, Location>;
  currentLocationId: string;
} {
  const objects = new Map<string, WorldObject>();
  for (const [k, v] of state.objects) objects.set(k, { ...v, state: { ...v.state } });
  const locations = new Map<string, Location>();
  for (const [k, v] of state.locations) {
    locations.set(k, { ...v, objectIds: [...v.objectIds], connections: { ...v.connections } });
  }
  return { objects, locations, currentLocationId: state.currentLocationId };
}
