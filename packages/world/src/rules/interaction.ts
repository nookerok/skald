import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import { TEMPERATURE_HOT, TEMPERATURE_DANGEROUS } from "../objects/types.js";

/**
 * Observe rule — handles perceive/observe and perceive/listen actions.
 * Produces ObjectObserved events for objects in the current location.
 */
export const interactionObserve: Rule<ReadonlyWorld> = {
  id: "interaction.observe",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ObjectObserved", "ActionResolved", "ActionHadNoObservableEffect"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;
    const operation = payload["operation"] as string | undefined;
    const target = payload["target"] as { raw: string; normalized?: string } | undefined;

    if (operation !== "observe" && operation !== "listen" && operation !== "touch") {
      return [];
    }

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    // Find objects in current location
    const locationId = world.currentLocationId;
    if (!locationId) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionHadNoObservableEffect", 0),
        type: "ActionHadNoObservableEffect",
        payload: { reason: "no_location" },
      }];
    }

    const location = world.locations.get(locationId);
    if (!location) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionHadNoObservableEffect", 0),
        type: "ActionHadNoObservableEffect",
        payload: { reason: "location_not_found" },
      }];
    }

    // Find matching objects
    const targetRaw = target?.raw?.toLowerCase() ?? "";
    const matchedObjects = location!.objectIds
      .map((id) => world.objects.get(id))
      .filter((obj): obj is NonNullable<typeof obj> => obj !== undefined)
      .filter((obj) => {
        if (!targetRaw) return true;
        return obj.name.toLowerCase().includes(targetRaw) ||
               obj.id.toLowerCase().includes(targetRaw);
      });

    if (matchedObjects.length === 0) {
      // No matching objects — describe the location instead
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionResolved", 0),
        type: "ActionResolved",
        payload: {
          actionEventId: event.eventId,
          result: "observation",
          description: location.description,
        },
      }];
    }

    const events: DomainEvent[] = [];
    let idx = 0;

    for (const obj of matchedObjects) {
      events.push({
        ...base,
        eventId: ruleEventId(event.eventId, "ObjectObserved", idx),
        type: "ObjectObserved",
        payload: {
          objectId: obj.id,
          name: obj.name,
          description: obj.description,
          material: obj.material,
          temperature: obj.temperature,
          integrity: obj.integrity,
          state: obj.state,
        },
      });
      idx++;
    }

    // Also emit ActionResolved
    events.push({
      ...base,
      eventId: ruleEventId(event.eventId, "ActionResolved", idx),
      type: "ActionResolved",
      payload: {
        actionEventId: event.eventId,
        result: "observation",
        description: matchedObjects.map((o) => o.description).join(" "),
      },
    });

    return events;
  },
};

/**
 * Heat rule — handles interact/heat actions.
 * Changes object temperature and may affect integrity.
 */
