/**
 * Scene presence semantics (full-master Stage 2), addressing path.
 *
 * Acquaintance is not presence. A contact named at the crossing must not be
 * addressable after the player travels to the city: the master must not place
 * him here, must name the absence instead of guessing, and the NPC must not
 * move with the player — asserted through the full command path, not only the
 * pure interpreter. The positive control keeps the same replica executable
 * while the player is still at the crossing.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  buildObserverGuidanceContext,
} from "@skald/world";
import { isGenericFallbackText } from "@skald/intent-parser";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import { interpretMasterTurn, type MasterTurnSnapshot } from "../src/runtime/master-turn-gateway.js";

const KEEPER = "contact:waystation-keeper";

function moveEvent(locationId: string, timestamp = 5): DomainEvent {
  return { eventId: "move-city", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId }, timestamp, correlationId: "move", causationId: null };
}

function bootstrapAt(locationId: string): readonly DomainEvent[] {
  return locationId === "riverwatch_city"
    ? [...buildBootstrapEvents("living_region"), moveEvent(locationId)]
    : buildBootstrapEvents("living_region");
}

function worldAt(locationId: string): MasterTurnSnapshot {
  const projection = new WorldProjector();
  const bus = new EventBus();
  for (const entry of bootstrapAt(locationId)) { projection.apply(entry); bus.append(entry); }
  const events = bus.query();
  const world = projection.getSnapshot();
  return { events, world, scene: buildMasterTurnSceneContext(events, world), conversation: buildMasterConversationContext([], "presence-addressing") };
}

function deadRouter() {
  return { apiKey: "", chat: () => { throw new Error("model down"); } } as never;
}

describe("scene presence — addressing a known-but-absent contact", () => {
  it("drops the ferryman from the master scene after the player leaves the crossing", () => {
    const snapshot = worldAt("riverwatch_city");
    const guidance = buildObserverGuidanceContext(snapshot.events, snapshot.world);
    expect(guidance.knownContacts.map((contact) => contact.id)).toContain(KEEPER);
    expect(guidance.presentContacts).toHaveLength(0);
    expect(snapshot.scene.context.knownPeople.map((person) => person.label)).not.toContain("Перевозчик у переправы");
  });

  it.each([
    "спрашиваю перевозчика о реке",
    "обратиться к перевозчику",
    "позвать перевозчика",
  ])("names the absence for «%s» instead of placing him here", async (input) => {
    const snapshot = worldAt("riverwatch_city");
    const result = await interpretMasterTurn(input, snapshot, deadRouter(), { timeoutMs: 50 });
    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(isGenericFallbackText(result.question)).toBe(false);
    expect(result.question).toContain("перевозчик");
    expect(result.question).not.toMatch(/рядом с тобой|перед тобой|здесь стоит/i);
  });

  it("still addresses the ferryman deterministically while the player is at the crossing", async () => {
    const snapshot = worldAt("river_waystation");
    expect(snapshot.scene.context.knownPeople.map((person) => person.label)).toContain("Перевозчик у переправы");
    const result = await interpretMasterTurn("обратиться к перевозчику", snapshot, deadRouter(), { timeoutMs: 50 });
    expect(result.status).toBe("deterministic");
    if (result.status !== "deterministic") return;
    expect(result.intent.type).toBe("ActionIntentCommand");
    if (result.intent.type !== "ActionIntentCommand") return;
    expect(result.intent.operation).toBe("speak");
    expect(result.intent.target?.raw).toBe("Перевозчик у переправы");
  });

  it("does not move the ferryman when the player addresses him from the city (full command path)", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-presence-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "presence-addressing";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Presence addressing",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "living_region",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: bootstrapAt("riverwatch_city"),
      });
      const throwing = { apiKey: "", chat: () => { throw new Error("model down"); } } as any;
      const runtime = await new WorldRuntimeManager(store, throwing).get(worldId);

      const before = runtime.projection.getSnapshot();
      expect(before.currentLocationId).toBe("riverwatch_city");
      expect(before.entities.get(KEEPER)?.components.contact?.locationId).toBe("river_waystation");
      const timeBefore = before.time;

      const response = await handleWorldCommand(runtime, { input: "позвать перевозчика", idempotencyKey: "presence-1" });
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.status).toBe("clarification");
      expect(isGenericFallbackText(body.question)).toBe(false);

      const after = runtime.projection.getSnapshot();
      // The action may not move the NPC with the player, and a clarification
      // never advances world time.
      expect(after.entities.get(KEEPER)?.components.contact?.locationId).toBe("river_waystation");
      expect(after.currentLocationId).toBe("riverwatch_city");
      expect(after.time).toBe(timeBefore);
    } finally {
      store.close();
    }
  });
});
