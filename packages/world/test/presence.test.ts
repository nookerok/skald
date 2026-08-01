import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { WorldProjector } from "../src/projection.js";
import { bootstrapWorldEvents } from "../src/bootstrap.js";
import type { PresentationThread } from "../src/journal/index.js";
import {
  buildObserverSession,
  buildPresenceDiagnostics,
  buildWorldPresenceSummary,
  computeBeliefDrift,
  computeBeliefRevision,
  findDormantThreads,
  reconstructCheckpointModel,
  resolveCheckpointState,
} from "../src/presence/index.js";
import type { ObserverCheckpoint, PlayerContext } from "../src/presence/types.js";

const PLAYER_CONTEXT: PlayerContext = {
  locationTitle: "Башня на подходе",
  locationDescription: "Полуразрушенная башня у дороги.",
};

function worldWith(events: readonly DomainEvent[]): WorldProjector {
  const p = new WorldProjector();
  for (const e of events) p.apply(e);
  return p;
}

function event(
  index: number,
  type: string,
  timestamp: number,
  payload: Record<string, unknown>,
  correlationId = `cmd-${timestamp}`,
): DomainEvent {
  return {
    eventId: `e${index}`,
    type,
    schemaVersion: 1,
    payload,
    timestamp,
    correlationId,
    causationId: null,
  };
}

/**
 * A playthrough: bootstrap, an online turn at t=1 (the player arrives at the
 * tower), then offline ticks; a sound cue plays at t=3 while offline.
 */
function playthrough(ticks: number): DomainEvent[] {
  const events = [...bootstrapWorldEvents()];
  events.push(event(events.length, "PlayerLocationChanged", 1, { locationId: "tower_approach", locationName: "Башня" }, "cmd-1"));
  events.push(event(events.length, "TickPassed", 1, { delta: 1 }, "tick-1"));
  for (let t = 2; t <= ticks; t++) {
    events.push(event(events.length, "TickPassed", t, { delta: 1, playerOffline: true }, `tick-${t}`));
    if (t === 3) {
      events.push(event(events.length, "SoundProduced", 3, { source: "river", locationId: "tower_approach" }, "cmd-3"));
    }
  }
  return events;
}

