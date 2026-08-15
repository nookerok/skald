import type { DomainEvent } from "@skald/event-bus";
import type { ActionIntentCommand, InteractionCommand, JourneyIntent } from "@skald/intent-parser";
import { commandEventId } from "./ids.js";
import { isKnownInteractionVerb } from "./interaction-registry.js";
import { handleResourceExtractionCommand, handleResourceTransferCommand, handleResourceConsumeCommand, handleResourceProcessCommand } from "./resource/commands.js";
import type { ResourceExtractionCommand, ResourceTransferCommand, ResourceConsumeCommand, ResourceProcessCommand } from "./resource/commands.js";

/**
 * Command Handler (infra, NOT a Rule — AGENTS invariant #7, §9.9).
 * Performs structural validation only and produces one root Domain Event.
 */
export function handleCommand(
  command: ActionIntentCommand | InteractionCommand | JourneyIntent | ResourceExtractionCommand | ResourceTransferCommand | ResourceConsumeCommand | ResourceProcessCommand,
  correlationId: string,
  timestamp: number,
): DomainEvent {
  const base = { schemaVersion: 1, timestamp, correlationId, causationId: null } as const;
  const commandType = (command as { type?: unknown }).type;
  const validTypes = ["ActionIntentCommand", "InteractionCommand", "JourneyIntent", "ResourceExtractionCommand", "ResourceTransferCommand", "ResourceConsumeCommand", "ResourceProcessCommand"];
  if (!validTypes.includes(String(commandType))) {
    return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: `invalid command type: ${String(commandType)}` } };
  }

  if (command.type === "ResourceExtractionCommand") return handleResourceExtractionCommand(command, correlationId, timestamp);
  if (command.type === "ResourceTransferCommand") return handleResourceTransferCommand(command, correlationId, timestamp);
  if (command.type === "ResourceConsumeCommand") return handleResourceConsumeCommand(command, correlationId, timestamp);
  if (command.type === "ResourceProcessCommand") return handleResourceProcessCommand(command, correlationId, timestamp);

  if (command.type === "ActionIntentCommand" && command.mode === "travel" && command.operation === "interrupt") {
    return { ...base, eventId: commandEventId(correlationId, "JourneyInterruptRequested"), type: "JourneyInterruptRequested", payload: { rawText: command.rawText } };
  }

  if (command.type === "JourneyIntent") {
    const destination = command.destination?.raw.trim() ?? "";
    if (destination.length === 0) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: "missing journey destination" } };
    return { ...base, eventId: commandEventId(correlationId, "JourneyRequested"), type: "JourneyRequested", payload: { destination, routeHint: command.routeHint?.raw ?? null, rawText: command.rawText } };
  }

  if (command.type === "InteractionCommand") {
    if (!isKnownInteractionVerb(command.verb)) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: `unknown interaction verb: ${command.verb}` } };
    const object = command.target?.raw.trim() ?? "";
    const allowsNoTarget = command.verb === "observe" || command.verb === "listen";
    if (object.length === 0 && !allowsNoTarget) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: "missing interaction object" } };
    return { ...base, eventId: commandEventId(correlationId, 'InteractionRequested'), type: 'InteractionRequested', payload: { verb: command.verb, object, secondaryTarget: command.secondaryTarget?.raw ?? null, instrument: command.instrument?.raw ?? null, goal: command.goal ?? null, manner: command.manner ?? null, location: null, modifiers: [] } };
  }

  if (!command.mode || !command.operation) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: "missing mode or operation" } };
  return {
    ...base,
    eventId: commandEventId(correlationId, "ActionAttempted"),
    type: "ActionAttempted",
    payload: {
      mode: command.mode,
      operation: command.operation,
      target: command.target ?? null,
      secondaryTarget: command.secondaryTarget ?? null,
      instrument: command.instrument ?? null,
      manner: command.manner ?? null,
      goal: command.goal ?? null,
      utterance: command.utterance ?? null,
      rawText: command.rawText,
      interpretation: command.interpretation,
    },
  };
}
