import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { InteractionCommand } from "@skald/intent-parser";
import {
  WorldProjector,
  bootstrapWorldEvents,
  handleCommand,
  interactionResolveLaw,
  interactionResolveTarget,
  perceptionObserve,
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

describe("World Interaction Model — inspect/perception", () => {
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
      event("InteractionTimeValidated", "time-1", { verb: "inspect", object: "cart" }),
      world(),
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "TargetResolved", payload: { entityId: "old-cart", verb: "inspect" } });
  });

  it("resolve_target rejects a missing target", () => {
    const out = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "inspect", object: "lantern" }),
      world(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ActionRejected", payload: { reason: "no_such_target" } });
  });

  it("resolve_law validates the registered inspect/perception law", () => {
    const out = interactionResolveLaw.handle(
      event("TargetResolved", "target-1", { entityId: "old-cart", verb: "inspect" }),
      world(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "InteractionValidated",
      payload: { law: "perception", entityId: "old-cart", verb: "inspect" },
    });
  });

  it("resolve_law rejects an entity that lacks a required component", () => {
    const out = resolveInteractionLaw(
      event("TargetResolved", "target-1", { entityId: "old-cart", verb: "inspect" }),
      world(),
      () => ({ verb: "inspect", law: "perception", requiredComponents: ["thermal"] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ActionRejected", payload: { reason: "not_applicable" } });
  });

  it("perception.observe emits the factual EntityExamined outcome", () => {
    const out = perceptionObserve.handle(
      event("InteractionValidated", "law-1", { law: "perception", entityId: "old-cart", verb: "inspect" }),
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

  it("perception.observe ignores a non-perception law", () => {
    const out = perceptionObserve.handle(
      event("InteractionValidated", "law-1", { law: "heat", entityId: "old-cart", verb: "inspect" }),
      world(),
    );
    expect(out).toEqual([]);
  });

  it("EntityExamined creates one curiosity observation in a separate consequence rule", () => {
    const out = examinedCuriosity.handle(
      event("EntityExamined", "examined-1", { entityId: "old-cart", name: "old cart", description: "x" }),
      world(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ObservationUpdated", payload: { key: "curiosity", delta: 1 } });
  });

  it("Command Handler structurally accepts inspect and rejects an unknown verb", () => {
    const known: InteractionCommand = {
      type: "InteractionCommand",
      verb: "inspect",
      target: { raw: "cart" },
      rawText: "examine cart",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    const unknown: InteractionCommand = {
      type: "InteractionCommand",
      verb: "close",
      target: { raw: "cart" },
      rawText: "взять телегу",
      interpretation: { source: "deterministic", confidence: 0.8, ambiguities: [] },
    };

    expect(handleCommand(known, "cmd-1", 1)).toMatchObject({
      type: "InteractionRequested", payload: { verb: "inspect", object: "cart" },
    });
    expect(handleCommand(unknown, "cmd-2", 2)).toMatchObject({
      type: "InteractionRequested", payload: { verb: "close", object: "cart" },
    });
  });

  it("Command Handler rejects a missing interaction object", () => {
    const command: InteractionCommand = {
      type: "InteractionCommand",
      verb: "inspect",
      rawText: "examine",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: ["no clear target identified"] },
    };
    expect(handleCommand(command, "cmd-3", 3)).toMatchObject({
      type: "CommandRejected", payload: { reason: "missing interaction object" },
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