/** Checkpoint at the exact end of the world time `time` prefix. */
function checkpointAtTime(events: readonly DomainEvent[], time: number): ObserverCheckpoint {
  let lastIndex = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.timestamp <= time) lastIndex = i;
    else break;
  }
  const prefix = events.slice(0, lastIndex + 1);
  const model = reconstructCheckpointModel(events, {
    worldId: "test-world",
    observerId: "player",
    lastPresenceWorldTime: time,
    lastPresenceEventNumber: prefix.length,
    beliefRevision: 0,
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  return {
    worldId: "test-world",
    observerId: "player",
    lastPresenceWorldTime: time,
    lastPresenceEventNumber: prefix.length,
    beliefRevision: model ? computeBeliefRevision(model) : 0,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("computeBeliefRevision", () => {
  it("is deterministic for the same model", () => {
    const events = playthrough(5);
    const model = reconstructCheckpointModel(events, {
      worldId: "w", observerId: "player", lastPresenceWorldTime: 5,
      lastPresenceEventNumber: events.length, beliefRevision: 0, updatedAt: "",
    })!;
    expect(computeBeliefRevision(model)).toBe(computeBeliefRevision(model));
  });

  it("changes when the knowledge base changes", () => {
    const a = playthrough(3);
    const b = playthrough(4);
    const ma = reconstructCheckpointModel(a, {
      worldId: "w", observerId: "player", lastPresenceWorldTime: 3,
      lastPresenceEventNumber: a.length, beliefRevision: 0, updatedAt: "",
    })!;
    const mb = reconstructCheckpointModel(b, {
      worldId: "w", observerId: "player", lastPresenceWorldTime: 4,
      lastPresenceEventNumber: b.length, beliefRevision: 0, updatedAt: "",
    })!;
    expect(computeBeliefRevision(ma)).not.toBe(computeBeliefRevision(mb));
  });
});

describe("resolveCheckpointState", () => {
  it("reports missing without a checkpoint", () => {
    expect(resolveCheckpointState(playthrough(2), null).state).toBe("missing");
  });

  it("accepts a matching digest as valid", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 3);
    expect(resolveCheckpointState(events, checkpoint).state).toBe("valid");
  });

  it("reports incompatible when the stored digest no longer matches", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 3);
    const corrupted = { ...checkpoint, beliefRevision: checkpoint.beliefRevision + 1 };
    expect(resolveCheckpointState(events, corrupted).state).toBe("incompatible");
  });

  it("rejects a checkpoint whose world time alone was tampered", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 3);
    // The digest still matches the belief model of the prefix; only the
    // stored world time is replaced, and the prefix no longer ends on it.
    const tampered = { ...checkpoint, lastPresenceWorldTime: 999 };
    expect(resolveCheckpointState(events, tampered)).toEqual({ state: "incompatible", model: null });
  });

  it("rejects a checkpoint pointing beyond the event log without clamping", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 3);
    expect(resolveCheckpointState(events, { ...checkpoint, lastPresenceEventNumber: 9999 }).state).toBe("incompatible");
  });

  it("rejects unsafe or negative times and event numbers", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 3);
    expect(resolveCheckpointState(events, { ...checkpoint, lastPresenceWorldTime: -1 }).state).toBe("incompatible");
    expect(resolveCheckpointState(events, { ...checkpoint, lastPresenceWorldTime: Number.NaN }).state).toBe("incompatible");
    expect(resolveCheckpointState(events, { ...checkpoint, lastPresenceEventNumber: -2 }).state).toBe("incompatible");
  });

  it("rejects fractional world times and event numbers", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 3);
    expect(resolveCheckpointState(events, { ...checkpoint, lastPresenceWorldTime: 3.5 }).state).toBe("incompatible");
    expect(resolveCheckpointState(events, { ...checkpoint, lastPresenceEventNumber: 12.5 }).state).toBe("incompatible");
  });

  it("accepts a valid bootstrap checkpoint", () => {
    const events = [...bootstrapWorldEvents()];
    const checkpoint = checkpointAtTime(events, 0);
    expect(checkpoint.lastPresenceWorldTime).toBe(0);
    expect(resolveCheckpointState(events, checkpoint).state).toBe("valid");
  });

  it("rejects a prefix that does not end at the checkpoint time", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 3);
    // Same prefix length, same digest, but the stored time is one tick off.
    const mismatched = { ...checkpoint, lastPresenceWorldTime: checkpoint.lastPresenceWorldTime + 1 };
    expect(resolveCheckpointState(events, mismatched)).toEqual({ state: "incompatible", model: null });
  });

  it("still accepts a checkpoint at the very end of the log", () => {
    const events = playthrough(6);
    const checkpoint = checkpointAtTime(events, 6);
    expect(resolveCheckpointState(events, checkpoint).state).toBe("valid");
  });
});

