/**
 * Contact profile (contact-identity T2).
 *
 * The author card travels on the existing `ObjectPlaced`/`ContactComponent`,
 * survives projection and replay, carries no hidden or origin fields, and an
 * old event without a profile replays without error.
 */

import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { WorldProjector, buildBootstrapEvents, buildGameShellSnapshot, buildMasterTurnSceneContext, rebuildProjection } from "@skald/world";

const KEEPER = "contact:waystation-keeper";

function profileFor(backgroundId: string | undefined) {
  const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId });
  const world = rebuildProjection(events).getSnapshot();
  return world.entities.get(KEEPER)?.components.contact?.profile;
}

describe("contact profile", () => {
  it("carries the stable author card on the contact component", () => {
    const profile = profileFor("wanderer");
    expect(profile).toBeDefined();
    expect(profile?.identityRef).toBe(KEEPER);
    expect(profile?.visibleAppearance.join(" ")).toMatch(/плащ|седина/i);
    expect(profile?.distinguishingFeatures.join(" ")).toMatch(/заплат/i);
    expect(profile?.publicRole).toMatch(/переправ/i);
    expect(profile?.addressForms).toContain("перевозчик");
    expect(Array.isArray(profile?.knownAs)).toBe(true);
  });

  it("never carries an unknown proper name in knownAs", () => {
    const profile = profileFor("wanderer");
    // The canonical name must not be exposed by default; acquaintance decides.
    expect(profile?.knownAs).not.toContain("Перевозчик у переправы");
  });

  it("does not leak hidden or origin fields into the profile", () => {
    const profile = profileFor("wanderer") as unknown as Record<string, unknown>;
    expect(profile).not.toHaveProperty("backgroundId");
    expect(profile).not.toHaveProperty("provenance");
    expect(profile).not.toHaveProperty("canonicalRefs");
    expect(profile).not.toHaveProperty("topics");
  });

  it("is deterministic for the same author data", () => {
    expect(profileFor("wanderer")).toEqual(profileFor(undefined));
    expect(profileFor("wanderer")).toEqual(profileFor("echo"));
  });

  it("survives a full projection rebuild and stays immutable", () => {
    const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" });
    const first = rebuildProjection(events).getSnapshot().entities.get(KEEPER)?.components.contact?.profile;
    const second = rebuildProjection(events).getSnapshot().entities.get(KEEPER)?.components.contact?.profile;
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.visibleAppearance)).toBe(true);
  });

  it("does not expose the profile through the master scene or the shell", () => {
    const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" });
    const world = rebuildProjection(events).getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world).context;
    const shell = buildGameShellSnapshot(events, world, null, "contact-boundary");
    const dump = JSON.stringify({ scene, shell });
    // Identity and the author card are internal: no read-side surface carries them.
    expect(dump).not.toContain("identityRef");
    expect(dump).not.toContain("visibleAppearance");
    expect(dump).not.toContain("distinguishingFeatures");
    expect(dump).not.toContain("publicRole");
  });

  it("replays an old contact event without a profile", () => {
    const legacy: DomainEvent = {
      eventId: "legacy-contact",
      type: "ObjectPlaced",
      schemaVersion: 1,
      payload: {
        entityId: "contact:legacy",
        x: 0,
        y: 0,
        name: "Старый знакомый",
        aliases: [],
        description: "",
        components: { contact: { locationId: "river_waystation", backgroundId: "wanderer" } },
      },
      timestamp: 0,
      correlationId: "legacy",
      causationId: null,
    };
    const projection = new WorldProjector();
    const bus = new EventBus();
    for (const event of [legacy]) { projection.apply(event); bus.append(event); }
    const contact = projection.getSnapshot().entities.get("contact:legacy")?.components.contact;
    expect(contact).toBeDefined();
    expect(contact?.profile).toBeUndefined();
    expect(contact?.locationId).toBe("river_waystation");
  });
});
