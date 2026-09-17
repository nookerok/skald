import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DomainEvent } from "@skald/event-bus";
import { buildDiscoveryJournal } from "../src/discovery/builder.js";
import { toPlayerDiscoveryJournal } from "../src/discovery/player-facing.js";
import type { DiscoveryJournal } from "../src/discovery/types.js";

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

  it("renders every compiled region discovery in Russian, never the generic fallback", () => {
    const bundle = JSON.parse(readFileSync(
      resolve(process.cwd(), "packages/world/src/region/compiled/pilot-region.v6.json"), "utf8",
    )) as { discoveryDefinitions: { id: string; title: string; question: string }[] };
    expect(bundle.discoveryDefinitions.length).toBeGreaterThan(0);
    for (const definition of bundle.discoveryDefinitions) {
      const journal: DiscoveryJournal = {
        cards: [{
          discoveryId: definition.id,
          definitionVersion: 1,
          title: definition.title,
          question: definition.question,
          stage: "hypothesis",
          summary: "Placeholder summary.",
          firstSeenAt: 1,
          lastSeenAt: 2,
          evidenceCount: 1,
          evidence: [{
            evidenceId: `${definition.id}:ev:1`,
            kind: "physical_trace",
            subjectRef: "old_ruins",
            worldTime: 2,
            text: "Placeholder evidence.",
            sourceEventIds: ["e-1"],
            journalTurnId: "turn:2",
            confidence: 0.8,
            freshness: 1,
            source: "direct_observation",
            locationRef: null,
            bearing: null,
            contradictionGroup: null,
          }],
        }],
        recentEvidence: [],
        rumors: [],
        biographyChains: [],
        worldTime: 2,
      };
      const player = toPlayerDiscoveryJournal(journal);
      expect(player.cards).toHaveLength(1);
      const card = player.cards[0]!;
      expect(card.title).not.toBe("Наблюдаемая закономерность.");
      expect(`${card.title} ${card.question} ${card.summary}`).not.toMatch(/[A-Za-z]{4,}/);
    }
  });

  it("keeps distinct water findings on distinct cards", () => {
    const waterCard = (discoveryId: string, title: string): DiscoveryJournal["cards"][number] => ({
      discoveryId,
      definitionVersion: 1,
      title,
      question: "Почему?",
      stage: "hypothesis",
      summary: "Вода ведёт себя необычно.",
      firstSeenAt: 1,
      lastSeenAt: 2,
      evidenceCount: 1,
      evidence: [],
    });
    const journal: DiscoveryJournal = {
      cards: [waterCard("river_cycle", "Вода меняется"), waterCard("river_course_shift", "Река помнит другое русло")],
      recentEvidence: [],
      rumors: [],
      biographyChains: [],
      worldTime: 2,
    };
    const player = toPlayerDiscoveryJournal(journal);
    expect(player.cards.map((card) => card.title).sort()).toEqual(["Вода меняется", "Река помнит другое русло"]);
  });
});
