import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { BeliefModelDTO } from "../src/observation/types.js";
import { bootstrapWorldEvents } from "../src/bootstrap.js";
import { reconstructCheckpointModel, computeBeliefRevision } from "../src/presence/index.js";
import type { ObserverCheckpoint } from "../src/presence/types.js";
import { buildObserverThreadJournal, buildObserverThreadDelta } from "../src/observer-threads/index.js";

function e(eventId: string, type: string, timestamp: number, payload: Record<string, unknown>): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: `cmd-${timestamp}`, causationId: null };
}

function tick(ts: number, playerOffline = false): DomainEvent {
  return e(`t-${ts}`, "TickPassed", ts, { delta: 1, ...(playerOffline ? { playerOffline: true } : {}) });
}

function fireStarted(ts: number): DomainEvent {
  return e(`ff-${ts}`, "ForestFireStarted", ts, { startedAt: ts });
}

function fireEnded(ts: number): DomainEvent {
  return e(`fe-${ts}`, "SituationEnded", ts, { situationId: "forest_fire" });
}

function situationStarted(ts: number, situationId: string): DomainEvent {
  return e(`ss-${ts}`, "SituationStarted", ts, { situationId, type: "forest_fire", startedAt: ts, duration: 8, data: {} });
}

const EMPTY_MODEL: BeliefModelDTO = {
  schemaVersion: 2, observerId: "player", beliefs: [], activeHypotheses: [],
  knownRelations: [], contradictions: [], lastUpdated: 0,
};

function checkpointAt(events: readonly DomainEvent[], time: number): ObserverCheckpoint {
  let lastIndex = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.timestamp <= time) lastIndex = i;
    else break;
  }
  const prefix = events.slice(0, lastIndex + 1);
  const model = reconstructCheckpointModel(events, {
    worldId: "w", observerId: "player", lastPresenceWorldTime: time,
    lastPresenceEventNumber: prefix.length, beliefRevision: 0, updatedAt: "2026-08-01T00:00:00.000Z",
  });
  return {
    worldId: "w", observerId: "player", lastPresenceWorldTime: time,
    lastPresenceEventNumber: prefix.length,
    beliefRevision: model ? computeBeliefRevision(model) : 0,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function journalAndDelta(events: readonly DomainEvent[], time: number, checkpoint: ObserverCheckpoint | null) {
  const revision = { worldTime: time, eventNumber: events.filter((ev) => ev.timestamp <= time).length };
  const journal = buildObserverThreadJournal({
    events,
    beliefModel: EMPTY_MODEL,
    checkpoint,
    checkpointState: checkpoint ? "valid" : "missing",
    revision,
  });
  const delta = buildObserverThreadDelta({ events, journal, checkpoint });
  return { journal, delta };
}

describe("buildObserverThreadDelta", () => {
  it("is empty without a checkpoint", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1), fireEnded(8), tick(8)];
    const { delta } = journalAndDelta(events, 8, null);
    expect(delta).toEqual({ opened: [], changed: [], resolved: [], becameUncertain: [] });
  });

  it("is empty with no threads at all", () => {
    const events = [e("m-1", "MovementSucceeded", 1, { x: 0, y: 1 }), tick(1)];
    const checkpoint = checkpointAt(events, 1);
    const { delta } = journalAndDelta(events, 1, checkpoint);
    expect(delta).toEqual({ opened: [], changed: [], resolved: [], becameUncertain: [] });
  });

  it("lists newly appeared threads as opened", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1)];
    const checkpoint = checkpointAt(events, 0);
    const { journal, delta } = journalAndDelta(events, 1, checkpoint);
    expect(delta.opened).toEqual([journal.threads[0]!.ref]);
    expect(delta.changed).toEqual([]);
    expect(delta.resolved).toEqual([]);
  });

  it("lists threads with new evidence as changed", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1)];
    const checkpoint = checkpointAt(events, 1);
    const more = [...events, e("tb-3", "TreeBurned", 3, { burnedAt: 3, treeIndex: 0 }), tick(3)];
    const { journal, delta } = journalAndDelta(more, 3, checkpoint);
    expect(delta.changed).toEqual([journal.threads[0]!.ref]);
    expect(delta.opened).toEqual([]);
  });

  it("lists threads resolved since the checkpoint as resolved", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1)];
    const checkpoint = checkpointAt(events, 1);
    const more = [...events, fireEnded(8), tick(8)];
    const { journal, delta } = journalAndDelta(more, 8, checkpoint);
    expect(delta.resolved).toEqual([journal.threads[0]!.ref]);
  });

  it("lists remembered threads that aged past the window as becameUncertain", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1)];
    const checkpoint = checkpointAt(events, 1);
    const more = [...events];
    const { delta } = journalAndDelta(more, 6, checkpoint);
    expect(delta.becameUncertain).toHaveLength(1);
  });

  it("does not mark freshly remembered threads as becameUncertain", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1)];
    const checkpoint = checkpointAt(events, 1);
    const { delta } = journalAndDelta(events, 3, checkpoint);
    expect(delta.becameUncertain).toEqual([]);
  });

  it("derives from the capped journal deterministically", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1)];
    const checkpoint = checkpointAt(events, 1);
    const a = journalAndDelta(events, 3, checkpoint);
    const b = journalAndDelta(events, 3, checkpoint);
    expect(JSON.stringify(a.delta)).toBe(JSON.stringify(b.delta));
  });

  it("is deeply frozen and never leaks internal keys", () => {
    const events = [...bootstrapWorldEvents(), fireStarted(1), tick(1), situationStarted(3, "other"), tick(3)];
    const checkpoint = checkpointAt(events, 1);
    const { delta } = journalAndDelta(events, 3, checkpoint);
    expect(Object.isFrozen(delta)).toBe(true);
    expect(() => { (delta as any).opened.push(null); }).toThrow();
    const json = JSON.stringify(delta);
    expect(json).not.toContain("situation:");
    expect(json).not.toContain("ForestFireStarted");
  });
});
