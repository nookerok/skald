import type { DomainEvent } from "@skald/event-bus";
import type { ResourceQualityBand } from "./types.js";
import { commandEventId } from "../ids.js";

export interface ResourceExtractionCommand {
  readonly type: "ResourceExtractionCommand";
  readonly nodeId: string;
  readonly methodId: string;
  readonly requestedUnits: number;
  readonly actorId?: string;
}

export interface ResourceTransferCommand {
  readonly type: "ResourceTransferCommand";
  readonly fromOwnerId: string;
  readonly toOwnerId: string;
  readonly resourceKind: string;
  readonly quality: ResourceQualityBand;
  readonly amountUnits: number;
}

export interface ResourceConsumeCommand {
  readonly type: "ResourceConsumeCommand";
  readonly ownerId: string;
  readonly resourceKind: string;
  readonly quality: ResourceQualityBand;
  readonly amountUnits: number;
  readonly reason: string;
}

function base(correlationId: string, timestamp: number) {
  return { schemaVersion: 1, timestamp, correlationId, causationId: null } as const;
}

function rejected(correlationId: string, timestamp: number, reason: string): DomainEvent {
  return { ...base(correlationId, timestamp), eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason } };
}

/** Converts a structurally valid resource extraction command into a root event. */
export function handleResourceExtractionCommand(command: ResourceExtractionCommand, correlationId: string, timestamp: number): DomainEvent {
  if (!command.nodeId || !command.methodId || !Number.isInteger(command.requestedUnits) || command.requestedUnits <= 0) return rejected(correlationId, timestamp, "invalid resource extraction request");
  return {
    ...base(correlationId, timestamp),
    eventId: commandEventId(correlationId, "ResourceExtractionRequested"),
    type: "ResourceExtractionRequested",
    payload: { nodeId: command.nodeId, methodId: command.methodId, requestedUnits: command.requestedUnits, actorId: command.actorId ?? "player" },
  };
}

export function handleResourceTransferCommand(command: ResourceTransferCommand, correlationId: string, timestamp: number): DomainEvent {
  if (!command.fromOwnerId || !command.toOwnerId || command.fromOwnerId === command.toOwnerId || !command.resourceKind || !Number.isInteger(command.amountUnits) || command.amountUnits <= 0) return rejected(correlationId, timestamp, "invalid resource transfer request");
  return { ...base(correlationId, timestamp), eventId: commandEventId(correlationId, "ResourceTransferRequested"), type: "ResourceTransferRequested", payload: { fromOwnerId: command.fromOwnerId, toOwnerId: command.toOwnerId, resourceKind: command.resourceKind, quality: command.quality, amountUnits: command.amountUnits } };
}

export function handleResourceConsumeCommand(command: ResourceConsumeCommand, correlationId: string, timestamp: number): DomainEvent {
  if (!command.ownerId || !command.resourceKind || !command.reason || !Number.isInteger(command.amountUnits) || command.amountUnits <= 0) return rejected(correlationId, timestamp, "invalid resource consume request");
  return { ...base(correlationId, timestamp), eventId: commandEventId(correlationId, "ResourceConsumeRequested"), type: "ResourceConsumeRequested", payload: { ownerId: command.ownerId, resourceKind: command.resourceKind, quality: command.quality, amountUnits: command.amountUnits, reason: command.reason } };
}




export interface ResourceProcessCommand {
  readonly type: "ResourceProcessCommand";
  readonly processId: string;
  readonly ownerId: string;
}

export function handleResourceProcessCommand(command: ResourceProcessCommand, correlationId: string, timestamp: number): DomainEvent {
  if (!command.processId || !command.ownerId) return rejected(correlationId, timestamp, "invalid resource process request");
  return { ...base(correlationId, timestamp), eventId: commandEventId(correlationId, "ResourceProcessRequested"), type: "ResourceProcessRequested", payload: { processId: command.processId, ownerId: command.ownerId } };
}