describe("computeBeliefDrift", () => {
  const emptyModel = (): import("../src/observation/types.js").BeliefModelDTO => ({
    schemaVersion: 2,
    observerId: "player",
    beliefs: [],
    activeHypotheses: [],
    knownRelations: [],
    contradictions: [],
    lastUpdated: 0,
  });
  const base = {
    checkpoint: null as ObserverCheckpoint | null,
    checkpointModel: null,
    currentModel: emptyModel(),
    currentRevision: { worldTime: 10, eventNumber: 10 },
    unresolvedThreadCount: 0,
    newlyObservedChanges: [] as never[],
    missingEvidenceCount: 0,
  };

  it("is none without a checkpoint", () => {
    const drift = computeBeliefDrift({ ...base, staleBeliefCount: 5, contradictedBeliefCount: 2 });
    expect(drift.level).toBe("none");
    expect(drift.worldTimeDelta).toBe(0);
  });

  it("is none when world time did not advance", () => {
    const drift = computeBeliefDrift({
      ...base,
      checkpoint: { worldId: "w", observerId: "player", lastPresenceWorldTime: 10, lastPresenceEventNumber: 9, beliefRevision: 1, updatedAt: "" },
      checkpointModel: emptyModel(),
      currentModel: emptyModel(),
      staleBeliefCount: 0,
      contradictedBeliefCount: 0,
      newlyObservedChanges: [],
    });
    expect(drift.level).toBe("none");
  });

  it("ranks low / medium / high by the ADR thresholds with per-factor caps", () => {
    const checkpoint = {
      worldId: "w", observerId: "player" as const, lastPresenceWorldTime: 1,
      lastPresenceEventNumber: 4, beliefRevision: 1, updatedAt: "",
    };
    const mk = (stale: number, contradicted: number, threads: number, changes: number) =>
      computeBeliefDrift({
        checkpoint,
        checkpointModel: emptyModel(),
        currentModel: emptyModel(),
        currentRevision: { worldTime: 9, eventNumber: 20 },
        staleBeliefCount: stale,
        contradictedBeliefCount: contradicted,
        unresolvedThreadCount: threads,
        newlyObservedChanges: Array.from({ length: changes }, (_, i) => ({
          description: `x${i}`, observedAt: 2,
        })),
        missingEvidenceCount: 0,
      });

    expect(mk(0, 0, 0, 0).level).toBe("none");
    expect(mk(1, 0, 0, 0).level).toBe("low");
    expect(mk(2, 0, 0, 0).level).toBe("low");
    expect(mk(3, 0, 0, 0).level).toBe("medium");
    expect(mk(6, 0, 0, 0).level).toBe("high");
    // contradicted: weight 2, capped at 8
    expect(mk(0, 1, 0, 0).level).toBe("low");
    expect(mk(0, 2, 0, 0).level).toBe("medium");
    expect(mk(0, 3, 0, 0).level).toBe("high");
    // threads: capped at 4, so threads alone can never reach high
    expect(mk(0, 0, 3, 0).level).toBe("medium");
    expect(mk(0, 0, 4, 0).level).toBe("medium");
    expect(mk(0, 0, 6, 0).level).toBe("medium");
    // changes: ceil(n/2), capped at 8
    expect(mk(0, 0, 0, 4).level).toBe("low");
    expect(mk(0, 0, 0, 12).level).toBe("high");
    expect(mk(0, 0, 0, 30).level).toBe("high");
  });

  it("generates deterministic ordered reasons", () => {
    const drift = computeBeliefDrift({
      checkpoint: { worldId: "w", observerId: "player", lastPresenceWorldTime: 1, lastPresenceEventNumber: 4, beliefRevision: 1, updatedAt: "" },
      checkpointModel: emptyModel(),
      currentModel: emptyModel(),
      currentRevision: { worldTime: 9, eventNumber: 20 },
      staleBeliefCount: 2,
      contradictedBeliefCount: 1,
      unresolvedThreadCount: 1,
      newlyObservedChanges: [{ description: "x", observedAt: 2 }],
      missingEvidenceCount: 0,
    });
    expect(drift.reasons.map((r) => r.kind)).toEqual([
      "freshness_decay",
      "contradiction",
      "new_observation",
    ]);
    expect(drift.reasons[0]!.text).toContain("2");
  });
});

