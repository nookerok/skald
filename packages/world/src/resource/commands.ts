import type { DomainEvent } from "@skald/event-bus";
import { commandEventId } from "../ids.js";

export interface ResourceExtractionCommand {
  readonly type: "ResourceExtractionCommand";
  readonly nodeId: string;
  readonly methodId: string;
  readonly requestedUnits: number;
  readonly actorId?: string;
}

/** Converts a structurally valid resource command into a root event. */
export function handleResourceExtractionCommand(
  command: ResourceExtractionCommand,
  correlationId: string,
  timestamp: number,
): DomainEvent {
  const base = { schemaVersion: 1, timestamp, correlationId, causationId: null } as const;
  if (!command.nodeId || !command.methodId || !Number.isInteger(command.requestedUnits) || command.requestedUnits <= 0) {
    return {
      ...base,
      eventId: commandEventId(correlationId, "CommandRejected"),
      type: "CommandRejected",
      payload: { reason: "invalid resource extraction request" },
    };
  }
  return {
    ...base,
    eventId: commandEventId(correlationId, "ResourceExtractionRequested"),
    type: "ResourceExtractionRequested",
    payload: {
      nodeId: command.nodeId,
      methodId: command.methodId,
      requestedUnits: command.requestedUnits,
      actorId: command.actorId ?? "player",
    },
  };
}
