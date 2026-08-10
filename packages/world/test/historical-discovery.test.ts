import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { buildDiscoveryJournal } from "@skald/world";

function observation(eventId: string, timestamp: number, subjectId = "old_ruins", evidenceRole?: "support" | "contradiction"): DomainEvent {
  return {
    eventId,
    type: "SpatialObservationRecorded",
    schemaVersion: 1,
    payload: {
      subjectKind: "location",
      subjectId,
      knowledge: "observed",
      observedAt: timestamp,
      confidence: 0.8,
      evidenceRole,
    },
    timestamp,
    correlationId: "history",
    causationId: null,
  } as DomainEvent;
}

describe("historical discovery resolution", () => {
  it("requires independent observations before supporting a historical hypothesis", () => {
    const journal = buildDiscoveryJournal([observation("one", 1), observation("two", 2)]);
    const card = journal.cards.find((entry) => entry.discoveryId === "ancient_culture_traces");
    expect(card?.stage).toBe("hypothesis");
    expect(card?.resolution).toBe("supported");
  });

  it("exposes conflict and climate discovery nodes as unresolved questions", () => {
    const journal = buildDiscoveryJournal([
      observation("conflict-one", 1, "old_ruins"),
      observation("climate-one", 1, "blackwood_edge"),
      observation("conflict-two", 2, "old_ruins"),
      observation("climate-two", 2, "blackwood_edge"),
    ]);
    expect(journal.cards.find((entry) => entry.discoveryId === "conflict_trace")?.resolution).toBe("supported");
    expect(journal.cards.find((entry) => entry.discoveryId === "climate_shift")?.resolution).toBe("supported");
  });

  it("keeps contradiction evidence and resolves a hypothesis as contradicted", () => {
    const journal = buildDiscoveryJournal([observation("one", 1, "old_ruins", "contradiction"), observation("two", 2, "old_ruins", "contradiction")]);
    const card = journal.cards.find((entry) => entry.discoveryId === "ancient_culture_traces");
    expect(card?.resolution).toBe("contradicted");
    expect(card?.contradictionCount).toBe(2);
    expect(card?.evidence).toHaveLength(2);
  });
});
