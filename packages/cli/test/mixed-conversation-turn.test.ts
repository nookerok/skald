import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  createRules,
  handleCommand,
} from "@skald/world";
import type { InteractionCommand } from "@skald/intent-parser";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";
import { buildMixedConversationTurn, isWorldChangingTurn } from "../src/conversation/builder.js";

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function campObject(id: string, name: string, state: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): DomainEvent {
  return campEvent("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [name], description: name, material: "wood",
    locationId: "camp", integrity: 100, temperature: 20, state, ...metadata,
  }, 0);
}

function bootCamp() {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const preEvents: DomainEvent[] = [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: ["torch"], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    campObject("torch", "факел", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
  ];
  for (const bootstrap of preEvents) {
    projection.apply(bootstrap);
    bus.append(bootstrap);
  }
  return { engine: new RuleEngine(createRules(), projection, bus), projection, preEvents };
}

function observeTorch(id: string, timestamp: number): DomainEvent {
  const command: InteractionCommand = {
    type: "InteractionCommand", verb: "observe", target: { raw: "факел" }, rawText: "осматриваю факел",
    interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
  };
  return handleCommand(command, id, timestamp);
}

describe("mixed conversation turns", () => {
  it("builds one combined turn from staged events and a post-action inquiry", () => {
    const { engine, projection, preEvents } = bootCamp();
    const staged = engine.process(observeTorch("cmd-1", 1)).committed;
    const projectedWorld = projection.getSnapshot();
    const draft = buildMixedConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-1",
      idempotencyKey: "mixed-1",
      playerText: "осматриваю факел, что я вижу?",
      worldTimeBefore: 0,
      preEvents,
      stagedEvents: staged,
      projectedWorld,
      profile: null,
      characterProfile: null,
      inquiry: { type: "InquiryRequest", queryId: "visible_scene", rawText: "что я вижу?", confidence: 1, source: "deterministic" },
      deferred: [{ text: "осмотреть лагерь", reason: "secondary_action" }],
    });

    expect(draft.inputClass).toBe("mixed");
    expect(draft.responseKind).toBe("mixed_outcome");
    expect(draft.playerText).toBe("осматриваю факел, что я вижу?");
    expect(draft.responseText).toContain("осмотреть лагерь");
    expect(draft.worldTimeAfter).toBe(projectedWorld.time);
    // Player text lives only in the draft, never in Domain Events.
    expect(JSON.stringify([...preEvents, ...staged])).not.toContain("осматриваю факел, что я вижу?");
  });

  it("commits events and the mixed turn atomically and survives reload", () => {
    const { engine, projection, preEvents } = bootCamp();
    const db = join(mkdtempSync(join(tmpdir(), "skald-mixed-turn-")), "events.sqlite");
    const staged = engine.process(observeTorch("cmd-2", 1)).committed;
    const projectedWorld = projection.getSnapshot();
    const draft = buildMixedConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-2",
      idempotencyKey: "mixed-2",
      playerText: "осматриваю факел, что я вижу?",
      worldTimeBefore: 0,
      preEvents,
      stagedEvents: staged,
      projectedWorld,
      profile: null,
      characterProfile: null,
      inquiry: { type: "InquiryRequest", queryId: "visible_scene", rawText: "что я вижу?", confidence: 1, source: "deterministic" },
      deferred: [],
    });

    const store = createMultiWorldStore(db);
    store.commitBatch(LEGACY_WORLD_ID, staged, { idempotencyKey: "mixed-2", requestKind: "command", correlationId: "cmd-2", conversationTurn: draft });
    const before = store.listConversationTurns(LEGACY_WORLD_ID);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ inputClass: "mixed", responseKind: "mixed_outcome" });
    const eventCount = store.loadEvents(LEGACY_WORLD_ID).length;
    expect(eventCount).toBeGreaterThan(0);
    store.close();

    const reopened = createMultiWorldStore(db);
    expect(reopened.listConversationTurns(LEGACY_WORLD_ID)).toEqual(before);
    expect(reopened.loadEvents(LEGACY_WORLD_ID)).toHaveLength(eventCount);
    reopened.close();
  });

  it("classifies world-changing turns for replay policy", () => {
    expect(isWorldChangingTurn("action")).toBe(true);
    expect(isWorldChangingTurn("mixed")).toBe(true);
    expect(isWorldChangingTurn("speech")).toBe(true);
    expect(isWorldChangingTurn("inquiry")).toBe(false);
    expect(isWorldChangingTurn("meta")).toBe(false);
    expect(isWorldChangingTurn("clarification")).toBe(false);
  });
});