describe("buildObserverSession", () => {
  it("builds a consistent session with revision and belief model", () => {
    const events = playthrough(8);
    const world = worldWith(events).getSnapshot();
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint: null });
    expect(session.schemaVersion).toBe(1);
    expect(session.revision).toEqual({ worldTime: 8, eventNumber: events.length });
    expect(session.checkpointState).toBe("missing");
    expect(session.checkpoint).toBeNull();
    expect(session.drift.level).toBe("none");
    expect(session.presence.schemaVersion).toBe(1);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.presence)).toBe(true);
    expect(Object.isFrozen(session.beliefModel)).toBe(true);
  });

  it("reports drift for stale beliefs after a long absence", () => {
    const events = playthrough(16);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    expect(session.checkpoint).not.toBeNull();
    expect(session.drift.worldTimeDelta).toBe(16 - 3);
    expect(session.drift.staleBeliefCount).toBeGreaterThan(0);
    expect(session.presence.staleBeliefs.length).toBeGreaterThan(0);
    expect(session.drift.level).not.toBe("none");
  });

  it("excludes events that happened while the player was offline", () => {
    // The sound at t=3 sits in the player's own location, but every tick is
    // offline, so it was never observed: no changes, no drift, no statements.
    const events = playthrough(16);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    expect(session.presence.nearbyChanges).toEqual([]);
    expect(session.drift.newlyObservedChangeCount).toBe(0);
    expect(session.statements.some((s) => s.text.includes("river"))).toBe(false);
    const raw = JSON.stringify(session);
    expect(raw).not.toContain("river");
  });

  it("includes same-location events when the player was online", () => {
    const events = [...bootstrapWorldEvents()];
    events.push(event(events.length, "PlayerLocationChanged", 1, { locationId: "tower_approach", locationName: "Башня" }, "cmd-1"));
    events.push(event(events.length, "TickPassed", 1, { delta: 1 }, "tick-1"));
    events.push(event(events.length, "SoundProduced", 2, { source: "river", locationId: "tower_approach" }, "cmd-2"));
    events.push(event(events.length, "TickPassed", 2, { delta: 1 }, "tick-2"));
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 1);
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    expect(session.drift.newlyObservedChangeCount).toBeGreaterThan(0);
    expect(session.presence.nearbyChanges.some((c) => c.description.includes("river"))).toBe(true);
  });

  it("hides events outside the observer scope from changes", () => {
    const events = [...bootstrapWorldEvents()];
    // Player stays at spawn (0,0); a distant event (10,10) is NOT observable.
    events.push(event(events.length, "MovementSucceeded", 1, { x: 10, y: 10 }, "cmd-1"));
    events.push(event(events.length, "TickPassed", 1, { delta: 1 }, "tick-1"));
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 1);
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    const mentionsDistant = session.presence.nearbyChanges.some((c) => c.description.includes("10"));
    expect(mentionsDistant).toBe(false);
    const rawHidden = JSON.stringify(session).includes('"x":10,"y":10');
    expect(rawHidden).toBe(false);
  });

  it("never exposes forbidden truth fields in the session DTO", () => {
    const events = playthrough(10);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    // The canonical BeliefModelDTO keeps its contract shape (patternId etc.);
    // the forbidden-field rule applies to the presence reconstruction surface.
    const json = JSON.stringify({ ...session, beliefModel: undefined });
    expect(json).not.toMatch(/"actual[A-Z_]/);
    expect(json).not.toMatch(/"true[A-Z_]/);
    expect(json).not.toMatch(/"real[A-Z_]/);
    expect(json).not.toContain("eventId");
    expect(json).not.toContain("evidenceId");
    expect(json).not.toContain("patternId");
    expect(json).not.toContain("threadKey");
    expect(json).not.toContain("activeSituations");
    expect(json).not.toContain("consequences");
  });

  it("produces player-facing montage statements without internal ids", () => {
    const events = playthrough(16);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    for (const statement of session.statements) {
      expect(["observation_delta", "belief_freshness", "belief_contradiction", "known_thread"]).toContain(statement.source);
      expect(typeof statement.text).toBe("string");
      expect("evidenceIds" in statement).toBe(false);
    }
  });

  it("focus is derived only from observation records and never invents time of day", () => {
    const events = playthrough(6);
    const world = worldWith(events).getSnapshot();
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint: null });
    const focus = session.presence.focus;
    expect(focus.timeDescription).toBeNull();
    expect(Array.isArray(focus.sensoryCues)).toBe(true);
    expect(Array.isArray(focus.rememberedContext)).toBe(true);
    for (const cue of focus.sensoryCues) expect(typeof cue).toBe("string");
  });

  it("carries player context into the presence location view", () => {
    const events = playthrough(6);
    const world = worldWith(events).getSnapshot();
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint: null });
    expect(session.presence.location).toEqual({
      title: PLAYER_CONTEXT.locationTitle,
      description: PLAYER_CONTEXT.locationDescription,
    });
  });

  it("treats an incompatible checkpoint as no memory everywhere", () => {
    const events = playthrough(8);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    expect(resolveCheckpointState(events, checkpoint).model).not.toBeNull();
    const corrupted = { ...checkpoint, beliefRevision: checkpoint.beliefRevision + 1 };
    expect(resolveCheckpointState(events, corrupted)).toEqual({ state: "incompatible", model: null });
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint: corrupted });
    expect(session.checkpointState).toBe("incompatible");
    expect(session.checkpoint).toEqual(corrupted);
    expect(session.drift.level).toBe("none");
    expect(session.presence.staleBeliefs).toEqual([]);
    expect(session.presence.nearbyChanges).toEqual([]);
    expect(session.presence.suggestedReobservations).toEqual([]);
    expect(session.presence.focus.rememberedContext).toEqual([]);
    expect(session.statements).toEqual([]);
  });

  it("is deterministic across identical inputs", () => {
    const events = playthrough(12);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    const a = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    const b = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rejects a checkpoint beyond the log as incompatible", () => {
    const events = playthrough(4);
    const world = worldWith(events).getSnapshot();
    const checkpoint = {
      worldId: "w", observerId: "player" as const, lastPresenceWorldTime: 4,
      lastPresenceEventNumber: 9999, beliefRevision: 0, updatedAt: "",
    };
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    expect(session.checkpointState).toBe("incompatible");
    expect(session.drift.level).toBe("none");
    expect(session.presence.dormantThreads).toEqual([]);
    expect(session.presence.nearbyChanges).toEqual([]);
  });

  it("keeps threads dormant when their continuation happened while offline", () => {
    const events = [...bootstrapWorldEvents()];
    // The player observes the risk_taken thread while online at t=1...
    events.push(event(events.length, "ObservationUpdated", 1, { key: "risk_taken" }, "cmd-1"));
    events.push(event(events.length, "TickPassed", 1, { delta: 1 }, "tick-1"));
    // ...and the same thread is continued during a fully offline turn at t=2.
    events.push(event(events.length, "ObservationUpdated", 2, { key: "risk_taken" }, "cmd-2"));
    events.push(event(events.length, "TickPassed", 2, { delta: 1, playerOffline: true }, "tick-2"));
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 1);
    const session = buildObserverSession({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    expect(session.checkpointState).toBe("valid");
    // The hidden continuation is not observable: no changes, no leak.
    expect(session.presence.nearbyChanges).toEqual([]);
    const labels = session.presence.dormantThreads.map((thread) => thread.label);
    expect(labels).toContain("Наблюдение: рискованный поступок");
    const knownThread = session.presence.dormantThreads.find((thread) => thread.label === "Наблюдение: рискованный поступок")!;
    expect(knownThread.entryCount).toBe(1);
    expect(knownThread.lastWorldTime).toBe(1);
    // The hidden continuation produced no observation-delta anywhere: the
    // only statement is the dormant-thread reminder.
    expect(session.drift.newlyObservedChangeCount).toBe(0);
    expect(session.statements).toEqual([
      { text: "История о «Наблюдение: рискованный поступок» осталась без продолжения.", source: "known_thread" },
    ]);
  });
});

