/**
 * Scene presence semantics (full-master Stage 2).
 *
 * Acquaintance is not presence: a contact named at the crossing must not
 * follow the player to the city. "Кто рядом?" answers from present contacts,
 * while "С кем я знаком?" answers from memory.
 */

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  buildBootstrapEvents,
  buildGameShellSnapshot,
  buildInquiryAnswer,
  buildMasterTurnSceneContext,
  buildObserverGuidanceContext,
  rebuildProjection,
} from "@skald/world";

const KEEPER = "contact:waystation-keeper";

function moveEvent(locationId: string, timestamp = 5): DomainEvent {
  return { eventId: "move-city", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId }, timestamp, correlationId: "move", causationId: null };
}

function atTheCity() {
  const events = [...buildBootstrapEvents("living_region"), moveEvent("riverwatch_city")];
  const world = rebuildProjection(events).getSnapshot();
  return { events, world };
}

describe("scene presence semantics", () => {
  it("knows the ferryman but does not place him in the city", () => {
    const { events, world } = atTheCity();
    const guidance = buildObserverGuidanceContext(events, world);

    expect(guidance.knownContacts.map((contact) => contact.id)).toContain(KEEPER);
    expect(guidance.presentContacts).toHaveLength(0);
  });

  it("excludes an absent contact from the master scene people", () => {
    const { events, world } = atTheCity();
    const scene = buildMasterTurnSceneContext(events, world).context;
    expect(scene.knownPeople.map((person) => person.label)).not.toContain("Перевозчик у переправы");
  });

  it("answers «кто рядом?» from presence and «с кем я знаком?» from memory", () => {
    const { events, world } = atTheCity();
    const scene = buildMasterTurnSceneContext(events, world).context;
    const shell = buildGameShellSnapshot(events, world, null, "presence-world");

    const nearby = buildInquiryAnswer(
      { type: "InquiryRequest", queryId: "who_is_nearby", rawText: "кто рядом?", confidence: 1, source: "deterministic" },
      { shell, background: null, scene },
    );
    expect(nearby.answer).not.toContain("Перевозчик");
    expect(nearby.answer).toMatch(/никого|никто/i);

    const known = buildInquiryAnswer(
      { type: "InquiryRequest", queryId: "known_contacts", rawText: "с кем я знаком?", confidence: 1, source: "deterministic" },
      { shell, background: null, scene },
    );
    expect(known.answer).toContain("Перевозчик");
  });

  it("keeps the ferryman present while the player is still at the crossing", () => {
    const events = buildBootstrapEvents("living_region");
    const world = rebuildProjection(events).getSnapshot();
    const guidance = buildObserverGuidanceContext(events, world);
    expect(guidance.presentContacts.map((contact) => contact.id)).toContain(KEEPER);
    const scene = buildMasterTurnSceneContext(events, world).context;
    expect(scene.knownPeople.map((person) => person.label)).toContain("Перевозчик у переправы");
  });
});
