import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { BeliefModelDTO } from "../src/observation/types.js";
import { bootstrapWorldEvents } from "../src/bootstrap.js";
import { reconstructCheckpointModel, computeBeliefRevision } from "../src/presence/index.js";
import type { ObserverCheckpoint } from "../src/presence/types.js";
import { buildObserverThreadJournal, REMEMBERED_MAX_AGE, MAX_THREADS, MAX_EVIDENCE } from "../src/observer-threads/index.js";

function e(eventId: string, type: string, timestamp: number, payload: Record<string, unknown>, playerOffline = false): DomainEvent {
  return {
    eventId, type, schemaVersion: 1, payload, timestamp,
    correlationId: playerOffline ? `tick-${timestamp}` : `cmd-${timestamp}`,
    causationId: null,
  };
}

/** Online turn with a TickPassed at `time`. */
function turn(events: DomainEvent[], ...turnEvents: DomainEvent[]): DomainEvent[] {
  const ts = turnEvents[0]!.timestamp;
  return [...events, ...turnEvents, e(`t-${ts}`, "TickPassed", ts, { delta: 1 })];
}

/** Offline turn: TickPassed carries playerOffline: true. */
function offlineTurn(events: DomainEvent[], ...turnEvents: DomainEvent[]): DomainEvent[] {
  const ts = turnEvents[0]!.timestamp;
  return [...events, ...turnEvents, e(`t-${ts}`, "TickPassed", ts, { delta: 1, playerOffline: true }, true)];
}

function fireStarted(ts: number): DomainEvent {
  return e(`ff-${ts}`, "ForestFireStarted", ts, { startedAt: ts });
}

function treeBurned(ts: number, treeIndex = 0): DomainEvent {
  return e(`tb-${ts}`, "TreeBurned", ts, { burnedAt: ts, treeIndex });
}

function fireEnded(ts: number): DomainEvent {
  return e(`fe-${ts}`, "SituationEnded", ts, { situationId: "forest_fire" });
}

function situationStarted(ts: number, situationId: string): DomainEvent {
  return e(`ss-${ts}`, "SituationStarted", ts, { situationId, type: "forest_fire", startedAt: ts, duration: 8, data: {} });
}

/** A forest fire observed start→spread→end, all online. */
function firePlaythrough(endAt: number): DomainEvent[] {
  let events: DomainEvent[] = [];
  events = turn(events, fireStarted(1));
  for (let t = 2; t < endAt; t++) events = turn(events, treeBurned(t));
  events = turn(events, fireEnded(endAt));
  return events;
}

/** A fire that is still burning at `now` (no end observed). */
function burningFire(now: number): DomainEvent[] {
  let events: DomainEvent[] = [];
  events = turn(events, fireStarted(1));
  for (let t = 2; t <= now; t++) events = turn(events, treeBurned(t));
  return events;
}

/** A fire that starts while the player is offline (not observable). */
function offlineFirePlaythrough(endAt: number): DomainEvent[] {
  let events: DomainEvent[] = offlineTurn([], fireStarted(1));
  for (let t = 2; t <= endAt; t++) events = offlineTurn(events, treeBurned(t));
  return events;
}

/** A fire that started online but spread/ended while offline. */
function fireWithOfflineTail(onlineUntil: number, endAt: number): DomainEvent[] {
  let events: DomainEvent[] = [];
  events = turn(events, fireStarted(1));
  for (let t = 2; t <= onlineUntil; t++) events = turn(events, treeBurned(t));
  for (let t = onlineUntil + 1; t < endAt; t++) events = offlineTurn(events, treeBurned(t));
  events = offlineTurn(events, fireEnded(endAt));
  return events;
}

const EMPTY_MODEL: BeliefModelDTO = {
  schemaVersion: 2,
  observerId: "player",
  beliefs: [],
  activeHypotheses: [],
  knownRelations: [],
  contradictions: [],
  lastUpdated: 0,
};

function modelWith(contradictions: BeliefModelDTO["contradictions"] = [], beliefs: BeliefModelDTO["beliefs"] = []): BeliefModelDTO {
  return { ...EMPTY_MODEL, contradictions, beliefs };
}

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