describe("buildPresenceDiagnostics", () => {
  it("exposes internal identifiers only on the diagnostics surface", () => {
    const events = playthrough(16);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    const diagnostics = buildPresenceDiagnostics({ events, world, playerContext: PLAYER_CONTEXT, checkpoint });
    expect(diagnostics.checkpointState).toBe("valid");
    expect(Array.isArray(diagnostics.staleBeliefs)).toBe(true);
    expect(Array.isArray(diagnostics.contradictedPatterns)).toBe(true);
    expect(Array.isArray(diagnostics.dormantThreads)).toBe(true);
    for (const ref of diagnostics.staleBeliefs) expect(typeof ref.patternId).toBe("string");
    for (const change of diagnostics.nearbyChanges) {
      expect(typeof change.targetId).toBe("string");
      expect(typeof change.evidenceId).toBe("string");
    }
    for (const thread of diagnostics.dormantThreads) expect(typeof thread.threadKey).toBe("string");
    for (const statement of diagnostics.statements) expect(Array.isArray(statement.evidenceIds)).toBe(true);
    expect(Object.isFrozen(diagnostics)).toBe(true);
  });
});

describe("findDormantThreads", () => {
  it("marks only checkpoint threads without continuation", () => {
    const mkThread = (key: string, label: string, last: number): PresentationThread => ({
      threadKey: key,
      label,
      firstWorldTime: 1,
      lastWorldTime: last,
      entries: [{
        turnId: "t", worldTime: last, text: "x", importance: "notable" as const,
        discoveryMark: null, sourceEventIds: ["e1"],
      }],
    });
    const checkpointThreads = [mkThread("a", "Караван", 4), mkThread("b", "Лес", 3)];
    const currentThreads = [mkThread("a", "Караван", 9), mkThread("b", "Лес", 3)];
    const dormant = findDormantThreads(checkpointThreads, currentThreads, 4);
    expect(dormant.map((t) => t.threadKey)).toEqual(["b"]);
  });
});

