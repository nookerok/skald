import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { rebuildProjection } from "../src/projection.js";
import {
  buildCausalChain,
  buildGameShellSnapshot,
  buildShellDelta,
} from "../src/game-shell/builder.js";

function event(
  type: string,
  eventId: string,
  timestamp: number,
  payload: Record<string, unknown> = {},
  correlationId = `corr-${timestamp}`,
  causationId: string | null = null,
): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId, causationId };
}

function world(events: DomainEvent[]) {
  return rebuildProjection(events).getSnapshot();
}

const profile = {
  display_name: "Ирина",
  wound: "Боится забыть дорогу домой",
  promise: "Вернуться до зимы",
  principle: "Не оставлять следов",
};

describe("Game Shell read model", () => {
  it("builds a deterministic deeply frozen empty snapshot", () => {
    const first = buildGameShellSnapshot([], world([]), null, "empty-world");
    const second = buildGameShellSnapshot([], world([]), null, "empty-world");

    expect(first).toEqual(second);
    expect(first.worldId).toBe("empty-world");
    expect(first.revision).toEqual({ worldTime: 0, eventNumber: 0 });
    expect(first.lastTurn).toBeNull();
    expect(first.attention.level).toBe("calm");
    expect(() => { (first.character as { displayName: string }).displayName = "changed"; }).toThrow();
  });

  it("uses the stored profile and authoritative character effects", () => {
    const events = [
      event("ConsequenceCreated", "cons", 1, {
        id: "audacity-1", type: "audacity", severity: 2,
        createdAt: 1, expiresAt: 8, data: {},
      }),
      event("RelationChanged", "rel", 1, {
        from: "player", to: "guild", kind: "respect", delta: 3,
      }, "corr-1", "cons"),
    ];
    const result = buildGameShellSnapshot(events, world(events), profile, "profile-world");

    expect(result.character.displayName).toBe("Ирина");
    expect(result.character.wound).toBe(profile.wound);
    expect(result.character.consequences).toHaveLength(1);
    expect(result.character.relations).toContainEqual({ targetLabel: "Местная община", relationLabel: "Уважение", value: 3 });
  });

  it.each([
    [0, "calm", 0],
    [1, "stirring", 1],
    [3, "noticed", 3],
    [4, "watched", 4],
    [8, "pressured", 5],
    [-2, "calm", 0],
  ] as const)("maps risk_taken=%s to %s", (risk, level, marks) => {
    const events = risk === 0 ? [] : [
      event("ObservationUpdated", "risk", 1, { key: "risk_taken", delta: risk }),
    ];
    const result = buildGameShellSnapshot(events, world(events), null, "attention-world");

    expect(result.attention).toMatchObject({ level, marks, maxMarks: 5 });
    expect(result.attention).not.toHaveProperty("sourceEventIds");
  });

  it("renders and then removes an authoritative situation", () => {
    const started = event("SituationStarted", "start", 2, {
      situationId: "fire-1", type: "forest_fire", startedAt: 2, duration: 5, data: {},
    });
    const active = buildGameShellSnapshot([started], world([started]), null, "fire-world");
    expect(active.currentSituation).toMatchObject({
      situationId: "fire-1", title: "Лесной пожар", remainingTicks: 5,
    });

    const ended = event("SituationEnded", "end", 3, { situationId: "fire-1" }, "corr-3", "start");
    const finished = buildGameShellSnapshot([started, ended], world([started, ended]), null, "fire-world");
    expect(finished.currentSituation).toBeNull();
  });

  it("follows causation edges and excludes merely correlated events", () => {
    const events = [
      event("MoveRequested", "root", 1, { direction: "north" }, "turn"),
      event("MovementSucceeded", "moved", 1, { x: 0, y: 1 }, "turn", "root"),
      event("ObservationUpdated", "risk", 1, { key: "risk_taken", delta: 1 }, "turn", "moved"),
      event("RelationChanged", "unrelated", 1, { from: "player", to: "guild", kind: "trust", delta: 1 }, "turn"),
      event("TickPassed", "other", 1, { delta: 1 }, "other-turn"),
    ];

    expect(buildCausalChain(events, 1).map((step) => step.text)).toEqual([
      "Ты пытаешься сделать шаг.", "Путь оказался свободен.", "Мир заметил твой поступок.",
    ]);
  });

  it("does not describe a social intention as movement", () => {
    const events = [event("GiveRequested", "give", 1, { targetId: "guild" }, "give-turn")];
    expect(buildCausalChain(events, 1)[0]?.text).toContain("отношения");
  });

  it("classifies activity from source events and skips unclassified entries", () => {
    const events = [
      event("ObservationUpdated", "risk", 1, { key: "risk_taken", delta: 1 }),
      event("ConsequenceFired", "cons", 2, {
        consequenceId: "audacity-1", consequenceType: "audacity", firedAt: 2,
      }),
      event("TickPassed", "tick", 3, { delta: 1, playerOffline: true }),
    ];
    const result = buildGameShellSnapshot(events, world(events), null, "activity-world");

    expect(result.recentActivity).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: "consequence", scope: "visible" }),
      expect.objectContaining({ origin: "world_tick", scope: "known" }),
    ]));
    expect(result.recentActivity.every((item) => !Object.hasOwn(item, "sourceEventIds"))).toBe(true);
  });

  it("shows discovery signals only for the latest turn", () => {
    const events = [
      event("MoveRequested", "move", 1),
      event("MovementSucceeded", "moved", 1, { x: 0, y: 1 }, "corr-1", "move"),
      event("ObservationUpdated", "risk", 1, { key: "risk_taken", delta: 1 }, "corr-1", "moved"),
      event("TickPassed", "tick", 2, { delta: 1 }),
    ];
    const result = buildGameShellSnapshot(events, world(events), null, "signals-world");

    expect(result.lastTurn?.worldTime).toBe(2);
    expect(result.lastTurn?.discoverySignals).toEqual([]);
    expect(result.knowledge.traces.length).toBeGreaterThan(0);
  });

  it("never exposes internal keys in player-facing shell DTO", () => {
    const events = [
      event("ObservationUpdated", "risk", 1, { key: "risk_taken", delta: 1 }),
      event("ObservationUpdated", "fear", 1, { key: "world_reaction_fear", delta: 1 }),
      event("ObservationUpdated", "edge", 1, { key: "edge_awareness", delta: 1 }),
      event("HeatRadiated", "heat", 1, { source: "heat:nearby", delta: 1 }),
      event("ConsequenceCreated", "cons", 1, { id: "audacity-1", type: "audacity", severity: 1, createdAt: 1, expiresAt: 8, data: {} }),
      event("MovementBlocked", "blocked", 1, { reason: "boundary" }),
      event("RelationChanged", "relation", 1, { from: "player", to: "guild", kind: "help", delta: 1 }),
    ];
    const snapshot = buildGameShellSnapshot(events, world(events), null, "privacy-world");
    const playerFacing = { character: snapshot.character, world: snapshot.world, currentSituation: snapshot.currentSituation, lastTurn: snapshot.lastTurn, recentActivity: snapshot.recentActivity, knowledge: snapshot.knowledge };
    const serialized = JSON.stringify(playerFacing);
    for (const key of ["risk_taken", "heat:nearby", "audacity", "world_reaction_fear", "boundary", "edge_awareness", "guild"]) {
      expect(serialized).not.toContain(key);
    }
  });

  it("is replay deterministic and emits a frozen current-revision delta", () => {
    const events = [
      event("MoveRequested", "move", 1),
      event("MovementSucceeded", "moved", 1, { x: 0, y: 1 }, "corr-1", "move"),
    ];
    const rebuiltA = world(events);
    const rebuiltB = world(structuredClone(events));

    expect(buildGameShellSnapshot(events, rebuiltA, profile, "replay-world"))
      .toEqual(buildGameShellSnapshot(structuredClone(events), rebuiltB, profile, "replay-world"));

    const delta = buildShellDelta(events, rebuiltA);
    expect(delta.revision).toEqual({ worldTime: rebuiltA.time, eventNumber: rebuiltA.eventNumber });
    expect(() => { (delta.activity as unknown[]).push({}); }).toThrow();
  });
  it("renders critical check stakes and arithmetic as player-facing text", () => {
    const events = [
      event("ActionAttempted", "attempt", 4, { operation: "apply_force", target: { raw: "дверь" } }, "critical"),
      event("CriticalCheckRequested", "request", 4, {
        stakes: { success: "Дверь открывается.", failure: "Дверь остаётся закрытой." },
        difficulty: 15,
        modifiers: [{ label: "Повреждение", delta: 2 }],
      }, "critical", "attempt"),
      event("CriticalCheckRolled", "roll", 4, {
        naturalRoll: 14, modifierTotal: 2, total: 16, difficulty: 15,
      }, "critical", "request"),
      event("CriticalCheckResolved", "resolved", 4, {
        total: 16, difficulty: 15, outcome: "success",
      }, "critical", "roll"),
    ];
    const chain = buildCausalChain(events, 4);
    expect(chain.map((step) => step.text).join(" ")).toContain("Сложность: 15");
    expect(chain.map((step) => step.text).join(" ")).toContain("Модификаторы: Повреждение +2");
    expect(chain.map((step) => step.text).join(" ")).toContain("Бросок: 14");
    expect(chain.map((step) => step.text).join(" ")).toContain("Итого 16 против 15");
    const check = chain.find((step) => step.critical);
    expect(check?.critical).toMatchObject({
      success: "Дверь открывается.",
      failure: "Дверь остаётся закрытой.",
      difficulty: 15,
      modifiers: [{ label: "Повреждение", delta: 2 }],
    });
  });

});