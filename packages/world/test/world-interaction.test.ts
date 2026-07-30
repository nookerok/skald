import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { IntentCommand } from "@skald/intent-parser";
import {
  WorldProjector,
  bootstrapWorldEvents,
  handleCommand,
  interactionResolveLaw,
  interactionResolveTarget,
  perceptionExamine,
  examinedCuriosity,
  resolveInteractionLaw,
  formatEvent,
  type ReadonlyWorld,
} from "@skald/world";

function event(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

function world(): ReadonlyWorld {
  const projector = new WorldProjector();
  for (const bootstrap of bootstrapWorldEvents()) projector.apply(bootstrap);
  return projector.getSnapshot();
}

describe("World Interaction Model ? examine/perception", () => {
  it("entities snapshot is runtime-immutable and detached from Projection", () => {
    const snapshot = world();
    const entity = snapshot.entities.get("old-cart");
    expect(entity).toBeDefined();
    expect(() => (snapshot.entities as Map<string, unknown>).set("other", {})).toThrow("immutable");
    expect(() => ((entity!.components.physical as { intact: boolean }).intact = true)).toThrow();
    expect(snapshot.entities.get("old-cart")?.components.physical?.intact).toBe(false);
  });

  it("resolve_target finds a nearby entity by alias", () => {
    const out = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "examine", object: "cart" }),
      world(),
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "TargetResolved", payload: { entityId: "old-cart", verb: "examine" } });
  });

  it("resolve_target rejects a missing target", () => {
    const out = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "examine", object: "lantern" }),
      world(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ActionRejected", payload: { reason: "no_such_target" } });
  });

  it("resolve_law validates the registered examine/perception law", () => {
    const out = interactionResolveLaw.handle(
      event("TargetResolved", "target-1", { entityId: "old-cart", verb: "examine" }),
      world(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "InteractionValidated",
      payload: { law: "perception", entityId: "old-cart", verb: "examine" },
    });
  });

  it("resolve_law rejects an entity that lacks a required component", () => {
    const out = resolveInteractionLaw(
      event("TargetResolved", "target-1", { entityId: "old-cart", verb: "examine" }),
      world(),
      () => ({ verb: "examine", law: "perception", requiredComponents: ["thermal"] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ActionRejected", payload: { reason: "not_applicable" } });
  });

  it("perception.examine emits the factual EntityExamined outcome", () => {
    const out = perceptionExamine.handle(
      event("InteractionValidated", "law-1", { law: "perception", entityId: "old-cart", verb: "examine" }),
      world(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "EntityExamined",
      payload: {
        entityId: "old-cart",
        name: "old cart",
        description: "A weathered wooden cart rests on one broken wheel.",
      },
    });
  });

  it("EntityExamined creates one curiosity observation in a separate consequence rule", () => {
    const out = examinedCuriosity.handle(
      event("EntityExamined", "examined-1", { entityId: "old-cart", name: "old cart", description: "x" }),
      world(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ObservationUpdated", payload: { key: "curiosity", delta: 1 } });
  });

  it("Command Handler structurally accepts examine and rejects an unknown verb", () => {
    const known: IntentCommand = { type: "IntentCommand", verb: "examine", object: "cart" };
    const unknown: IntentCommand = { type: "IntentCommand", verb: "juggle", object: "cart" };

    expect(handleCommand(known, "cmd-1", 1)).toMatchObject({
      type: "InteractionRequested", payload: { verb: "examine", object: "cart" },
    });
    expect(handleCommand(unknown, "cmd-2", 2)).toMatchObject({
      type: "CommandRejected", payload: { reason: "unknown interaction verb: juggle" },
    });
  });

  it("EntityExamined narrative is deterministic and reads only payload", () => {
    const examined = event("EntityExamined", "examined-1", {
      entityId: "old-cart", name: "old cart", description: "A weathered wooden cart rests on one broken wheel.",
    });
    const first = formatEvent(examined);
    const second = formatEvent(examined);
    expect(first?.text).toBe("\u0422\u044b \u0440\u0430\u0441\u0441\u043c\u0430\u0442\u0440\u0438\u0432\u0430\u0435\u0448\u044c old cart. A weathered wooden cart rests on one broken wheel.");
    expect(second).toEqual(first);
  });
});