describe("buildWorldPresenceSummary", () => {
  it("summarizes last presence, drift level and stale counts", () => {
    const events = playthrough(16);
    const world = worldWith(events).getSnapshot();
    const summary0 = buildWorldPresenceSummary({ worldId: "w", events, world, checkpoint: null });
    expect(summary0.driftLevel).toBe("none");
    expect(summary0.lastPresenceWorldTime).toBeNull();
    expect(summary0.checkpointState).toBe("missing");
    expect(summary0.worldId).toBe("w");
    expect(summary0.schemaVersion).toBe(1);
    expect(summary0.currentWorldTime).toBe(16);

    const checkpoint = checkpointAtTime(events, 3);
    const summary = buildWorldPresenceSummary({ worldId: "w", events, world, checkpoint });
    expect(summary.lastPresenceWorldTime).toBe(3);
    expect(summary.worldTimeDelta).toBe(13);
    expect(summary.driftLevel).not.toBe("none");
    expect(summary.staleBeliefCount).toBeGreaterThan(0);
    expect(summary.dormantThreadCount).toBeGreaterThanOrEqual(0);
  });

  it("maps checkpoint state and drift to ready player-facing texts", () => {
    const events = playthrough(16);
    const world = worldWith(events).getSnapshot();

    const missing = buildWorldPresenceSummary({ worldId: "w", events, world, checkpoint: null });
    expect(missing.presenceStatus).toBe("Ты ещё не входил в этот мир.");
    expect(missing.knowledgeStatus).toBeNull();
    expect(missing.worldTimeDelta).toBe(0);

    // Checkpoint at the very end of a short session: nothing drifted, the
    // observations are recent, no doubts.
    const short = playthrough(4);
    const shortWorld = worldWith(short).getSnapshot();
    const fresh = buildWorldPresenceSummary({ worldId: "w", events: short, world: shortWorld, checkpoint: checkpointAtTime(short, 4) });
    expect(fresh.checkpointState).toBe("valid");
    expect(fresh.driftLevel).toBe("none");
    expect(fresh.presenceStatus).toBe("Мир почти такой, каким ты его помнишь.");
    expect(fresh.knowledgeStatus).toBeNull();

    // Checkpoint at t=3 with 13 ticks of offline decay: stale knowledge.
    const decayed = buildWorldPresenceSummary({ worldId: "w", events, world, checkpoint: checkpointAtTime(events, 3) });
    expect(decayed.driftLevel).not.toBe("none");
    expect(decayed.presenceStatus).toBe("В мире появились едва заметные расхождения.");
    expect(decayed.knowledgeStatus).toBe("Некоторые знания требуют проверки.");

    const incompatible = buildWorldPresenceSummary({
      worldId: "w", events, world,
      checkpoint: { ...checkpointAtTime(events, 3), beliefRevision: -1 },
    });
    expect(incompatible.presenceStatus).toBe("Прежнее присутствие не удалось восстановить.");
    expect(incompatible.knowledgeStatus).toBeNull();
  });

  it("mentions silent threads in the knowledge status", () => {
    const events = [...bootstrapWorldEvents()];
    events.push(event(events.length, "ObservationUpdated", 1, { key: "risk_taken" }, "cmd-1"));
    events.push(event(events.length, "TickPassed", 1, { delta: 1 }, "tick-1"));
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 1);
    const summary = buildWorldPresenceSummary({ worldId: "w", events, world, checkpoint });
    expect(summary.checkpointState).toBe("valid");
    expect(summary.dormantThreadCount).toBe(1);
    expect(summary.knowledgeStatus).toBe("Одна нить давно не отзывалась.");

    const two = [...bootstrapWorldEvents()];
    two.push(event(two.length, "ObservationUpdated", 1, { key: "risk_taken" }, "cmd-1"));
    two.push(event(two.length, "ObservationUpdated", 1, { key: "wall_caution" }, "cmd-1"));
    two.push(event(two.length, "TickPassed", 1, { delta: 1 }, "tick-1"));
    const world2 = worldWith(two).getSnapshot();
    const summary2 = buildWorldPresenceSummary({ worldId: "w", events: two, world: world2, checkpoint: checkpointAtTime(two, 1) });
    expect(summary2.dormantThreadCount).toBe(2);
    expect(summary2.knowledgeStatus).toBe("2 нити давно не отзывались.");
  });

  it("hides the stored time of an incompatible checkpoint", () => {
    const events = playthrough(16);
    const world = worldWith(events).getSnapshot();
    const checkpoint = checkpointAtTime(events, 3);
    const corrupted = { ...checkpoint, beliefRevision: checkpoint.beliefRevision + 1 };
    const summary = buildWorldPresenceSummary({ worldId: "w", events, world, checkpoint: corrupted });
    expect(summary.checkpointState).toBe("incompatible");
    expect(summary.lastPresenceWorldTime).toBeNull();
  });
});