export const interactionHeat: Rule<ReadonlyWorld> = {
  id: "interaction.heat",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ObjectTemperatureChanged", "SoundProduced", "ActionResolved"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;
    const operation = payload["operation"] as string | undefined;
    const target = payload["target"] as { raw: string; normalized?: string } | undefined;

    if (operation !== "heat") {
      return [];
    }

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    const locationId = world.currentLocationId;
    if (!locationId) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionHadNoObservableEffect", 0),
        type: "ActionHadNoObservableEffect",
        payload: { reason: "no_location" },
      }];
    }

    const location = world.locations.get(locationId);
    if (!location) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionHadNoObservableEffect", 0),
        type: "ActionHadNoObservableEffect",
        payload: { reason: "location_not_found" },
      }];
    }

    // Find matching objects
    const targetRaw = target?.raw?.toLowerCase() ?? "";
    const matchedObjects = location!.objectIds
      .map((id) => world.objects.get(id))
      .filter((obj): obj is NonNullable<typeof obj> => obj !== undefined)
      .filter((obj) => {
        if (!targetRaw) return false;
        return obj.name.toLowerCase().includes(targetRaw) ||
               obj.id.toLowerCase().includes(targetRaw);
      });

    if (matchedObjects.length === 0) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionResolved", 0),
        type: "ActionResolved",
        payload: {
          actionEventId: event.eventId,
          result: "no_effect",
          description: "Ты пытаешься нагреть это, но не находишь подходящий объект.",
        },
      }];
    }

    const events: DomainEvent[] = [];
    let idx = 0;

    for (const obj of matchedObjects) {
      // Calculate new temperature (heated by 30 degrees, capped at 100)
      const newTemp = Math.min(100, obj.temperature + 30);

      events.push({
        ...base,
        eventId: ruleEventId(event.eventId, "ObjectTemperatureChanged", idx),
        type: "ObjectTemperatureChanged",
        payload: {
          objectId: obj.id,
          name: obj.name,
          previousTemperature: obj.temperature,
          temperature: newTemp,
        },
      });
      idx++;

      // Metal makes sounds when heated
      if (obj.material === "iron" || obj.material === "glass") {
        events.push({
          ...base,
          eventId: ruleEventId(event.eventId, "SoundProduced", idx),
          type: "SoundProduced",
          payload: {
            source: obj.name,
            kind: obj.material === "iron" ? "metal_creak" : "glass_crack",
            intensity: newTemp > TEMPERATURE_DANGEROUS ? "loud" : "quiet",
            locationId,
          },
        });
        idx++;
      }
    }

    // ActionResolved with description
    const descriptions = matchedObjects.map((o) => {
      const newTemp = Math.min(100, o.temperature + 30);
      if (newTemp > TEMPERATURE_DANGEROUS) {
        return `${o.name} раскаляется и становится опасной для касания.`;
      }
      if (newTemp > TEMPERATURE_HOT) {
        return `${o.name} нагревается. Металл становится горячим.`;
      }
      return `${o.name} слегка тёплая на ощупь.`;
    });

    events.push({
      ...base,
      eventId: ruleEventId(event.eventId, "ActionResolved", idx),
      type: "ActionResolved",
      payload: {
        actionEventId: event.eventId,
        result: "heat",
        description: descriptions.join(" "),
      },
    });

    return events;
  },
};

/**
 * Force rule — handles interact/apply_force actions.
 * May trigger critical checks for uncertain outcomes.
 */
