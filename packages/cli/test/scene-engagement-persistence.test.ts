/**
 * Scene engagement persistence + replay through the real SQLite store
 * (ADR-0039 §3, T5). Proves the derived state survives a restart, not only a
 * pure in-memory Projection.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, rebuildProjection } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";

function evt(type: string, eventId: string, payload: unknown): any {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 0, correlationId: "boot", causationId: null };
}

describe("scene engagement persistence (T5)", () => {
  it("survives a store restart and replays identically", () => {
    const db = join(mkdtempSync(join(tmpdir(), "skald-se-persist-")), "events.sqlite");
    const worldId = "se-persist";
    const bootstrap = buildBootstrapEvents("living_region");
    const bootWorld = rebuildProjection(bootstrap).getSnapshot();
    const locationId = bootWorld.currentLocationId;

    const contact = evt("ObjectPlaced", "se-npc", {
      entityId: "se-npc",
      x: 1,
      y: 1,
      name: "Тестовый контакт",
      aliases: [],
      description: "Контакт.",
      components: { contact: { locationId, profile: { visibleAppearance: [], distinguishingFeatures: [], publicRole: "Контакт", knownAs: ["Контакт"], addressForms: ["Контакт"] } } },
    });
    const approach = evt("ActionResolved", "se-approach", {
      actionEventId: "cmd-1",
      result: "approach",
      targetRef: "se-npc",
      locationId,
      engagement: "near",
      description: "Ты подходишь ближе.",
    });

    const store = createMultiWorldStore(db);
    store.createWorld({
      worldId,
      idempotencyKey: "create-se",
      requestHash: "hash-se",
      saveLabel: "Scene engagement",
      characterName: "Tester",
      characterPresetId: "wanderer",
      worldTemplateId: "living_region",
      characterWound: "none",
      characterPromise: "observe",
      characterPrinciple: "care",
      characterProfileVersion: 1,
      bootstrapEvents: [...bootstrap, contact, approach],
    });
    store.close();

    const reopened = createMultiWorldStore(db);
    try {
      const events = reopened.loadEvents(worldId);
      const world = rebuildProjection(events).getSnapshot();
      expect(world.sceneEngagement).toEqual({ targetRef: "se-npc", locationId, state: "near", establishedAt: 0 });
    } finally {
      reopened.close();
    }
  });
});
