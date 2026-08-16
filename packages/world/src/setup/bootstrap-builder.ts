import { commandEventId } from "../ids.js";
import type { DomainEvent } from "@skald/event-bus";
import { getWorldTemplate } from "./world-templates.js";
import { getCharacterBackground } from "./character-presets.js";
import { OLD_TOWER_OBJECTS, OLD_TOWER_LOCATIONS } from "../objects/definitions.js";
import { LEGACY_LOCATIONS, LEGACY_OBJECTS } from "../objects/definitions.js";
import { buildRegionBootstrapEvents, getRegionBackgroundBinding } from "../region/compiler.js";
import { getDefaultRegionEntrypoint, getRegionEntrypoint } from "./entrypoints.js";

export interface BootstrapSelection {
  readonly templateId: string;
  readonly regionId?: string | undefined;
  readonly entrypointId?: string | undefined;
  readonly backgroundId?: string | undefined;
}

/** Materialize only author-approved entrypoint knowledge as domain facts. */
function buildEntrypointKnowledgeEvents(entrypoint: Exclude<ReturnType<typeof getRegionEntrypoint>, null>, regionEvents: readonly DomainEvent[]): DomainEvent[] {
  const observations = new Map<string, { readonly subjectKind: string; readonly subjectId: string; readonly knowledge?: string; readonly confidence?: number }>();
  for (const event of regionEvents) {
    if (event.type !== "SpatialObservationRecorded") continue;
    const payload = event.payload as { subjectKind?: string; subjectId?: string; knowledge?: string; confidence?: number };
    if (typeof payload.subjectKind !== "string" || typeof payload.subjectId !== "string") continue;
    observations.set(`${payload.subjectKind}:${payload.subjectId}`, payload as { subjectKind: string; subjectId: string; knowledge?: string; confidence?: number });
  }
  const locations = new Map<string, string>();
  for (const event of regionEvents) {
    if (event.type !== "LocationDefined") continue;
    const payload = event.payload as { id?: string; name?: string };
    if (typeof payload.id === "string" && typeof payload.name === "string") locations.set(payload.id, payload.name);
  }
  const routes = new Map<string, string>();
  const regionEvent = regionEvents.find((event) => event.type === "RegionDefined");
  const region = (regionEvent?.payload as { region?: { relations?: readonly { id?: string; label?: string }[] } } | undefined)?.region;
  for (const relation of region?.relations ?? []) {
    if (typeof relation.id === "string") routes.set(relation.id, relation.label ?? relation.id);
  }
  const locationEvent = regionEvents.find((event) => event.type === "PlayerLocationChanged");
  return entrypoint.initialKnowledgeRefs.map((ref, index) => {
    const observation = observations.get(ref);
    if (!observation) throw new Error(`entrypoint knowledge reference has no observation: ${ref}`);
    const subjectKind = observation.subjectKind;
    const subjectId = observation.subjectId;
    const label = subjectKind === "location" ? locations.get(subjectId) ?? subjectId : subjectKind === "relation" ? routes.get(subjectId) ?? subjectId : subjectId;
    const article = subjectKind === "relation" ? "Ты знаешь дорогу" : "Ты знаешь место";
    return { eventId: commandEventId(`bootstrap-entrypoint-${entrypoint.id}-knowledge-${index}`, "KnowledgeAcquired"), type: "KnowledgeAcquired", schemaVersion: 1, payload: { subjectId: "player", knowledgeId: `entrypoint:${entrypoint.id}:${ref}`, proposition: `${article} «${label}».`, sourceObservationRef: ref, knowledge: observation.knowledge, confidence: observation.confidence }, timestamp: 0, correlationId: "bootstrap", causationId: locationEvent?.eventId ?? null };
  });
}

export function buildBootstrapEvents(selection: string | BootstrapSelection): readonly DomainEvent[] {
  const options = typeof selection === "string" ? { templateId: selection } : selection;
  const templateId = options.templateId;
  const template = getWorldTemplate(templateId);
  if (!template && templateId !== "legacy") {
    throw new Error(`Unknown world template: ${templateId}`);
  }
  const events: DomainEvent[] = [];

  if (templateId === "living_region") {
    const regionId = options.regionId ?? template?.regionId ?? "riverwatch-basin";
    const entrypoint = options.entrypointId ? getRegionEntrypoint(options.entrypointId, regionId) : getDefaultRegionEntrypoint(regionId);
    if (!entrypoint) throw new Error(`Unknown region entrypoint: ${options.entrypointId}`);
    if (options.backgroundId && !entrypoint.availableBackgroundIds.includes(options.backgroundId)) throw new Error(`Background ${options.backgroundId} cannot start at ${entrypoint.id}`);
    const regionEvents = [...buildRegionBootstrapEvents(regionId, entrypoint.id)];
    regionEvents.push(...buildEntrypointKnowledgeEvents(entrypoint, regionEvents));
    const locationEvent = regionEvents.find((event) => event.type === "PlayerLocationChanged");
    const locationId = (locationEvent?.payload as { locationId?: unknown } | undefined)?.locationId;
    if (locationId !== entrypoint.locationId) {
      throw new Error("compiled region bootstrap does not start at entrypoint " + entrypoint.id);
    }
    if (options.backgroundId) {
      const background = getCharacterBackground(options.backgroundId);
      if (!background) throw new Error("Unknown character background: " + options.backgroundId);
      const binding = getRegionBackgroundBinding(regionId, background.id);
      if (binding) {
        // Keep the legacy compact key close to the entrypoint knowledge so
        // bounded event feeds remain backward-compatible.
        regionEvents.push({
          eventId: commandEventId("bootstrap-background-" + background.id, "KnowledgeAcquired"),
          type: "KnowledgeAcquired",
          schemaVersion: 1,
          payload: {
            subjectId: "player",
            knowledgeId: "background:" + background.id,
            proposition: background.startingKnowledge,
          },
          timestamp: 0,
          correlationId: "bootstrap",
          causationId: locationEvent?.eventId ?? null,
        });
        const existingSubjects = new Set(regionEvents
          .filter((event) => event.type === "SpatialObservationRecorded")
          .map((event) => {
            const payload = event.payload as { subjectKind?: string; subjectId?: string };
            return payload.subjectKind && payload.subjectId ? payload.subjectKind + ":" + payload.subjectId : "";
          }));
        for (const event of binding.bootstrapEvents) {
          if (event.type === "SpatialObservationRecorded") {
            const payload = event.payload as { subjectKind?: string; subjectId?: string };
            const key = payload.subjectKind && payload.subjectId ? payload.subjectKind + ":" + payload.subjectId : "";
            if (existingSubjects.has(key)) continue;
            existingSubjects.add(key);
          }
          regionEvents.push(event);
        }
      } else {
        // Compatibility with pre-background compiled bundles.
        regionEvents.push({
          eventId: commandEventId("bootstrap-background-" + background.id, "KnowledgeAcquired"),
          type: "KnowledgeAcquired",
          schemaVersion: 1,
          payload: {
            subjectId: "player",
            knowledgeId: "background:" + background.id,
            proposition: background.startingKnowledge,
          },
          timestamp: 0,
          correlationId: "bootstrap",
          causationId: locationEvent?.eventId ?? null,
        });
      }
    }
    return Object.freeze(regionEvents);
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
          mass: obj.mass,
          portable: obj.portable,
          affordances: obj.affordances,
          containerCapacity: obj.containerCapacity,
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
          mass: obj.mass,
          portable: obj.portable,
          affordances: obj.affordances,
          containerCapacity: obj.containerCapacity,
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
