import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildBootstrapEvents,
  handleCommand,
  interactionResolveTarget,
  interactionResolveLaw,
  listeningListen,
  authoredWaystationRumor,
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

function heatedTowerWorld(): ReadonlyWorld {
  return towerWorld([
    ...buildBootstrapEvents("old_tower"),
    {
      eventId: "heat-1",
      type: "ObjectTemperatureChanged",
      schemaVersion: 1,
      payload: { objectId: "extinguished_brazier", name: "Потухшая жаровня", previousTemperature: 40, temperature: 70 },
      timestamp: 1,
      correlationId: "cmd-1",
      causationId: null,
    },
  ]);
}

describe("Slice 2 — listening law: environment", () => {
  it("resolve_target resolves listen without a target to the environment", () => {
    const out = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "listen", object: "" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "TargetResolved",
      payload: { environment: true, locationId: "tower_approach", verb: "listen" },
    });
  });

  it("resolve_law validates the environment as a listening interaction", () => {
    const out = interactionResolveLaw.handle(
      event("TargetResolved", "target-1", { environment: true, locationId: "tower_approach", verb: "listen" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "InteractionValidated",
      payload: { law: "listening", locationId: "tower_approach", verb: "listen" },
    });
  });

  it("silent surroundings yield ActionHadNoObservableEffect, not a guess", () => {
    const out = listeningListen.handle(
      event("InteractionValidated", "law-1", { law: "listening", locationId: "tower_approach", verb: "listen" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ActionHadNoObservableEffect", payload: { reason: "silence" } });
  });

  it("a hot object in the location is audible with quiet loudness", () => {
    const out = listeningListen.handle(
      event("InteractionValidated", "law-1", { law: "listening", locationId: "tower_approach", verb: "listen" }),
      heatedTowerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "SoundObserved",
      payload: {
        sourceId: "ambient",
        source: "окружение",
        loudness: "quiet",
        distance: null,
        distanceBand: "same_location",
        locationId: "tower_approach",
      },
    });
  });

  it("ignores a non-listening law", () => {
    const out = listeningListen.handle(
      event("InteractionValidated", "law-1", { law: "perception", entityId: "ash_pile", verb: "inspect" }),
      towerWorld(),
    );
    expect(out).toEqual([]);
  });
});

describe("Slice 2 — listening law: concrete targets", () => {
  it("a hot object target is audible in observer scope", () => {
    const out = listeningListen.handle(
      event("InteractionValidated", "law-1", { law: "listening", entityId: "extinguished_brazier", verb: "listen" }),
      heatedTowerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "SoundObserved",
      payload: { sourceId: "extinguished_brazier", distance: null, loudness: "quiet" },
    });
  });

  it("a cold object target is honest silence", () => {
    const out = listeningListen.handle(
      event("InteractionValidated", "law-1", { law: "listening", entityId: "ash_pile", verb: "listen" }),
      towerWorld(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ActionHadNoObservableEffect", payload: { reason: "silent_target" } });
  });

  it("a grid entity target without heat is honest silence", () => {
    const events = [...buildBootstrapEvents("old_tower"), {
      eventId: "obj-1",
      type: "ObjectPlaced",
      schemaVersion: 1,
      payload: {
        entityId: "hot_iron",
        x: 0,
        y: 1,
        name: "hot iron",
        aliases: [],
        description: "A glowing piece of iron.",
        components: { thermal: { temperature: 95 } },
      },
      timestamp: 1,
      correlationId: "c",
      causationId: null,
    }];
    const world = towerWorld(events);
    const silent = listeningListen.handle(
      event("InteractionValidated", "law-1", { law: "listening", entityId: "old-cart", verb: "listen" }),
      world,
    );
    expect(silent[0]).toMatchObject({ type: "ActionHadNoObservableEffect", payload: { reason: "silent_target" } });

    const audible = listeningListen.handle(
      event("InteractionValidated", "law-2", { law: "listening", entityId: "hot_iron", verb: "listen" }),
      world,
    );
    expect(audible[0]).toMatchObject({
      type: "SoundObserved",
      payload: { sourceId: "hot_iron", loudness: "quiet", distance: 1 },
    });
  });
});

describe("Slice 2 — Command Handler and full chain", () => {
  it("Command Handler accepts listen without a named target", () => {
    const command = {
      type: "InteractionCommand" as const,
      verb: "listen" as const,
      rawText: "прислушаться",
      interpretation: { source: "deterministic" as const, confidence: 0.7, ambiguities: [] },
    };
    expect(handleCommand(command, "cmd-2", 2)).toMatchObject({
      type: "InteractionRequested",
      payload: { verb: "listen", object: "" },
    });
  });

  it("the full canonical chain ends in honest silence for a quiet world", () => {
    const world = towerWorld();
    const gate = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "listen", object: "" }),
      world,
    );
    expect(gate[0]?.type).toBe("TargetResolved");
    const law = interactionResolveLaw.handle(gate[0]!, world);
    expect(law[0]?.type).toBe("InteractionValidated");
    const facts = listeningListen.handle(law[0]!, world);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ type: "ActionHadNoObservableEffect", payload: { reason: "silence" } });
  });

  it("the full canonical chain ends in SoundObserved after heating", () => {
    const world = heatedTowerWorld();
    const gate = interactionResolveTarget.handle(
      event("InteractionTimeValidated", "time-1", { verb: "listen", object: "" }),
      world,
    );
    const law = interactionResolveLaw.handle(gate[0]!, world);
    const facts = listeningListen.handle(law[0]!, world);
    expect(facts[0]).toMatchObject({ type: "SoundObserved", payload: { sourceId: "ambient", source: "окружение", distanceBand: "same_location" } });
  });
});

describe("authored waystation rumor", () => {
  it("emits scoped social evidence without coordinates", () => {
    const out = authoredWaystationRumor.handle(
      event("InteractionValidated", "law-rumor", { law: "listening", verb: "listen", locationId: "river_waystation" }),
      towerWorld(),
    );
    expect(out).toMatchObject([{
      type: "RumorHeard",
      payload: { rumorRef: "rumor:old-course", subjectRef: "old_ruins", source: "social", observerId: "player" },
    }]);
    expect((out[0]?.payload as Record<string, unknown> | undefined)?.text).not.toMatch(/coordinates|xMetres|yMetres/i);
  });
});