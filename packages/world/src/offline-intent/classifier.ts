import type { DomainEvent } from "@skald/event-bus";
import type { InteractionCommand } from "@skald/intent-parser";
import { rebuildProjection, type ReadonlyWorld } from "../projection.js";
import { resolveInteractionTarget } from "../interactions/index.js";
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
  readonly parsed: InteractionCommand;
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
 * resolver as the inspect gate (resolveInteractionTarget — never a copy,
 * ADR-0013 §3).
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

  if (context.parsed.verb !== "inspect") {
    return rejected("unsupported_offline_intent", "Сейчас без связи можно отправить только «осмотреть <объект>».");
  }

  const object = context.parsed.target?.raw ?? "";
  if (object.length === 0) {
    return rejected("no_such_target", "Рядом нет такого объекта.");
  }

  // Accepted: the intent is still executable against what is true now. The
  // world may have changed elsewhere — the player reads the actual result.
  if (resolveInteractionTarget(context.world, "inspect", object).kind === "resolved") {
    return Object.freeze({ resolution: "accepted", message: null, reason: null });
  }

  // The target no longer resolves. Conflict only if the intent would have
  // been executable at the envelope's base revision; otherwise it was
  // inadmissible all along and is an ordinary rejection.
  const base = rebuildProjection(context.events.slice(0, baseRevision)).getSnapshot();
  if (resolveInteractionTarget(base, "inspect", object).kind === "resolved") {
    return Object.freeze({
      resolution: "conflict",
      message: `Ты хотел осмотреть «${object}», но теперь это невозможно.`,
      reason: null,
    });
  }
  return rejected("no_such_target", "Рядом нет такого объекта.");
}
