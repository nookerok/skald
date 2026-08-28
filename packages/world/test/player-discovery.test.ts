import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { buildDiscoveryJournal } from "../src/discovery/builder.js";
import { toPlayerDiscoveryJournal } from "../src/discovery/player-facing.js";

function event(type: string, eventId: string, timestamp: number, payload: Record<string, unknown>): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "discovery-" + timestamp, causationId: null };
}

describe("PlayerDiscoveryJournal", () => {
  it("removes provenance/internal fields and localizes legacy discovery text", () => {
    const journal = buildDiscoveryJournal([
      event("ObjectTemperatureChanged", "heat-visible", 3, { temperature: 80, objectId: "iron-plate" }),
      event("RumorHeard", "rumor-foreign", 4, { observerId: "npc", text: "Чужой слух", sourceLabel: "npc-17" }),
      event("RumorHeard", "rumor-player", 5, { observerId: "player", text: "The river remembers.", sourceLabel: "keeper-archive" }),
    ]);
    const player = toPlayerDiscoveryJournal(journal);
    const serialized = JSON.stringify(player);

    expect(player.schemaVersion).toBe(1);
    expect(player.rumors).toHaveLength(1);
    expect(serialized).not.toMatch(/sourceEventIds|journalTurnId|subjectRef|observerId|confidence|freshness|heat_changes_material|iron-plate|keeper-archive|npc-17/);
    const playerText = [
      ...player.cards.flatMap((card) => [card.title, card.question, card.summary, ...card.evidence.map((entry) => entry.text)]),
      ...player.rumors.flatMap((rumor) => [rumor.text, rumor.sourceLabel]),
    ].join(" ");
    expect(playerText).not.toMatch(/[A-Za-z]{4,}/);
    expect(serialized).toContain("Тепло меняет свойства материалов");
    expect(serialized).toContain("Тебе передали слух, который ещё нужно проверить.");
    expect(Object.isFrozen(player)).toBe(true);
    expect(Object.isFrozen(player.cards)).toBe(true);
  });
});