function revision(events: readonly DomainEvent[], time: number) {
  return { worldTime: time, eventNumber: events.filter((ev) => ev.timestamp <= time).length };
}

function buildJournal(events: readonly DomainEvent[], time: number, options: { checkpoint?: ObserverCheckpoint | null; model?: BeliefModelDTO } = {}) {
  return buildObserverThreadJournal({
    events,
    beliefModel: options.model ?? EMPTY_MODEL,
    checkpoint: options.checkpoint ?? null,
    checkpointState: options.checkpoint ? "valid" : "missing",
    revision: revision(events, time),
  });
}

describe("buildObserverThreadJournal", () => {
  it("empty log yields an empty journal with zero counts", () => {
    const journal = buildJournal([], 0);
    expect(journal.schemaVersion).toBe(1);
    expect(journal.threads).toHaveLength(0);
    expect(journal.counts).toEqual({ observedActive: 0, changedSincePresence: 0, uncertain: 0, recentlyResolved: 0 });
  });

  it("movement without thread keys creates no threads", () => {
    const events = [e("m-1", "MovementSucceeded", 1, { x: 0, y: 1 }), e("t-1", "TickPassed", 1, { delta: 1 })];
    expect(buildJournal(events, 1).threads).toHaveLength(0);
  });

  it("an observed fire start creates an active, observed thread", () => {
    const events = burningFire(1);
    const journal = buildJournal(events, 1);
    expect(journal.threads).toHaveLength(1);
    const thread = journal.threads[0]!;
    expect(thread.title).toBe("Лесной пожар");
    expect(thread.knownLifecycle).toBe("active");
    expect(thread.knowledgeState).toBe("observed");
    expect(thread.summary).toContain("начался");
    expect(thread.changeSincePresence).toBeNull();
  });

  it("develop entries keep the thread active", () => {
    const events = burningFire(3);
    const journal = buildJournal(events, 3);
    const thread = journal.threads[0]!;
    expect(thread.knownLifecycle).toBe("active");
    expect(thread.summary).toContain("продолжался");
    expect(thread.evidenceCount).toBeGreaterThan(1);
  });

  it("an observed end resolves the thread", () => {
    const events = firePlaythrough(8);
    const journal = buildJournal(events, 8);
    const thread = journal.threads[0]!;
    expect(thread.knownLifecycle).toBe("resolved");
    expect(thread.summary).toContain("завершился");
    expect(thread.knowledgeState).toBe("observed");
  });

  it("different situation ids produce separate threads", () => {
    const events = [
      ...turn([], situationStarted(1, "fire_a")),
      ...turn([], situationStarted(2, "fire_b")),
    ];
    const journal = buildJournal(events, 2);
    expect(journal.threads).toHaveLength(2);
  });

  it("a fire that started while offline is never shown", () => {
    const events = offlineFirePlaythrough(6);
    const journal = buildJournal(events, 6);
    expect(journal.threads).toHaveLength(0);
  });

  it("offline develop entries do not extend the thread", () => {
    const events = fireWithOfflineTail(1, 8);
    const journal = buildJournal(events, 8);
    const thread = journal.threads[0]!;
    expect(thread.lastObservedAt).toBe(1);
    expect(thread.evidenceCount).toBe(1);
  });

  it("a hidden offline end never resolves the thread", () => {
    const events = fireWithOfflineTail(2, 8);
    const journal = buildJournal(events, 8);
    const thread = journal.threads[0]!;
    expect(thread.knownLifecycle).toBe("active");
    expect(thread.knowledgeState).toBe("uncertain");
  });

  it("knowledge decays: remembered within the freshness window", () => {
    const events = burningFire(2);
    const journal = buildJournal(events, 2 + REMEMBERED_MAX_AGE);
    expect(journal.threads[0]!.knowledgeState).toBe("remembered");
    expect(journal.threads[0]!.uncertaintyText).toBeNull();
  });

  it("knowledge decays: uncertain past the window, with an honest doubt", () => {
    const events = burningFire(2);
    const journal = buildJournal(events, 2 + REMEMBERED_MAX_AGE + 1);
    const thread = journal.threads[0]!;
    expect(thread.knowledgeState).toBe("uncertain");
    expect(thread.knownLifecycle).toBe("active");
    expect(thread.uncertaintyText).toMatch(/признаков давно не было|новых признаков не было/);
    // The honest wording never claims the fire is still burning.
    expect(thread.summary).not.toMatch(/до сих пор|всё ещё горит|закончился/);
  });

  it("a valid checkpoint memory ages threads and reports appeared change", () => {
    const events = [...bootstrapWorldEvents(), ...burningFire(2)];
    const checkpoint = checkpointAt(events, 0);
    // Aged well past the freshness window, so the appeared thread is uncertain.
    const journal = buildJournal(events, 6, { checkpoint });
    const thread = journal.threads[0]!;
    expect(thread.changeSincePresence).toEqual({ kind: "appeared" });
    expect(thread.uncertaintyText).toContain("После твоего ухода");
  });

  it("developed change when the thread continued after the checkpoint", () => {
    const events = burningFire(6);
    const checkpoint = checkpointAt(events, 2);
    const journal = buildJournal(events, 6, { checkpoint });
    const thread = journal.threads[0]!;
    expect(thread.changeSincePresence?.kind).toBe("developed");
  });

  it("resolved change when completion was observed after the checkpoint", () => {
    const events = firePlaythrough(8);
    const checkpoint = checkpointAt(events, 3);
    const journal = buildJournal(events, 8, { checkpoint });
    const thread = journal.threads[0]!;
    expect(thread.changeSincePresence?.kind).toBe("resolved");
  });

  it("no change for a thread exactly as the player left it", () => {
    const events = burningFire(3);
    const checkpoint = checkpointAt(events, 3);
    const journal = buildJournal(events, 3, { checkpoint });
    expect(journal.threads[0]!.changeSincePresence).toBeNull();
  });

  it("a consequence thread becomes contradicted via belief contradiction", () => {
    const events = [
      ...turn([], e("at-1", "AudacityTriggered", 1, { target: "player", severity: 1 })),
    ];
    const belief: BeliefModelDTO["beliefs"][number] = {
      patternId: "consequence:audacity",
      displayName: "Последствие",
      currentInterpretation: "Дерзость насторожила мир.",
      confidence: 0.6,
      supportingEvidence: [{ id: "ev-1", type: "anomaly", description: "Мир настороже", strength: 1, observedAt: 1, linkedObservationIds: [] }],
      openHypotheses: [],
      lastObserved: 1,
      freshness: 1,
    };
    const model = modelWith(
      [{ id: "c-1", description: "Новые свидетельства противоречат прежним.", involvedHypothesisIds: [], involvedEvidenceIds: ["ev-1"], detectedAt: 5 }],
      [belief],
    );
    const journal = buildJournal(events, 5, { model });
    const thread = journal.threads[0]!;
    expect(thread.knowledgeState).toBe("contradicted");
    expect(thread.uncertaintyText).toContain("под сомнение");
  });

  it("an incompatible checkpoint provides no memory (generic wording)", () => {
    const events = burningFire(5);
    const checkpoint = { ...checkpointAt(events, 2), beliefRevision: 12345 };
    const journal = buildObserverThreadJournal({
      events,
      beliefModel: EMPTY_MODEL,
      checkpoint,
      checkpointState: "incompatible",
      revision: revision(events, 9),
    });
    const thread = journal.threads[0]!;
    expect(thread.changeSincePresence).toBeNull();
    expect(thread.uncertaintyText).not.toContain("После твоего ухода");
  });

  it("caps threads at MAX_THREADS deterministically", () => {
    let events: DomainEvent[] = [];
    for (let i = 1; i <= MAX_THREADS + 3; i++) {
      events = turn(events, situationStarted(i, `situation_${i}`));
    }
    const journal = buildJournal(events, MAX_THREADS + 3);
    expect(journal.threads).toHaveLength(MAX_THREADS);
  });

  it("caps evidence per thread at MAX_EVIDENCE", () => {
    const events = burningFire(10);
    const journal = buildJournal(events, 10);
    const thread = journal.threads[0]!;
    expect(thread.evidence.length).toBeLessThanOrEqual(MAX_EVIDENCE);
    expect(thread.evidenceCount).toBe(thread.evidence.length);
    expect(thread.evidence[thread.evidence.length - 1]!.worldTime).toBe(10);
  });

  it("recentlyResolved is capped at 3", () => {
    let events: DomainEvent[] = [];
    for (let i = 1; i <= 5; i++) {
      events = turn(events, situationStarted(i, `situation_${i}`));
    }
    for (let i = 1; i <= 5; i++) {
      events = turn(events, e(`se-${i}`, "SituationEnded", 10 + i, { situationId: `situation_${i}` }));
    }
    const checkpoint = checkpointAt(events, 6);
    const journal = buildJournal(events, 15, { checkpoint });
    expect(journal.counts.recentlyResolved).toBe(3);
  });

  it("sorts changed threads first, then uncertain, then observed active, then resolved", () => {
    let events: DomainEvent[] = [];
    events = turn(events, situationStarted(1, "resolved_a"));          // resolves after checkpoint
    events = turn(events, situationStarted(2, "active_observed"));      // observed active
    events = turn(events, situationStarted(3, "uncertain"));            // ages into uncertain
    events = turn(events, situationStarted(4, "changed"));              // developed after checkpoint
    events = turn(events, e("se-1", "SituationEnded", 6, { situationId: "resolved_a" }));
    const checkpoint = checkpointAt(events, 4);
    const journal = buildJournal(events, 12, { checkpoint });
    const order = journal.threads.map((t) => {
      if (t.title === "Ситуация: changed") return "changed";
      if (t.title === "Ситуация: uncertain") return "uncertain";
      if (t.title === "Ситуация: active observed") return "observed";
      if (t.title === "Ситуация: resolved a") return "resolved";
      return t.title;
    });
    // Both "resolved_a" and "changed" carry a change since the checkpoint;
    // among changed threads the more recently observed one comes first.
    expect(order[0]).toBe("resolved");
    expect(order[1]).toBe("changed");
    expect(order[2]).toBe("uncertain");
    expect(order[3]).toBe("observed");
  });

  it("counts match the returned threads", () => {
    const events = burningFire(2);
    const journal = buildJournal(events, 2 + REMEMBERED_MAX_AGE + 1);
    expect(journal.counts.uncertain).toBe(1);
    expect(journal.counts.observedActive).toBe(0);
    const fresh = buildJournal(events, 2);
    expect(fresh.counts.observedActive).toBe(1);
  });

  it("is deeply frozen", () => {
    const events = burningFire(3);
    const journal = buildJournal(events, 3);
    expect(Object.isFrozen(journal)).toBe(true);
    expect(() => { (journal as any).threads.push(null); }).toThrow();
    expect(() => { (journal.threads[0] as any).evidence.push(null); }).toThrow();
  });

  it("replay produces byte-identical results", () => {
    const events = burningFire(4);
    const a = buildJournal(events, 4);
    const b = buildJournal(events, 4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never leaks internal keys, event types or hidden ids", () => {
    const events = fireWithOfflineTail(1, 8);
    const checkpoint = checkpointAt(events, 3);
    const journal = buildJournal(events, 8, { checkpoint });
    const json = JSON.stringify(journal);
    expect(json).not.toContain("situation:forest_fire");
    expect(json).not.toContain("ForestFireStarted");
    expect(json).not.toContain("TreeBurned");
    expect(json).not.toContain("SituationEnded");
    expect(json).not.toContain("eventId");
    expect(json).not.toContain("correlationId");
  });

  it("thread refs are stable and opaque", () => {
    const events = burningFire(2);
    const journal = buildJournal(events, 2);
    const ref = journal.threads[0]!.ref;
    expect(ref).toMatch(/^ot-[0-9a-z]+$/);
    expect(ref).toBe(journal.threads[0]!.ref);
    expect(ref).not.toContain("situation");
    const again = buildJournal(events, 2);
    expect(again.threads[0]!.ref).toBe(ref);
  });
});
