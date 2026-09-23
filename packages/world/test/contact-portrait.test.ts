/**
 * Observer portrait (contact-identity T3).
 *
 * Presence is not acquaintance. A present, known contact carries the
 * observer-safe portrait and the name; an unknown but present person stays
 * describable through the portrait while the name is withheld.
 */

import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  rebuildProjection,
} from "@skald/world";

function sceneFor(events: readonly DomainEvent[]) {
  const world = rebuildProjection(events).getSnapshot();
  return buildMasterTurnSceneContext(events, world).context;
}

function unknownPresentWorld(): { events: readonly DomainEvent[] } {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const log: DomainEvent[] = [
    { eventId: "loc", type: "LocationDefined", schemaVersion: 1, payload: { id: "camp", name: "Лагерь", description: "", objectIds: [], connections: {} }, timestamp: 0, correlationId: "c", causationId: null },
    { eventId: "pos", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId: "camp" }, timestamp: 0, correlationId: "c", causationId: null },
    {
      eventId: "stranger",
      type: "ObjectPlaced",
      schemaVersion: 1,
      payload: {
        entityId: "contact:stranger",
        x: 0,
        y: 0,
        name: "Бродяга",
        aliases: [],
        description: "",
        components: {
          contact: {
            locationId: "camp",
            profile: { identityRef: "contact:stranger", visibleAppearance: ["в рваном плаще"], distinguishingFeatures: ["хромота"], publicRole: "просит подаяние", knownAs: [], addressForms: ["бродяга"] },
          },
        },
      },
      timestamp: 0,
      correlationId: "c",
      causationId: null,
    },
  ];
  for (const event of log) { projection.apply(event); bus.append(event); }
  return { events: bus.query() };
}

describe("observer portrait", () => {
  it("gives a present, known contact the name and the portrait", () => {
    const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" });
    const scene = sceneFor(events);
    const keeper = scene.knownPeople.find((person) => person.label === "Перевозчик у переправы");
    expect(keeper).toBeDefined();
    expect(keeper?.known).toBe(true);
    expect(keeper?.knownAs).toContain("Перевозчик у переправы");
    expect(keeper?.portrait?.visibleAppearance.join(" ")).toMatch(/плащ|седина/i);
    expect(keeper?.portrait?.publicRole).toMatch(/переправ/i);
  });

  it("describes an unknown but present person without their name", () => {
    const scene = sceneFor(unknownPresentWorld().events);
    const stranger = scene.knownPeople.find((person) => person.known === false);
    expect(stranger).toBeDefined();
    expect(stranger?.label).toBe("Незнакомый человек");
    expect(stranger?.knownAs).toEqual([]);
    expect(stranger?.portrait?.visibleAppearance.join(" ")).toMatch(/плащ/i);
    expect(stranger?.portrait?.addressForms).toContain("бродяга");
    // The proper name never leaks for an unknown person.
    expect(JSON.stringify(scene.knownPeople)).not.toContain("Бродяга");
  });

  it("does not place an absent contact in the scene", () => {
    const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "riverwatch_city_arrival", backgroundId: "wanderer" });
    const scene = sceneFor(events);
    expect(scene.knownPeople.map((person) => person.label)).not.toContain("Перевозчик у переправы");
  });
});
