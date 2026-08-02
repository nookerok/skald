import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { InteractionCommand } from "@skald/intent-parser";
import { bootstrapWorldEvents } from "../src/bootstrap.js";
import { rebuildProjection } from "../src/projection.js";
import { resolveOfflineIntent } from "../src/offline-intent/index.js";
import type { OfflineIntentEnvelope } from "../src/offline-intent/types.js";

function e(eventId: string, type: string, timestamp: number, payload: Record<string, unknown>): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: `cmd-${timestamp}`, causationId: null };
}

function inspect(object: string): InteractionCommand {
  return {
    type: "InteractionCommand",
    verb: "inspect",
    target: { raw: object },
    rawText: `examine ${object}`,
    interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
  };
}

function classify(
  events: readonly DomainEvent[],
  envelope: OfflineIntentEnvelope,
  parsed: InteractionCommand = inspect("cart"),
) {
  const world = rebuildProjection(events).getSnapshot();
  return resolveOfflineIntent(envelope, { events, world, parsed });
}

function envelope(baseRevision: number, input = "examine cart", idempotencyKey = "key-1"): OfflineIntentEnvelope {
  return { input, idempotencyKey, baseRevision };
}

const BOOTSTRAP = bootstrapWorldEvents();
const BOOTSTRAP_REVISION = BOOTSTRAP.length;

describe("resolveOfflineIntent", () => {
  it("accepts an examine that still resolves in the current world", () => {
    const dto = classify(BOOTSTRAP, envelope(BOOTSTRAP_REVISION));
    expect(dto).toEqual({ resolution: "accepted", message: null, reason: null });
  });

  it("accepts when the world changed elsewhere but the target still resolves", () => {
    const changed = [...BOOTSTRAP, e("ff-1", "ForestFireStarted", 1, { startedAt: 1 }), e("t-1", "TickPassed", 1, { delta: 1 })];
    const dto = classify(changed, envelope(changed.length));
    expect(dto.resolution).toBe("accepted");
  });

  it("accepts with a base revision behind the current world", () => {
    const changed = [...BOOTSTRAP, e("ff-1", "ForestFireStarted", 1, { startedAt: 1 }), e("t-1", "TickPassed", 1, { delta: 1 })];
    const dto = classify(changed, envelope(BOOTSTRAP_REVISION));
    expect(dto.resolution).toBe("accepted");
  });

  it("rejects when the target never resolved anywhere", () => {
    const dto = classify(BOOTSTRAP, envelope(BOOTSTRAP_REVISION), inspect("nothing"));
    expect(dto).toEqual({
      resolution: "rejected",
      message: "Рядом нет такого объекта.",
      reason: "no_such_target",
    });
  });

  it("rejects when the base world never contained the target", () => {
    // Player moved away (so the target does not resolve now) and the base
    // revision predates the cart — inadmissible all along, not a conflict.
    const moved = [...BOOTSTRAP, e("m-1", "MovementSucceeded", 1, { x: 0, y: 2 }), e("t-1", "TickPassed", 1, { delta: 1 })];
    const dto = classify(moved, envelope(0, "examine cart"));
    expect(dto.resolution).toBe("rejected");
    expect(dto.reason).toBe("no_such_target");
  });

  it("rejects a base revision ahead of the world", () => {
    const dto = classify(BOOTSTRAP, envelope(BOOTSTRAP_REVISION + 3));
    expect(dto.resolution).toBe("rejected");
    expect(dto.reason).toBe("invalid_envelope");
  });

  it("rejects a negative base revision", () => {
    const dto = classify(BOOTSTRAP, envelope(-1));
    expect(dto.resolution).toBe("rejected");
    expect(dto.reason).toBe("invalid_envelope");
  });

  it("rejects intents outside the offline slice", () => {
    const take: InteractionCommand = {
      type: "InteractionCommand",
      verb: "take",
      target: { raw: "cart" },
      rawText: "взять телегу",
      interpretation: { source: "deterministic", confidence: 0.8, ambiguities: [] },
    };
    const dto = classify(BOOTSTRAP, envelope(BOOTSTRAP_REVISION), take);
    expect(dto.resolution).toBe("rejected");
    expect(dto.reason).toBe("unsupported_offline_intent");
  });

  it("classifies a vanished target as conflict, not rejection", () => {
    // Player saw the cart at the base revision, then moved out of reach.
    const moved = [...BOOTSTRAP, e("m-1", "MovementSucceeded", 1, { x: 0, y: 2 }), e("t-1", "TickPassed", 1, { delta: 1 })];
    const dto = classify(moved, envelope(BOOTSTRAP_REVISION));
    expect(dto).toEqual({
      resolution: "conflict",
      message: "Ты хотел осмотреть «cart», но теперь это невозможно.",
      reason: null,
    });
  });

  it("is deterministic for identical inputs", () => {
    const changed = [...BOOTSTRAP, e("m-1", "MovementSucceeded", 1, { x: 0, y: 2 }), e("t-1", "TickPassed", 1, { delta: 1 })];
    const a = classify(changed, envelope(BOOTSTRAP_REVISION));
    const b = classify(changed, envelope(BOOTSTRAP_REVISION));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns deeply frozen DTOs with no internal identifiers in player text", () => {
    const moved = [...BOOTSTRAP, e("m-1", "MovementSucceeded", 1, { x: 0, y: 2 }), e("t-1", "TickPassed", 1, { delta: 1 })];
    const dto = classify(moved, envelope(BOOTSTRAP_REVISION));
    expect(Object.isFrozen(dto)).toBe(true);
    const json = JSON.stringify(dto);
    expect(json).not.toContain("old-cart");
    expect(json).not.toContain("boot#");
    expect(json).not.toContain("MovementSucceeded");
  });
});
