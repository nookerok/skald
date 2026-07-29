import { commandEventId } from "../ids.js";
import type { DomainEvent } from "@skald/event-bus";

/**
 * Build the initial bootstrap events for a given world template.
 * Different templates produce different starting Event Logs.
 */
export function buildBootstrapEvents(templateId: string): readonly DomainEvent[] {
  const events: DomainEvent[] = [];

  // PlayerSpawned — all worlds start with player at (0,0)
  events.push({
    eventId: commandEventId("bootstrap", "PlayerSpawned"),
    type: "PlayerSpawned",
    schemaVersion: 1,
    payload: { x: 0, y: 0 },
    timestamp: 0,
    correlationId: "bootstrap",
    causationId: null,
  });

  // Wall placements differ by template
  if (templateId === "old_tower") {
    // Tower: walls surround the player, narrow corridor north
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
  } else if (templateId === "crossroads") {
    // Crossroads: open space, walls at edges, heat source further away
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
    // legacy or unknown: use minimal default
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

  // StrategySet — common for all
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
