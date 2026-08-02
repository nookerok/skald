import type { DomainEvent } from "@skald/event-bus";
import type { IntentCommand } from "@skald/intent-parser";
import { rebuildProjection, type ReadonlyWorld } from "../projection.js";
import { findExamineTarget } from "../rules/world-interaction.js";
import type {
  OfflineIntentEnvelope,
  OfflineIntentResolutionDTO,
  OfflineRejectReason,
} from "./types.js";

export interface OfflineClassificationContext {
  /** The full canonical Event Log, in order. Never a projection copy. */
  readonly events: readonly DomainEvent[];
  /** The current world snapshot, read synchronously with `events`. */
  readonly world: ReadonlyWorld;
  /** The server's own re-interpretation of the envelope text. */
  readonly parsed: IntentCommand;
}

function rejected(reason: OfflineRejectReason, message: string): OfflineIntentResolutionDTO {
  return Object.freeze({ resolution: "rejected", message, reason });
}

/**
 * Pure, deterministic classification of an offline intent envelope.
 *
 * The envelope's baseRevision selects the world the player last saw; the
 * classifier replays the event prefix up to that revision through
 * WorldProjector to reconstruct it, then compares target resolvability
 * between the base world and the current world using the exact same
 * predicate as the examine gate (findExamineTarget — never a copy).
 *
 * No network, no SQLite, no Date.now(), no Math.random(), no LLM. Calling
 * it twice with the same inputs returns identical, deeply frozen results.
 */
export function resolveOfflineIntent(
  envelope: OfflineIntentEnvelope,
  context: OfflineClassificationContext,
): OfflineIntentResolutionDTO {
  const { baseRevision } = envelope;
  const current = context.world;

  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || baseRevision > current.eventNumber) {
    return rejected("invalid_envelope", "Заявленная версия мира недействительна.");
  }

  if (context.parsed.verb !== "examine") {
    return rejected("unsupported_offline_intent", "Сейчас без связи можно отправить только «осмотреть <объект>».");
  }

  // Accepted: the intent is still executable against what is true now. The
  // world may have changed elsewhere — the player reads the actual result.
  if (findExamineTarget(context.world, context.parsed.object) !== undefined) {
    return Object.freeze({ resolution: "accepted", message: null, reason: null });
  }

  // The target no longer resolves. Conflict only if the intent would have
  // been executable at the envelope's base revision; otherwise it was
  // inadmissible all along and is an ordinary rejection.
  const base = rebuildProjection(context.events.slice(0, baseRevision)).getSnapshot();
  if (findExamineTarget(base, context.parsed.object) !== undefined) {
    return Object.freeze({
      resolution: "conflict",
      message: `Ты хотел осмотреть «${context.parsed.object}», но теперь это невозможно.`,
      reason: null,
    });
  }
  return rejected("no_such_target", "Рядом нет такого объекта.");
}
