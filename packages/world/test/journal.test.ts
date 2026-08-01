import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { buildTurnJournal } from "../src/journal/builder.js";

function e(eventId: string, type: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

describe("buildTurnJournal", () => {
  it("events of same timestamp form one turn", () => {
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
      e("t-1", "TickPassed", { delta: 1 }, 1),
    ];
    const journal = buildTurnJournal(events);
    expect(journal.turns).toHaveLength(1);
    expect(journal.turns[0]!.worldTime).toBe(1);
    expect(journal.turns[0]!.sourceEventIds).toEqual(["m-1", "t-1"]);
  });

  it("advance N creates N turns", () => {
    const events = [
      e("t-1", "TickPassed", { delta: 1, playerOffline: true }, 1),
      e("t-2", "TickPassed", { delta: 1, playerOffline: true }, 2),
      e("t-3", "TickPassed", { delta: 1, playerOffline: true }, 3),
    ];
    const journal = buildTurnJournal(events);
    expect(journal.turns).toHaveLength(3);
  });

  it("bootstrap timestamp 0 is excluded", () => {
    const events = [
      e("boot-1", "PlayerSpawned", { x: 0, y: 0 }, 0),
      e("boot-2", "WallPlaced", { x: 2, y: 0 }, 0),
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
    ];
    const journal = buildTurnJournal(events);
    expect(journal.turns).toHaveLength(1);
    expect(journal.turns[0]!.worldTime).toBe(1);
  });

  it("non-monotonic timestamp throws error", () => {
    const events = [
      e("t-1", "TickPassed", { delta: 1 }, 3),
      e("t-2", "TickPassed", { delta: 1 }, 1),
    ];
    expect(() => buildTurnJournal(events)).toThrow("Non-monotonic timestamp");
  });

  it("replay of same events produces identical journal", () => {
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
      e("t-1", "TickPassed", { delta: 1 }, 1),
    ];
    const j1 = buildTurnJournal(events);
    const j2 = buildTurnJournal(events);
    expect(JSON.stringify(j1)).toBe(JSON.stringify(j2));
  });

  it("threadKey groups related entries across turns", () => {
    const events = [
      e("ff-1", "ForestFireStarted", { startedAt: 1 }, 1),
      e("t-1", "TickPassed", { delta: 1 }, 1),
      e("tb-1", "TreeBurned", { burnedAt: 3, treeIndex: 0 }, 3),
      e("t-2", "TickPassed", { delta: 1 }, 3),
    ];
    const journal = buildTurnJournal(events);
    const fireThreads = journal.threads.filter((t) => t.threadKey.startsWith("situation:"));
    expect(fireThreads.length).toBeGreaterThan(0);
    const fireThread = fireThreads[0]!;
    expect(fireThread.entries.length).toBe(2); // ForestFireStarted + TreeBurned
  });

  it("different situation IDs do not merge", () => {
    const events = [
      e("ss-1", "SituationStarted", { situationId: "fire_a", type: "forest_fire", startedAt: 1, duration: 5, data: {} }, 1),
      e("ss-2", "SituationStarted", { situationId: "fire_b", type: "forest_fire", startedAt: 2, duration: 5, data: {} }, 2),
    ];
    const journal = buildTurnJournal(events);
    const threads = journal.threads.filter((t) => t.threadKey.startsWith("situation:"));
    expect(threads).toHaveLength(2);
  });

  it("sanitizes human-facing thread labels and text", () => {
    const journal = buildTurnJournal([
      e("rel-1", "RelationChanged", { from: "player", to: "guild", kind: "help", delta: 1 }, 1),
    ]);
    const humanText = journal.threads.flatMap((thread) => [
      thread.label,
      ...thread.entries.map((entry) => entry.text),
    ]).join(" ");
    expect(humanText).not.toContain("guild");
  });

  it("movement without threadKey does not create a thread", () => {
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
    ];
    const journal = buildTurnJournal(events);
    expect(journal.threads).toHaveLength(0);
  });

  it("sourceEventIds are preserved across turns", () => {
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
    ];
    const journal = buildTurnJournal(events);
    expect(journal.turns[0]!.sourceEventIds).toContain("m-1");
  });

  it("does not mutate input events", () => {
    const events: DomainEvent[] = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
    ];
    const before = events.length;
    buildTurnJournal(events);
    expect(events).toHaveLength(before);
  });

  it("timestamp 1 → 0 is rejected", () => {
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
      e("b-1", "PlayerSpawned", { x: 0, y: 0 }, 0),
    ];
    expect(() => buildTurnJournal(events)).toThrow("Non-monotonic");
  });

  it("journal result is deeply immutable at runtime", () => {
    const events = [e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1)];
    const journal = buildTurnJournal(events);
    // Trying to mutate the top-level arrays throws
    expect(() => { (journal as any).turns.push(null); }).toThrow();
    expect(() => { (journal as any).threads.push(null); }).toThrow();
    // Trying to mutate a turn entry throws
    expect(() => { (journal.turns as any)[0].presentation.notable.push(null); }).toThrow();
    // Trying to mutate sourceEventIds throws
    expect(() => { (journal.turns as any)[0].sourceEventIds.push(null); }).toThrow();
    // Journal still has correct structure
    expect(journal.turns).toHaveLength(1);
    expect(journal.turns[0]!.presentation.primary!.text).toContain("проходишь");
  });

  it("historical HeatRadiated uses player position of that turn, not current position", () => {
    // Player moves: T1 → (0,1), T2 → (0,2). T3 heat at (0,1).
    // T4: player walks onto (0,1) — the same cell that was heated at T3.
    // The T3 presentation must still use T3 position (0,2) and NOT say "под ногами".
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
      e("t-1", "TickPassed", { delta: 1 }, 1),
      e("m-2", "MovementSucceeded", { x: 0, y: 2 }, 2),
      e("t-2", "TickPassed", { delta: 1 }, 2),
      e("hr-1", "HeatRadiated", { x: 0, y: 1, delta: 5 }, 3),
      e("t-3", "TickPassed", { delta: 1 }, 3),
      // T4: player moves to (0,1) — the heat cell. Current position becomes (0,1).
      e("m-3", "MovementSucceeded", { x: 0, y: 1 }, 4),
      e("t-4", "TickPassed", { delta: 1 }, 4),
    ];
    const journal = buildTurnJournal(events);
    const t3 = journal.turns.find((t) => t.worldTime === 3);
    expect(t3).toBeDefined();
    const heatTexts = t3!.presentation.notable
      .filter((e) => e.text.includes("Тепло") || e.text.includes("Жар"))
      .map((e) => e.text);
    expect(heatTexts.length).toBeGreaterThan(0);
    const firstHeat = heatTexts[0]!;
    // At T3 player was at (0,2), cell (0,1) is dist=1 → "поблизости" not "под ногами"
    expect(firstHeat).toMatch(/поблизости|разливается/);
    expect(firstHeat).not.toContain("под ногами");
  });

  it("skipOfflineTurns drops offline turns but keeps the projection complete", () => {
    const events = [
      e("obs-1", "ObservationUpdated", { key: "risk_taken" }, 1),
      e("t-1", "TickPassed", { delta: 1 }, 1),
      e("obs-2", "ObservationUpdated", { key: "risk_taken" }, 2),
      e("t-2", "TickPassed", { delta: 1, playerOffline: true }, 2),
    ];
    const full = buildTurnJournal(events);
    const scoped = buildTurnJournal(events, { skipOfflineTurns: true });
    expect(full.turns).toHaveLength(2);
    expect(scoped.turns).toHaveLength(1);
    expect(scoped.turns[0]!.worldTime).toBe(1);
    expect(full.threads.find((t) => t.threadKey === "observation:risk_taken")!.lastWorldTime).toBe(2);
    const scopedThread = scoped.threads.find((t) => t.threadKey === "observation:risk_taken")!;
    expect(scopedThread.lastWorldTime).toBe(1);
    expect(scopedThread.entries).toHaveLength(1);
  });
});
