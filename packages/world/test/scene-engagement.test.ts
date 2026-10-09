/**
 * Scene engagement projection lifecycle (ADR-0039 §3, T5).
 *
 * Set by an additive `ActionResolved[approach]`, cleared by a location change
 * or a journey start, replay-stable, immutable, and never exposing an internal
 * ref through the observer-safe view.
 */

import { describe, expect, it } from "vitest";
import { rebuildProjection } from "../src/projection.js";
import { sceneEngagementView } from "../src/interactions/scene-engagement.js";
import { resolveProximity } from "../src/interactions/proximity.js";
import { buildGameShellSnapshot } from "../src/game-shell/builder.js";

function evt(type: string, eventId: string, payload: unknown, timestamp = 0): any {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

const base = [
  evt("PlayerSpawned", "p", { x: 0, y: 0 }),
  evt("LocationDefined", "l-hall", { id: "hall", name: "Зал", description: "hall", objectIds: [], connections: {} }),
  evt("PlayerLocationChanged", "pc", { locationId: "hall" }),
  evt("ObjectPlaced", "npc-1", {
    entityId: "npc-1",
    x: 1,
    y: 1,
    name: "Перевозчик",
    aliases: [],
    description: "Перевозчик.",
    components: { contact: { locationId: "hall", profile: { visibleAppearance: [], distinguishingFeatures: [], publicRole: "Перевозчик", knownAs: ["Перевозчик"], addressForms: ["Перевозчик"] } } },
  }),
];

const approachEvent = evt("ActionResolved", "ar-1", {
  actionEventId: "cmd-1",
  result: "approach",
  targetRef: "npc-1",
  locationId: "hall",
  engagement: "near",
  description: "Ты подходишь ближе.",
}, 2);

describe("scene engagement projection", () => {
  it("is set by an additive approach ActionResolved", () => {
    const world = rebuildProjection([...base, approachEvent]).getSnapshot();
    expect(world.sceneEngagement).toEqual({ targetRef: "npc-1", locationId: "hall", state: "near", establishedAt: 2 });
  });

  it("stays null for a legacy ActionResolved without the additive fields", () => {
    const legacy = evt("ActionResolved", "ar-legacy", { actionEventId: "cmd-1", result: "approach", description: "x" }, 2);
    const world = rebuildProjection([...base, legacy]).getSnapshot();
    expect(world.sceneEngagement).toBeNull();
  });

  it("is cleared by a location change", () => {
    const move = evt("PlayerLocationChanged", "pc-2", { locationId: "yard" }, 3);
    const yard = evt("LocationDefined", "l-yard", { id: "yard", name: "Двор", description: "y", objectIds: [], connections: {} }, 0);
    const world = rebuildProjection([...base, approachEvent, yard, move]).getSnapshot();
    expect(world.sceneEngagement).toBeNull();
  });

  it("is cleared by a journey start", () => {
    const journey = evt("JourneyStarted", "js-1", { journeyId: "j1", relationId: "r", fromLocationId: "hall", toLocationId: "yard", startedAt: 3, plannedTicks: 2 }, 3);
    const world = rebuildProjection([...base, approachEvent, journey]).getSnapshot();
    expect(world.sceneEngagement).toBeNull();
  });

  it("replays to the same state and is immutable", () => {
    const events = [...base, approachEvent];
    const first = rebuildProjection(events).getSnapshot();
    const second = rebuildProjection(events).getSnapshot();
    expect(second.sceneEngagement).toEqual(first.sceneEngagement);
    expect(Object.isFrozen(first.sceneEngagement)).toBe(true);
  });

  it("deepens near to engaged when an item is handed to the near target", () => {
    const give = evt("ItemPossessionChanged", "ip-1", { itemId: "x", previousOwnerId: "player", ownerId: "npc-1", subjectId: "player", reason: "given" }, 3);
    const world = rebuildProjection([...base, approachEvent, give]).getSnapshot();
    expect(world.sceneEngagement?.state).toBe("engaged");
  });

  it("a repeated approach refreshes the same state and keeps the establishment time", () => {
    const repeat = evt("ActionResolved", "ar-2", {
      actionEventId: "cmd-2",
      result: "approach",
      targetRef: "npc-1",
      locationId: "hall",
      engagement: "near",
      description: "Ты уже стоишь рядом.",
    }, 5);
    const world = rebuildProjection([...base, approachEvent, repeat]).getSnapshot();
    expect(world.sceneEngagement).toEqual({ targetRef: "npc-1", locationId: "hall", state: "near", establishedAt: 2 });
  });
});

describe("proximity resolver", () => {
  it("returns far/near/engaged for the engaged target only", () => {
    const nearWorld = rebuildProjection([...base, approachEvent]).getSnapshot();
    expect(resolveProximity(nearWorld, "npc-1")).toBe("near");
    expect(resolveProximity(nearWorld, "someone-else")).toBe("far");

    const give = evt("ItemPossessionChanged", "ip-x", { itemId: "x", previousOwnerId: "player", ownerId: "npc-1", subjectId: "player", reason: "given" }, 3);
    const engagedWorld = rebuildProjection([...base, approachEvent, give]).getSnapshot();
    expect(resolveProximity(engagedWorld, "npc-1")).toBe("engaged");
  });
});

describe("scene engagement observer-safe view", () => {
  it("gates an unknown contact's name", () => {
    const world = rebuildProjection([...base, approachEvent]).getSnapshot();
    expect(sceneEngagementView(world)).toEqual({ state: "near", label: "Незнакомый человек" });
  });

  it("shows the canonical name after acquaintance", () => {
    const known = evt("RelationChanged", "rel-1", { from: "player", to: "npc-1", kind: "knows", delta: 1 });
    const world = rebuildProjection([...base, known, approachEvent]).getSnapshot();
    expect(sceneEngagementView(world)).toEqual({ state: "near", label: "Перевозчик" });
  });

  it("returns null when there is no engagement", () => {
    const world = rebuildProjection(base).getSnapshot();
    expect(sceneEngagementView(world)).toBeNull();
  });

  it("returns null when the target cannot be named observer-safely", () => {
    const unknown = evt("ActionResolved", "ar-x", { actionEventId: "cmd-1", result: "approach", targetRef: "ghost", locationId: "hall", engagement: "near", description: "x" }, 2);
    const world = rebuildProjection([...base, unknown]).getSnapshot();
    expect(sceneEngagementView(world)).toBeNull();
  });
});

describe("scene engagement Game Shell DTO", () => {
  it("carries a ref-free sceneEngagement (name gated while unknown)", () => {
    const events = [...base, approachEvent];
    const world = rebuildProjection(events).getSnapshot();
    const shell = buildGameShellSnapshot(events, world, null, "world-se");
    expect(shell.sceneEngagement).toEqual({ state: "near", label: "Незнакомый человек" });
    const serialized = JSON.stringify(shell.sceneEngagement);
    expect(serialized).not.toMatch(/npc-1|locationId|targetRef|establishedAt/);
  });

  it("is null without an engagement", () => {
    const world = rebuildProjection(base).getSnapshot();
    const shell = buildGameShellSnapshot(base, world, null, "world-se");
    expect(shell.sceneEngagement).toBeNull();
  });
});