export const interactionForce: Rule<ReadonlyWorld> = {
  id: "interaction.force",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["CriticalCheckRequested", "ActionResolved", "ActionHadNoObservableEffect", "SoundProduced"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;
    const operation = payload["operation"] as string | undefined;
    const target = payload["target"] as { raw: string; normalized?: string } | undefined;

    if (operation !== "apply_force") {
      return [];
    }

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    const locationId = world.currentLocationId;
    if (!locationId) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionHadNoObservableEffect", 0),
        type: "ActionHadNoObservableEffect",
        payload: { reason: "no_location" },
      }];
    }

    // Find target object
    const location = world.locations.get(locationId);
    const targetRaw = target?.raw?.toLowerCase() ?? "";

    const matchedObject = location?.objectIds
      .map((id) => world.objects.get(id))
      .filter((obj): obj is NonNullable<typeof obj> => obj !== undefined)
      .find((obj) => {
        if (!targetRaw) return false;
        return obj.name.toLowerCase().includes(targetRaw) ||
               obj.id.toLowerCase().includes(targetRaw);
      });

    if (!matchedObject) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionHadNoObservableEffect", 0),
        type: "ActionHadNoObservableEffect",
        payload: { reason: "target_not_found" },
      }];
    }

    // Determine if a critical check is needed
    // Critical check: when outcome is uncertain AND stakes are meaningful
    const needsCheck = matchedObject.integrity > 20 && matchedObject.integrity < 80;

    if (needsCheck) {
      // Calculate difficulty from world facts
      // Model: roll + modifiers >= fixed DC
      // The DC is fixed based on the object's base integrity
      const difficulty = matchedObject.integrity > 60 ? 15 : matchedObject.integrity > 40 ? 12 : 10;
      const modifiers: Array<{ label: string; delta: number }> = [];

      // Heated metal is easier to break (positive modifier for player)
      if (matchedObject.temperature > TEMPERATURE_HOT) {
        const delta = Math.floor((matchedObject.temperature - TEMPERATURE_HOT) / 10);
        modifiers.push({ label: "Нагретый металл", delta });
      }

      // Existing damage makes it easier (positive modifier for player)
      if (matchedObject.integrity < 60) {
        const delta = Math.floor((60 - matchedObject.integrity) / 10);
        modifiers.push({ label: "Повреждение", delta });
      }

      // Low integrity means already weak (positive modifier for player)
      if (matchedObject.integrity < 40) {
        modifiers.push({ label: "Уже ослаблен", delta: 5 });
      }

      // Sound from the attempt
      const events: DomainEvent[] = [{
        ...base,
        eventId: ruleEventId(event.eventId, "SoundProduced", 0),
        type: "SoundProduced",
        payload: {
          source: matchedObject.name,
          kind: "impact",
          intensity: "loud",
          locationId,
          pendingCheck: true,
        },
      }];

      // Critical check requested
      events.push({
        ...base,
        eventId: ruleEventId(event.eventId, "CriticalCheckRequested", 1),
        type: "CriticalCheckRequested",
        payload: {
          checkId: `${event.eventId}>check`,
          actionEventId: event.eventId,
          checkKind: "force",
          die: "d20",
          difficulty,
          modifiers,
          targetObjectId: matchedObject.id,
          targetObjectName: matchedObject.name,
          locationId,
          stakes: {
            success: `${matchedObject.name} поддаётся и открывает проход.`,
            failure: `Шум и обломки привлекают внимание. ${matchedObject.name} остаётся на месте.`,
          },
        },
      });

      return events;
    }

    // No check needed — direct resolution
    const events: DomainEvent[] = [];

    // Apply damage
    const damage = matchedObject.integrity > 50 ? 20 : 30;
    const newIntegrity = Math.max(0, matchedObject.integrity - damage);

    events.push({
      ...base,
      eventId: ruleEventId(event.eventId, "ObjectIntegrityChanged", 0),
      type: "ObjectIntegrityChanged",
      payload: {
        objectId: matchedObject.id,
        name: matchedObject.name,
        previousIntegrity: matchedObject.integrity,
        integrity: newIntegrity,
      },
    });

    // Sound
    events.push({
      ...base,
      eventId: ruleEventId(event.eventId, "SoundProduced", 1),
      type: "SoundProduced",
      payload: {
        source: matchedObject.name,
        kind: "impact",
        intensity: "loud",
        locationId,
      },
    });

    // Destruction opens a door or its hinges and unlocks the associated door.
    if (newIntegrity <= 0 && (matchedObject.id.includes("door") || matchedObject.id.includes("hinge"))) {
      events.push({
        ...base,
        eventId: ruleEventId(event.eventId, "PassageOpened", events.length),
        type: "PassageOpened",
        payload: {
          fromLocationId: locationId,
          toLocationId: location!.connections["enter"] ?? "tower_interior",
          via: matchedObject.id,
        },
      });
      const lockedDoor = location!.objectIds
        .map((id) => world.objects.get(id))
        .find((obj): obj is NonNullable<typeof obj> =>
          obj !== undefined && obj.id.includes("door") && obj.state["locked"] === true,
        );
      if (lockedDoor && lockedDoor.id !== matchedObject.id) {
        events.push({
          ...base,
          eventId: ruleEventId(event.eventId, "ObjectIntegrityChanged", events.length),
          type: "ObjectIntegrityChanged",
          payload: {
            objectId: lockedDoor.id,
            name: lockedDoor.name,
            previousIntegrity: lockedDoor.integrity,
            integrity: lockedDoor.integrity,
            stateChange: { locked: false },
          },
        });
      }
    }

    // Resolution
    if (newIntegrity <= 0) {
      events.push({
        ...base,
        eventId: ruleEventId(event.eventId, "ActionResolved", events.length),
        type: "ActionResolved",
        payload: {
          actionEventId: event.eventId,
          result: "destruction",
          description: `${matchedObject.name} разрушается! Обломки падают на землю.`,
        },
      });
    } else {
      events.push({
        ...base,
        eventId: ruleEventId(event.eventId, "ActionResolved", events.length),
        type: "ActionResolved",
        payload: {
          actionEventId: event.eventId,
          result: "partial_damage",
          description: `${matchedObject.name} повреждена, но держится.`,
        },
      });
    }

    return events;
  },
};

