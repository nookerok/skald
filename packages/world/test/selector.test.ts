import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { selectTurnPresentation } from "../src/presentation/selector.js";

function emptyWorld(): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences: new Map(),
    firedConsequences: new Map(),
    activeSituations: new Map(),
    burnedTrees: 0,
    relations: new Map(),
    heatSources: new Map(),
    heatMap: new Map(),
    lastActionTick: 0,
    strategy: [],
    eventNumber: 5,
    time: 5,
  }) as unknown as ReadonlyWorld;
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

describe("selectTurnPresentation", () => {
  it("background event does not become primary", () => {
    // Only a TickPassed with playerOffline (background) — no primary-importance event
    const events = [evt("TickPassed", "t-1", { delta: 1, playerOffline: true }, 5)];
    const pres = selectTurnPresentation(events, emptyWorld());
    // Primary should be the projection fallback, not the TickPassed
    expect(pres.primary).not.toBeNull();
    expect(pres.primary!.text).toContain("находишься");
  });

  it("primary-importance event becomes primary", () => {
    const events = [evt("MovementSucceeded", "m-1", { x: 0, y: 1 }, 5)];
    const pres = selectTurnPresentation(events, emptyWorld());
    expect(pres.primary).not.toBeNull();
    expect(pres.primary!.importance).toBe("primary");
    expect(pres.primary!.text).toContain("проходишь");
  });

  it("notable events remain notable, not primary", () => {
    const events = [evt("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 5)];
    const pres = selectTurnPresentation(events, emptyWorld());
    expect(pres.primary).not.toBeNull();
    expect(pres.primary!.text).toContain("находишься"); // projection fallback
    expect(pres.notable.length).toBeGreaterThan(0);
    expect(pres.notable[0]!.text).toContain("рискованный");
  });

  it("SituationStarted and SituationEnded do not merge into one", () => {
    const events = [
      evt("SituationStarted", "ss-1", { situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8, data: {} }, 5),
      evt("SituationEnded", "se-1", { situationId: "forest_fire" }, 13),
    ];
    const pres = selectTurnPresentation(events, emptyWorld());
    // They should be separate entries (different groupKey prefix)
    const started = pres.notable.filter((e) => e.text.includes("меняется"));
    const ended = pres.notable.filter((e) => e.text.includes("завершилась"));
    expect(started.length).toBe(1);
    expect(ended.length).toBe(1);
  });

  it("ConsequenceCreated and ConsequenceFired do not merge", () => {
    const events = [
      evt("ConsequenceCreated", "cc-1", { id: "aud@1", type: "audacity", severity: 1, createdAt: 5, expiresAt: 10 }, 5),
      evt("ConsequenceFired", "cf-1", { consequenceId: "aud@1", consequenceType: "audacity", firedAt: 10 }, 10),
    ];
    const pres = selectTurnPresentation(events, emptyWorld());
    const created = pres.notable.filter((e) => e.text.includes("породили"));
    const fired = pres.notable.filter((e) => e.text.includes("проявило"));
    expect(created.length).toBe(1);
    expect(fired.length).toBe(1);
  });

  it("duplicate TreeBurned are grouped together", () => {
    const events = [
      evt("TreeBurned", "tb-1", { burnedAt: 5, treeIndex: 0 }, 5),
      evt("TreeBurned", "tb-2", { burnedAt: 6, treeIndex: 1 }, 6),
    ];
    const pres = selectTurnPresentation(events, emptyWorld());
    const treeEntries = pres.notable.filter((e) => e.text.includes("дерево"));
    // Two TreeBurned with same groupKey → merged into one entry with both sourceEventIds
    expect(treeEntries.length).toBe(1);
    expect(treeEntries[0]!.sourceEventIds).toContain("tb-1");
    expect(treeEntries[0]!.sourceEventIds).toContain("tb-2");
  });
});
