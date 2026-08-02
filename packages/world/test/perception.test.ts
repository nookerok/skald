import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildBootstrapEvents,
  handleCommand,
  interactionResolveTarget,
  interactionResolveLaw,
  perceptionObserve,
  type ReadonlyWorld,
} from "@skald/world";

function event(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

function towerWorld(events: readonly DomainEvent[] = buildBootstrapEvents("old_tower")): ReadonlyWorld {
  const projector = new WorldProjector();
  for (const e of events) projector.apply(e);
  return projector.getSnapshot();
}

describe("Slice 1 — perception law over WorldObject targets", () => {
  it("resolve_target resolves a location-scoped WorldObject by alias", () => {
    const out = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "inspect", object: "пепел" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "TargetResolved", payload: { entityId: "ash_pile", verb: "inspect" } });
  });

  it("resolve_law validates the perception law for an object target", () => {
    const out = interactionResolveLaw.handle(
      event("TargetResolved", "target-1", { entityId: "ash_pile", verb: "inspect" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "InteractionValidated",
      payload: { law: "perception", entityId: "ash_pile", verb: "inspect" },
    });
  });

  it("perception.observe emits ObjectObserved with the physical payload", () => {
    const out = perceptionObserve.handle(
      event("InteractionValidated", "law-1", { law: "perception", entityId: "ash_pile", verb: "inspect" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "ObjectObserved",
      payload: {
        objectId: "ash_pile",
        name: "Кучка пепла",
        material: "ash",
        temperature: 20,
        integrity: 100,
      },
    });
  });

  it("observe with a concrete object yields ObjectObserved, not surroundings", () => {
    const out = perceptionObserve.handle(
      event("InteractionValidated", "law-1", { law: "perception", entityId: "ash_pile", verb: "observe" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ObjectObserved", payload: { objectId: "ash_pile" } });
  });
});

describe("Slice 1 — observe without a target describes surroundings", () => {
  it("resolve_target resolves the environment", () => {
    const out = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "observe", object: "" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "TargetResolved",
      payload: { environment: true, locationId: "tower_approach", verb: "observe" },
    });
  });

  it("resolve_law validates the environment as a perception interaction", () => {
    const out = interactionResolveLaw.handle(
      event("TargetResolved", "target-1", { environment: true, locationId: "tower_approach", verb: "observe" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "InteractionValidated",
      payload: { law: "perception", locationId: "tower_approach", verb: "observe" },
    });
  });

  it("perception.observe describes the location for an environment observation", () => {
    const out = perceptionObserve.handle(
      event("InteractionValidated", "law-1", { law: "perception", locationId: "tower_approach", verb: "observe" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "ActionResolved",
      payload: {
        result: "observation",
        description: "Трава и камни у основания башни. Здесь стоит потухшая жаровня и кучка пепла.",
      },
    });
  });

  it("inspect without a target stays structurally rejected by the Command Handler", () => {
    const command = {
      type: "InteractionCommand" as const,
      verb: "inspect" as const,
      rawText: "examine",
      interpretation: { source: "deterministic" as const, confidence: 1, ambiguities: [] },
    };
    expect(handleCommand(command, "cmd-1", 1)).toMatchObject({
      type: "CommandRejected",
      payload: { reason: "missing interaction object" },
    });
  });

  it("Command Handler accepts observe without a named target", () => {
    const command = {
      type: "InteractionCommand" as const,
      verb: "observe" as const,
      rawText: "осмотреть",
      interpretation: { source: "deterministic" as const, confidence: 0.7, ambiguities: ["no clear target identified"] },
    };
    expect(handleCommand(command, "cmd-2", 2)).toMatchObject({
      type: "InteractionRequested",
      payload: { verb: "observe", object: "" },
    });
  });
});

describe("Slice 1 — full canonical chain end to end", () => {
  it("взять-пепел style inspect flows to ObjectObserved via the complete chain", () => {
    const world = towerWorld();
    const out = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "inspect", object: "пепел" }),
      world,
    );
    expect(out[0]?.type).toBe("TargetResolved");
    const resolved = out[0]!;
    const law = interactionResolveLaw.handle(resolved, world);
    expect(law[0]?.type).toBe("InteractionValidated");
    const facts = perceptionObserve.handle(law[0]!, world);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ type: "ObjectObserved", payload: { objectId: "ash_pile" } });
  });
});
