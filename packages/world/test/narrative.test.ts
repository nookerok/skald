import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld, Consequence, FiredConsequence, ActiveSituation, RelationEdge } from "@skald/world";
import { formatEvent, formatWorldState, buildNarrative, situationLabel, sanitizePlayerFacingText, relationTargetLabelOrRaw, operationLabel } from "@skald/world";

function e(eventId: string, type: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

function emptyWorld(): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences: new Map<string, Consequence>(),
    firedConsequences: new Map<string, FiredConsequence>(),
    activeSituations: new Map<string, ActiveSituation>(),
    burnedTrees: 0,
    relations: new Map<string, RelationEdge>(),
    heatSources: new Map(),
    heatMap: new Map<string, number>(),
    lastActionTick: 0,
    strategy: [],
    eventNumber: 5,
    time: 5,
  }) as unknown as ReadonlyWorld;
}

describe("formatEvent", () => {
  it("MovementSucceeded", () => {
    const result = formatEvent(e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 3));
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("action");
    expect(result!.text).toBe("Ты перемещаешься на позицию (0, 1).");
    expect(result!.timestamp).toBe(3);
    expect(result!.sourceEventIds).toEqual(["m-1"]);
  });

  it("MovementBlocked wall", () => {
    const result = formatEvent(e("b-1", "MovementBlocked", { reason: "wall" }, 3));
    expect(result!.text).toBe("Ты уткнулся в стену.");
  });

  it("MovementBlocked boundary", () => {
    const result = formatEvent(e("b-2", "MovementBlocked", { reason: "boundary" }, 3));
    expect(result!.text).toBe("Ты достиг края мира — дальше пути нет.");
  });

  it("ActionRejected insufficient_time", () => {
    const result = formatEvent(e("r-1", "ActionRejected", { reason: "insufficient_time" }, 3));
    expect(result!.text).toBe("Ты уже действовал в этом мгновенье — нужно подождать.");
  });

  it("CommandRejected", () => {
    const result = formatEvent(e("c-1", "CommandRejected", { reason: "unknown command type: Foo" }, 3));
    expect(result!.text).toBe("Мир не понял твоего намерения.");
  });

  it("ObservationUpdated delta=1", () => {
    const result = formatEvent(e("o-1", "ObservationUpdated", { key: "risk_taken", delta: 1 }, 3));
    expect(result!.text).toContain("Тревожный след");
    expect(result!.text).toContain("возросло на 1");
    expect(result!.text).not.toContain("risk_taken");
  });

  it("ObservationUpdated delta=-1", () => {
    const result = formatEvent(e("o-2", "ObservationUpdated", { key: "wall_caution", delta: -1 }, 3));
    expect(result!.text).toContain("Память преграды");
    expect(result!.text).toContain("убыло на 1");
    expect(result!.text).not.toContain("wall_caution");
  });

  it("ConsequenceCreated", () => {
    const result = formatEvent(e("cc-1", "ConsequenceCreated", { id: "aud@1", type: "audacity", expiresAt: 10 }, 3));
    expect(result!.text).toContain("audacity");
    expect(result!.text).toContain("10");
  });

  it("ConsequenceExpired returns null", () => {
    const result = formatEvent(e("ce-1", "ConsequenceExpired", { id: "aud@1" }, 8));
    expect(result).toBeNull();
  });

  it("ConsequenceFired", () => {
    const result = formatEvent(e("cf-1", "ConsequenceFired", { consequenceId: "aud@1", consequenceType: "audacity", firedAt: 8 }, 8));
    expect(result!.text).toContain("audacity");
    expect(result!.text).toContain("сработало");
  });

  it("AudacityTriggered", () => {
    const result = formatEvent(e("at-1", "AudacityTriggered", { target: "player", severity: 2 }, 8));
    expect(result!.text).toContain("дерзость");
    expect(result!.text).toContain("2");
  });

  it("SituationStarted", () => {
    const result = formatEvent(e("ss-1", "SituationStarted", { situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8 }, 5));
    expect(result!.text).toContain("Лесной пожар");
    expect(result!.text).toContain("8");
    expect(result!.text).not.toContain("forest_fire");
  });

  it("SituationEnded", () => {
    const result = formatEvent(e("se-1", "SituationEnded", { situationId: "forest_fire" }, 13));
    expect(result!.text).toContain("завершилась");
    expect(result!.text).toContain("Лесной пожар");
    expect(result!.text).not.toContain("forest_fire");
  });

  it("ForestFireStarted", () => {
    const result = formatEvent(e("ff-1", "ForestFireStarted", { startedAt: 5 }, 5));
    expect(result!.text).toBe("Лесной пожар начался.");
  });

  it("TreeBurned", () => {
    const result = formatEvent(e("tb-1", "TreeBurned", { burnedAt: 7, treeIndex: 3 }, 7));
    expect(result!.text).toContain("#3");
  });

  it("RelationChanged", () => {
    const result = formatEvent(e("rc-1", "RelationChanged", { from: "player", to: "guild", kind: "help", delta: 1 }, 3));
    expect(result!.text).toContain("help");
    expect(result!.text).toContain("guild");
    expect(result!.text).toContain("1");
  });

  it("HeatRadiated", () => {
    const result = formatEvent(e("hr-1", "HeatRadiated", { x: 1, y: 1, delta: 5 }, 3));
    expect(result!.text).toContain("(1, 1)");
    expect(result!.text).toContain("5");
  });

  it("TickPassed with playerOffline", () => {
    const result = formatEvent(e("t-1", "TickPassed", { delta: 1, playerOffline: true }, 3));
    expect(result!.text).toBe("Время идёт без тебя...");
  });

  it("TickPassed without playerOffline returns null", () => {
    const result = formatEvent(e("t-2", "TickPassed", { delta: 1 }, 3));
    expect(result).toBeNull();
  });

  it("PlayerSpawned returns null", () => {
    expect(formatEvent(e("p-1", "PlayerSpawned", { x: 0, y: 0 }, 0))).toBeNull();
  });

  it("WallPlaced returns null", () => {
    expect(formatEvent(e("w-1", "WallPlaced", { x: 2, y: 0 }, 0))).toBeNull();
  });

  it("MoveRequested returns null", () => {
    expect(formatEvent(e("mr-1", "MoveRequested", { direction: "north" }, 1))).toBeNull();
  });

  it("ActionValidated returns null", () => {
    expect(formatEvent(e("av-1", "ActionValidated", { actionType: "MoveRequested" }, 1))).toBeNull();
  });

  it("does not mutate input event", () => {
    const event = e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 3);
    const before = JSON.stringify(event);
    formatEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });
});

