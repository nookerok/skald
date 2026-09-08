import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import { WorldProjector, createRules, handleCommand } from "@skald/world";
import type { ActionIntentCommand } from "@skald/intent-parser";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";
import { buildSpeechConversationTurn, isWorldChangingTurn } from "../src/conversation/builder.js";

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function bootCamp() {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const preEvents: DomainEvent[] = [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: [], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
  ];
  for (const bootstrap of preEvents) {
    projection.apply(bootstrap);
    bus.append(bootstrap);
  }
  return { engine: new RuleEngine(createRules(), projection, bus), projection, preEvents };
}

function speakCommand(id: string, timestamp: number): DomainEvent {
  const command: ActionIntentCommand = {
    type: "ActionIntentCommand",
    mode: "communicate",
    operation: "speak",
    utterance: "Приветствую всех у костра.",
    rawText: "Приветствую всех у костра.",
    interpretation: { source: "llm", confidence: 1, ambiguities: [] },
  };
  return handleCommand(command, id, timestamp);
}

describe("speech conversation turns", () => {
  it("builds a speech_reaction turn that never copies player text into events", () => {
    const { engine, projection } = bootCamp();
    const staged = engine.process(speakCommand("cmd-1", 1)).committed;
    expect(staged.length).toBeGreaterThan(0);
    const projectedWorld = projection.getSnapshot();
    const draft = buildSpeechConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-1",
      idempotencyKey: "speech-1",
      playerText: "Приветствую всех у костра.",
      worldTimeBefore: 0,
      stagedEvents: staged,
      projectedWorld,
    });

    expect(draft.inputClass).toBe("speech");
    expect(draft.responseKind).toBe("speech_reaction");
    expect(draft.playerText).toBe("Приветствую всех у костра.");
    expect(draft.responseText.length).toBeGreaterThan(0);
    expect(draft.worldTimeAfter).toBe(projectedWorld.time);
    expect(isWorldChangingTurn(draft.inputClass)).toBe(true);
    expect(JSON.stringify(staged)).not.toContain("Приветствую всех у костра.");
  });

  it("commits speech events and the turn atomically and survives reload", () => {
    const { engine, projection } = bootCamp();
    const db = join(mkdtempSync(join(tmpdir(), "skald-speech-turn-")), "events.sqlite");
    const staged = engine.process(speakCommand("cmd-2", 1)).committed;
    const projectedWorld = projection.getSnapshot();
    const draft = buildSpeechConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-2",
      idempotencyKey: "speech-2",
      playerText: "Приветствую всех у костра.",
      worldTimeBefore: 0,
      stagedEvents: staged,
      projectedWorld,
    });

    const store = createMultiWorldStore(db);
    store.commitBatch(LEGACY_WORLD_ID, staged, {
      idempotencyKey: "speech-2", requestKind: "command", correlationId: "cmd-2", conversationTurn: draft,
    });
    expect(store.getConversationTurn(LEGACY_WORLD_ID, "speech-2")?.responseKind).toBe("speech_reaction");
    store.close();

    const reopened = createMultiWorldStore(db);
    expect(reopened.getConversationTurn(LEGACY_WORLD_ID, "speech-2")?.playerText).toBe("Приветствую всех у костра.");
    reopened.close();
  });
});