/**
 * Sound reaction rule — handles SoundProduced events.
 * Creates delayed consequences based on sound intensity.
 */
export const interactionSoundReaction: Rule<ReadonlyWorld> = {
  id: "interaction.sound_reaction",
  phase: "consequence",
  listens: ["SoundProduced"],
  produces: ["ConsequenceCreated"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const payload = event.payload as { intensity: string; source: string; pendingCheck?: boolean };
    const intensity = payload.intensity;

    if (payload.pendingCheck) return [];

    // Only loud sounds create consequences
    if (intensity !== "loud") {
      return [];
    }

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    // Create a "noise_attention" consequence that expires after 3 ticks
    return [{
      ...base,
      eventId: ruleEventId(event.eventId, "ConsequenceCreated", 0),
      type: "ConsequenceCreated",
      payload: {
        id: `noise-${event.eventId}`,
        type: "noise_attention",
        severity: 2,
        createdAt: event.timestamp,
        expiresAt: event.timestamp + 3,
        data: { source: payload.source, intensity },
      },
    }];
  },
};

/**
 * Movement rule for ActionAttempted with relocate/approach or relocate/enter.
 * Produces PlayerLocationChanged or ActionBlocked.
 */
export const interactionMovement: Rule<ReadonlyWorld> = {
  id: "interaction.movement",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["PlayerLocationChanged", "ActionBlocked", "ActionResolved"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;
    const mode = payload["mode"] as string | undefined;
    const operation = payload["operation"] as string | undefined;

    if (mode !== "relocate") {
      return [];
    }

    if (operation !== "approach" && operation !== "enter") {
      return [];
    }

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    const currentLocationId = world.currentLocationId;
    if (!currentLocationId) {
      return [];
    }

    const currentLocation = world.locations.get(currentLocationId);
    if (!currentLocation) {
      return [];
    }

    // Check connections
    const target = payload["target"] as { raw: string; normalized?: string } | undefined;
    const targetRaw = target?.raw?.toLowerCase() ?? "";

    // Try to find a matching connection
    let destinationId: string | undefined;

    // Check for direct connection name match
    for (const [connName, connTarget] of Object.entries(currentLocation.connections)) {
      if (targetRaw.includes(connName) || targetRaw.includes(connTarget)) {
        destinationId = connTarget;
        break;
      }
    }

    // Check for "enter" keyword matching connection
    if (!destinationId && operation === "enter") {
      for (const [connName, connTarget] of Object.entries(currentLocation.connections)) {
        if (connName === "enter" || connName === "inside") {
          destinationId = connTarget;
          break;
        }
      }
    }

    if (!destinationId) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionBlocked", 0),
        type: "ActionBlocked",
        payload: { reason: "no_passage", locationId: currentLocationId, connections: Object.keys(currentLocation.connections) },
      }];
    }

    // Check if passage is blocked (e.g., door is closed)
    const passageObject = currentLocation.objectIds
      .map((id) => world.objects.get(id))
      .find((obj): obj is NonNullable<typeof obj> => obj !== undefined && obj.state["locked"] === true);

    if (passageObject && operation === "enter") {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionBlocked", 0),
        type: "ActionBlocked",
        payload: { reason: "passage_blocked", objectId: passageObject.id, objectName: passageObject.name },
      }];
    }

    // Move player to new location
    const destLocation = world.locations.get(destinationId);
    return [{
      ...base,
      eventId: ruleEventId(event.eventId, "PlayerLocationChanged", 0),
      type: "PlayerLocationChanged",
      payload: {
        locationId: destinationId,
        locationName: destLocation?.name ?? destinationId,
      },
    }, {
      ...base,
      eventId: ruleEventId(event.eventId, "ActionResolved", 1),
      type: "ActionResolved",
      payload: {
        actionEventId: event.eventId,
        result: "movement",
        description: destLocation?.description ?? `Ты перемещаешься в ${destinationId}.`,
      },
    }];
  },
};

export const interactionRules = [
  interactionObserve,
  interactionHeat,
  interactionForce,
  interactionSoundReaction,
  interactionMovement,
];
