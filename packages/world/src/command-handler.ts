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

  const reference = (value: { raw: string; normalized?: string } | undefined): { normalized: string } | null => {
    const normalized = value?.normalized?.trim() || value?.raw.trim() || "";
    return normalized.length > 0 ? { normalized } : null;
  };
  const referenceText = (value: { raw: string; normalized?: string } | undefined): string | null => {
    const normalized = value?.normalized?.trim() || value?.raw.trim() || "";
    return normalized.length > 0 ? normalized : null;
  };

  if (command.type === "ActionIntentCommand" && command.mode === "travel" && command.operation === "interrupt") {
    return { ...base, eventId: commandEventId(correlationId, "JourneyInterruptRequested"), type: "JourneyInterruptRequested", payload: {} };
  }

  if (command.type === "JourneyIntent") {
    const destination = command.destination?.normalized?.trim() || command.destination?.raw.trim() || "";
    if (destination.length === 0) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: "missing journey destination" } };
    return { ...base, eventId: commandEventId(correlationId, "JourneyRequested"), type: "JourneyRequested", payload: { destination, routeHint: referenceText(command.routeHint) } };
  }

  if (command.type === "InteractionCommand") {
    if (!isKnownInteractionVerb(command.verb)) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: `unknown interaction verb: ${command.verb}` } };
    const object = command.target?.normalized?.trim() || command.target?.raw.trim() || "";
    const allowsNoTarget = command.verb === "observe" || command.verb === "listen";
    if (object.length === 0 && !allowsNoTarget) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: "missing interaction object" } };
    return { ...base, eventId: commandEventId(correlationId, 'InteractionRequested'), type: 'InteractionRequested', payload: { verb: command.verb, object, secondaryTarget: referenceText(command.secondaryTarget), instrument: referenceText(command.instrument), goal: command.goal ?? null, manner: command.manner ?? null, location: null, modifiers: [] } };
  }

  if (!command.mode || !command.operation) return { ...base, eventId: commandEventId(correlationId, "CommandRejected"), type: "CommandRejected", payload: { reason: "missing mode or operation" } };
  const speech = command.operation === "speak" && command.utterance
    ? (() => {
        const match = command.utterance.match(/^(\S+)\s+to\s+(.+)$/);
        return match ? { relation: match[1]!, target: match[2]!.trim() } : null;
      })()
    : null;
  const actionTarget = command.mode === "relocate"
    ? reference(command.target)
    : referenceText(command.target);
  return {
    ...base,
    eventId: commandEventId(correlationId, "ActionAttempted"),
    type: "ActionAttempted",
    payload: {
      mode: command.mode,
      operation: command.operation,
      target: actionTarget,
      secondaryTarget: reference(command.secondaryTarget),
      instrument: reference(command.instrument),
      manner: command.manner ?? null,
      goal: command.goal ?? null,
      ...(speech ? { speech } : {}),
      interpretation: command.interpretation,
    },
  };
}