describe("formatWorldState", () => {
  it("empty world — 1 entry", () => {
    const entries = formatWorldState(emptyWorld());
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.text).toBe("Ты находишься на позиции (0, 0).");
  });

  it("includes observations with whitelist keys", () => {
    const obs = new Map<string, number>([["risk_taken", 3], ["wall_caution", 1], ["internal", 5]]);
    const w = Object.freeze({ ...emptyWorld(), observations: obs }) as unknown as ReadonlyWorld;
    const entries = formatWorldState(w);
    const texts = entries.map((e) => e.text);
    expect(texts.some((t) => t.includes("Тревожный след = 3"))).toBe(true);
    expect(texts.some((t) => t.includes("Память преграды = 1"))).toBe(true);
    expect(texts.some((t) => t.includes("internal = 5"))).toBe(false);
    expect(texts.some((t) => t.includes("wall_caution"))).toBe(false);
  });

  it("includes consequences", () => {
    const c: Consequence = { id: "aud@1", type: "audacity", severity: 1, createdAt: 3, expiresAt: 10, data: {} };
    const map = new Map<string, Consequence>([["aud@1", c]]);
    const w = Object.freeze({ ...emptyWorld(), consequences: map }) as unknown as ReadonlyWorld;
    const entries = formatWorldState(w);
    expect(entries.some((e) => e.text.includes("audacity") && e.text.includes("10"))).toBe(true);
  });

  it("includes firedConsequences", () => {
    const f: FiredConsequence = { consequenceId: "aud@1", consequenceType: "audacity", firedAt: 8 };
    const map = new Map<string, FiredConsequence>([["aud@1", f]]);
    const w = Object.freeze({ ...emptyWorld(), firedConsequences: map }) as unknown as ReadonlyWorld;
    const entries = formatWorldState(w);
    expect(entries.some((e) => e.text.includes("помнит") && e.text.includes("audacity"))).toBe(true);
  });

  it("includes active situations", () => {
    const s: ActiveSituation = { situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8, data: {} };
    const map = new Map<string, ActiveSituation>([["forest_fire", s]]);
    const w = Object.freeze({ ...emptyWorld(), activeSituations: map }) as unknown as ReadonlyWorld;
    const entries = formatWorldState(w);
    expect(entries.some((e) => e.text.includes("активна") && e.text.includes("Лесной пожар"))).toBe(true);
    expect(entries.some((e) => e.text.includes("forest_fire"))).toBe(false);
  });

  it("includes burned trees", () => {
    const w = Object.freeze({ ...emptyWorld(), burnedTrees: 3 }) as unknown as ReadonlyWorld;
    const entries = formatWorldState(w);
    expect(entries.some((e) => e.text.includes("Сожжено") && e.text.includes("3"))).toBe(true);
  });

  it("includes relations", () => {
    const r: RelationEdge = { from: "player", to: "guild", kind: "help", value: 2 };
    const map = new Map<string, RelationEdge>([["player>guild:help", r]]);
    const w = Object.freeze({ ...emptyWorld(), relations: map }) as unknown as ReadonlyWorld;
    const entries = formatWorldState(w);
    expect(entries.some((e) => e.text.includes("'help'"))).toBe(true);
  });

  it("does not mutate the world", () => {
    const w = emptyWorld();
    const obsBefore = w.observations.size;
    formatWorldState(w);
    expect(w.observations.size).toBe(obsBefore);
  });
});

