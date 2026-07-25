import { type DomainEvent, EventBus } from "@skald/event-bus";
import { START_POSITION, WALLS } from "./map.js";

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
  return events;
}

/** Apply bootstrap events to the canonical log and projection. */
export function commitBootstrap(bus: EventBus, apply: (e: DomainEvent) => void): void {
  for (const e of bootstrapWorldEvents()) {
    bus.append(e);
    apply(e);
  }
}