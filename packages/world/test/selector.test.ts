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
    expect(pres.primary).toBeNull();
    expect(pres.response).toBeNull();
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
    expect(pres.primary).toBeNull();
    expect(pres.response).toBeNull();
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

  it("ConsequenceCreated is hidden; ConsequenceFired surfaces", () => {
    const events = [
      evt("ConsequenceCreated", "cc-1", { id: "aud@1", type: "audacity", severity: 1, createdAt: 5, expiresAt: 10 }, 5),
      evt("ConsequenceFired", "cf-1", { consequenceId: "aud@1", consequenceType: "audacity", firedAt: 10 }, 10),
    ];
    const pres = selectTurnPresentation(events, emptyWorld());
    // ConsequenceCreated is an internal scheduling event and never surfaces.
    const created = pres.notable.filter((e) => e.text.includes("породили"));
    expect(created.length).toBe(0);
    const fired = pres.notable.filter((e) => e.text.includes("проявило"));
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
  it("keeps testimony distinct from direct observation", () => {
    const rumor = selectTurnPresentation([
      evt("RumorHeard", "rumor-1", {
        rumorRef: "claim-bridge",
        text: "Мост ещё цел.",
        sourceLabel: "проводник",
      }, 5),
    ], emptyWorld());
    expect(rumor.primary?.epistemicClass).toBe("testimony");

    const observation = selectTurnPresentation([
      evt("ObjectObserved", "observation-1", {
        name: "мост",
        description: "Перед тобой разрушенный мост.",
        temperature: 20,
        integrity: 10,
      }, 6),
    ], emptyWorld());
    expect(observation.primary?.epistemicClass).toBe("observed_fact");
  });

  it("only allows projection fallback when explicitly requested for the empty state", () => {
    const noFallback = selectTurnPresentation([], emptyWorld());
    expect(noFallback.primary).toBeNull();
    expect(noFallback.response).toBeNull();

    const withFallback = selectTurnPresentation([], emptyWorld(), { allowEmptyStateFallback: true });
    expect(withFallback.primary?.epistemicClass).toBe("observed_fact");
    expect(withFallback.response?.kind).toBe("empty_state");
  });

  it("makes rejection the response instead of ActionAttempted", () => {
    const pres = selectTurnPresentation([
      evt("ActionAttempted", "a-1", { operation: "observe", target: null }, 5),
      evt("ActionRejected", "r-1", { reason: "no_such_target" }, 5),
    ], emptyWorld());
    expect(pres.response?.kind).toBe("action_rejection");
    expect(pres.response?.sourceEventIds).toContain("r-1");
    expect(pres.response?.text).not.toContain("no_such_target");
    expect(pres.primary?.text).toBe(pres.response?.text);
  });

  it("returns a natural outcome for an ActionResolved batch", () => {
    const pres = selectTurnPresentation([
      evt("ActionAttempted", "a-2", { operation: "observe", target: null }, 5),
      evt("ActionResolved", "r-2", { result: "observed", description: "Ты видишь реку." }, 5),
    ], emptyWorld());
    expect(pres.response?.kind).toBe("action_outcome");
    expect(pres.response?.text).toBe("Ты видишь реку.");
  });

  it("does not expose technical rejection reasons", () => {
    const pres = selectTurnPresentation([
      evt("ActionRejected", "r-3", { reason: "unknown_internal_rule" }, 5),
    ], emptyWorld());
    expect(pres.response?.kind).toBe("action_rejection");
    expect(pres.response?.text).not.toMatch(/unknown_internal_rule|confidence|schema/);
  });

  it("gives an explicit neutral response for an incomplete command batch", () => {
    const pres = selectTurnPresentation([
      evt("ActionAttempted", "a-4", { operation: "observe", target: null }, 5),
    ], emptyWorld());
    expect(pres.response?.kind).toBe("action_outcome");
    expect(pres.response?.text).toContain("начинаешь действовать");
    expect(pres.primary?.text).toBe(pres.response?.text);
  });

  it("does not let a grouped candidate lose its epistemic class", () => {
    const pres = selectTurnPresentation([
      evt("TreeBurned", "tree-1", { burnedAt: 5, treeIndex: 1 }, 5),
      evt("TreeBurned", "tree-2", { burnedAt: 6, treeIndex: 2 }, 6),
    ], emptyWorld());
    expect(pres.notable[0]!.epistemicClass).toBe("established_fact");
    expect(pres.notable[0]!.sourceEventIds).toEqual(["tree-1", "tree-2"]);
  });
});