describe("situationLabel + sanitize", () => {
  it("maps known situation types to player-facing titles", () => {
    expect(situationLabel("forest_fire")).toBe("Лесной пожар");
  });

  it("humanizes unknown types without leaking raw snake_case keys", () => {
    expect(situationLabel("unknown_process")).toBe("unknown process");
    expect(situationLabel("")).toBe("Ситуация");
  });

  it("sanitize replaces internal situation and observation keys in any text", () => {
    expect(sanitizePlayerFacingText("forest_fire начался")).toContain("лесной пожар");
    expect(sanitizePlayerFacingText("след: wall_caution")).toContain("память преграды");
    expect(sanitizePlayerFacingText("чистый текст")).toBe("чистый текст");
  });

  it("relation target labels are humanized only when a canonical label exists", () => {
    expect(relationTargetLabelOrRaw("guild")).toBe("Местная община");
    expect(relationTargetLabelOrRaw("north")).toBe("north");
    expect(relationTargetLabelOrRaw("old cart")).toBe("old cart");
  });

  it("modern open-intent operations map to player-facing verbs", () => {
    expect(operationLabel("approach")).toBe("двигаться");
    expect(operationLabel("speak")).toBe("обратиться");
    expect(operationLabel("examine")).toBe("осмотреть");
    expect(operationLabel("bogus")).toBe("действовать");
  });
});

describe("buildNarrative", () => {
  it("empty events + empty world → 1 world entry", () => {
    const snapshot = buildNarrative([], emptyWorld());
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.entries.some((e) => e.text.includes("находишься"))).toBe(true);
    expect(snapshot.worldTime).toBe(5);
    expect(snapshot.playerPosition).toEqual({ x: 0, y: 0 });
  });

  it("events + world entries sorted by timestamp", () => {
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 2),
      e("m-2", "MovementSucceeded", { x: 0, y: 2 }, 1),
    ];
    const snapshot = buildNarrative(events, emptyWorld());
    expect(snapshot.entries.length).toBe(3);
    expect(snapshot.entries[0]!.timestamp).toBeLessThanOrEqual(snapshot.entries[1]!.timestamp);
  });

  it("sinceTick filter excludes older events", () => {
    const events = [
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
      e("m-2", "MovementSucceeded", { x: 0, y: 2 }, 3),
    ];
    const snapshot = buildNarrative(events, emptyWorld(), { sinceTick: 2 });
    // MovementSucceeded at ts=1 should be excluded, at ts=3 included
    const m1Entries = snapshot.entries.filter((en) => en.timestamp === 1);
    const m2Entries = snapshot.entries.filter((en) => en.timestamp === 3);
    expect(m1Entries.length).toBe(0);
    expect(m2Entries.length).toBeGreaterThan(0);
  });

  it("null events (bootstrap) are excluded", () => {
    const events = [
      e("ps-1", "PlayerSpawned", { x: 0, y: 0 }, 0),
      e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1),
    ];
    const snapshot = buildNarrative(events, emptyWorld());
    expect(snapshot.entries.some((e) => e.text.includes("находишься"))).toBe(true);
  });

  it("deterministic: same input → same output", () => {
    const events = [e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1)];
    const world = emptyWorld();
    const s1 = buildNarrative(events, world);
    const s2 = buildNarrative(events, world);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it("does not mutate input events array", () => {
    const events = [e("m-1", "MovementSucceeded", { x: 0, y: 1 }, 1)];
    const before = events.length;
    buildNarrative(events, emptyWorld());
    expect(events).toHaveLength(before);
  });
});
