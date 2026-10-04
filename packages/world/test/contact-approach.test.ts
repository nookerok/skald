/**
 * Contact approach — single outcome owner (npc-close-approach phase 1,
 * ADR-0013 amendment).
 *
 * One `relocate + approach` action yields EXACTLY ONE owner:
 * present contact → contactApproach's ActionResolved; a contact of another
 * location (or a mid-flight ambiguity) → its ActionBlocked
 * (contact_unavailable) — never the passage wording; connections and
 * non-contact targets → the movement rule, unchanged.
 */

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { WorldProjector, buildBootstrapEvents, type ReadonlyWorld } from "@skald/world";
import { contactApproach } from "../src/rules/interactions/contact-approach.js";
import { interactionMovement } from "../src/rules/interaction.js";

function event(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

function worldOf(events: readonly DomainEvent[]): ReadonlyWorld {
  const projector = new WorldProjector();
  for (const e of events) projector.apply(e);
  return projector.getSnapshot();
}

/** Waystation start: the ferryman is a present contact at the spawn location. */
function waystation(): ReadonlyWorld {
  return worldOf(buildBootstrapEvents("living_region"));
}

/** Southern start: the warden is here, the ferryman belongs to the waystation. */
function southern(): ReadonlyWorld {
  return worldOf(buildBootstrapEvents({ templateId: "living_region", entrypointId: "southern_borough_arrival", backgroundId: "wanderer" }));
}

function validated(target: unknown, operation = "approach"): DomainEvent {
  return event("ActionValidated", "av-1", { originalPayload: { mode: "relocate", operation, target } });
}

/** A canon-style contact placed by event, for the ambiguity case. */
function trader(eventId: string, x: number): DomainEvent {
  return event("ObjectPlaced", eventId, {
    entityId: eventId,
    x,
    y: 1,
    name: "Торговец",
    aliases: [],
    description: "Торговец с лотком.",
    components: {
      contact: {
        locationId: "river_waystation",
        profile: {
          visibleAppearance: ["Зелёный кафтан"],
          distinguishingFeatures: [],
          publicRole: "Торговец",
          knownAs: ["Торговец"],
          addressForms: ["Торговец"],
        },
      },
    },
  });
}

describe("contact approach — single outcome owner (npc-close-approach phase 1)", () => {
  it("a present contact yields exactly one ActionResolved with the outcome text", () => {
    const target = { raw: "перевозчику" };
    const out = contactApproach.handle(validated(target), waystation());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "ActionResolved",
      payload: {
        result: "approach",
        description: "Ты подходишь ближе. Перед тобой — Перевозчик у переправы.",
      },
    });
    // Single owner: movement excludes the contact case — no second outcome.
    expect(interactionMovement.handle(validated(target), waystation())).toEqual([]);
  });

  it("carries additive engagement fields and a repeated approach stays meaningful", () => {
    const target = { raw: "перевозчику" };
    const first = contactApproach.handle(validated(target), waystation());
    const payload = first[0]!.payload as Record<string, unknown>;
    // Additive fields (ADR-0039 §3): projection derives engagement from them.
    expect(payload["result"]).toBe("approach");
    expect(payload["engagement"]).toBe("near");
    expect(payload["locationId"]).toBe("river_waystation");
    expect(typeof payload["targetRef"]).toBe("string");
    expect((payload["targetRef"] as string).length).toBeGreaterThan(0);

    // A second approach to the same present target refreshes the SAME state
    // and answers without inventing a new proximity.
    const ferry = [...waystation().entities.values()].find((e) => e.name === "Перевозчик у переправы")!;
    const engaged = worldOf([
      ...buildBootstrapEvents("living_region"),
      event("ActionResolved", "ar-engaged", {
        actionEventId: "cmd-1",
        result: "approach",
        targetRef: ferry.id,
        locationId: "river_waystation",
        engagement: "near",
        description: "x",
      }, 2),
    ]);
    const again = contactApproach.handle(validated(target), engaged);
    expect(again[0]).toMatchObject({
      type: "ActionResolved",
      payload: { result: "approach", description: "Ты уже стоишь рядом с Перевозчик у переправы." },
    });
  });

  it("a contact of another location reports absence, never passage", () => {
    const w = southern();
    const out = contactApproach.handle(validated("перевозчику"), w);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "ActionBlocked",
      payload: { reason: "contact_unavailable", objectName: "перевозчику" },
    });
    expect(interactionMovement.handle(validated("перевозчику"), w)).toEqual([]);
  });

  it("a name that matches no contact anywhere stays with the movement rule", () => {
    const w = waystation();
    expect(contactApproach.handle(validated("фонарю"), w)).toEqual([]);
    const move = interactionMovement.handle(validated("фонарю"), w);
    expect(move).toHaveLength(1);
    expect(move[0]).toMatchObject({ type: "ActionBlocked", payload: { reason: "no_passage" } });
  });

  it("a location connection stays with the movement rule", () => {
    const w = worldOf(buildBootstrapEvents("old_tower"));
    expect(contactApproach.handle(validated("tower_entrance"), w)).toEqual([]);
    const move = interactionMovement.handle(validated("tower_entrance"), w);
    expect(move.map((entry) => entry.type)).toEqual(["PlayerLocationChanged", "ActionResolved"]);
  });

  it("two same-name present contacts are never resolved by loop order", () => {
    const w = worldOf([...buildBootstrapEvents("living_region"), trader("t1", 1), trader("t2", 3)]);
    const out = contactApproach.handle(validated({ raw: "торговец" }), w);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "ActionBlocked",
      payload: { reason: "contact_unavailable" },
    });
    expect(interactionMovement.handle(validated({ raw: "торговец" }), w)).toEqual([]);
  });

  it("non-approach operations never reach the contact rule", () => {
    expect(contactApproach.handle(validated("перевозчику", "enter"), waystation())).toEqual([]);
    expect(contactApproach.handle(
      event("ActionValidated", "av-2", { originalPayload: { mode: "interact", operation: "approach", target: { raw: "перевозчику" } } }),
      waystation(),
    )).toEqual([]);
  });
});
