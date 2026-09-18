/**
 * Continuation momentum on deterministic master answers (plan_9 §10).
 *
 * The fourth part of the answer — a natural continuation possibility —
 * must also work without an LLM: the production draft builders accept an
 * observer-safe hint and append it through ensureGameMomentum only when
 * the assembled prose does not already move the game. Without a hint the
 * drafts stay byte-identical to the legacy output.
 */

import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import { WorldProjector, createRules, hasGameMomentum } from "@skald/world";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";
import {
  buildActionConversationTurn,
  buildMixedConversationTurn,
  buildSpeechConversationTurn,
} from "../src/conversation/builder.js";

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function bootCamp() {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const preEvents: DomainEvent[] = [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: [], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
  ];
  for (const bootstrap of preEvents) {
    projection.apply(bootstrap);
    bus.append(bootstrap);
  }
  return { engine: new RuleEngine(createRules(), projection, bus), projection, preEvents };
}

const HINT = "Можно расспросить перевозчика о том, что изменилось.";

function lookAround(id: string, timestamp = 1): DomainEvent {
  return {
    eventId: `look-${id}`,
    type: "ActionAttempted",
    schemaVersion: 1,
    payload: {
      mode: "observe",
      operation: "examine",
      target: "окрестности",
      secondaryTarget: null,
      instrument: null,
      manner: null,
      goal: null,
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    },
    timestamp,
    correlationId: "test",
    causationId: null,
  };
}

function actionTurn(staged: readonly DomainEvent[], projectedWorld: ReturnType<WorldProjector["getSnapshot"]>, continuationHint?: string | null) {
  return buildActionConversationTurn({
    worldId: LEGACY_WORLD_ID,
    correlationId: "cmd-1",
    idempotencyKey: "hint-1",
    playerText: "осмотреться",
    worldTimeBefore: 0,
    stagedEvents: staged,
    projectedWorld,
    ...(continuationHint !== undefined ? { continuationHint } : {}),
  });
}

describe("deterministic continuation momentum (plan_9 §10)", () => {
  it("keeps action drafts byte-identical when no hint is passed or the hint is empty", () => {
    const { engine, projection } = bootCamp();
    const staged = engine.process(lookAround("1")).committed;
    const projectedWorld = projection.getSnapshot();
    const legacy = actionTurn(staged, projectedWorld);
    const explicitNull = actionTurn(staged, projectedWorld, null);
    const empty = actionTurn(staged, projectedWorld, "   ");
    expect(explicitNull.responseText).toBe(legacy.responseText);
    expect(empty.responseText).toBe(legacy.responseText);
  });

  it("appends the hint to an action draft whose prose carries no momentum", () => {
    const { engine, projection } = bootCamp();
    const staged = engine.process(lookAround("2")).committed;
    const projectedWorld = projection.getSnapshot();
    const base = actionTurn(staged, projectedWorld).responseText;
    const hinted = actionTurn(staged, projectedWorld, HINT).responseText;
    if (hasGameMomentum(base)) {
      expect(hinted).toBe(base);
    } else {
      expect(hinted).toBe(`${base} ${HINT}`);
    }
    // The plan §10 invariant: the assembled answer leaves the game moving.
    expect(hasGameMomentum(hinted)).toBe(true);
  });

  it("appends the hint to a speech draft without changing its kind", () => {
    const { engine, projection } = bootCamp();
    const staged = engine.process(lookAround("4")).committed;
    const projectedWorld = projection.getSnapshot();
    const base = buildSpeechConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-2",
      idempotencyKey: "hint-2",
      playerText: "Приветствую лагерь.",
      worldTimeBefore: 0,
      stagedEvents: staged,
      projectedWorld,
    }).responseText;
    const draft = buildSpeechConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-2",
      idempotencyKey: "hint-2",
      playerText: "Приветствую лагерь.",
      worldTimeBefore: 0,
      stagedEvents: staged,
      projectedWorld,
      continuationHint: HINT,
    });
    expect(draft.responseKind).toBe("speech_reaction");
    if (hasGameMomentum(base)) {
      expect(draft.responseText).toBe(base);
    } else {
      expect(draft.responseText).toBe(`${base} ${HINT}`);
    }
  });

  it("carries the hint into the composed mixed response", () => {
    const { engine, projection } = bootCamp();
    const staged = engine.process(lookAround("5")).committed;
    const projectedWorld = projection.getSnapshot();
    const base = buildMixedConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-3",
      idempotencyKey: "hint-3",
      playerText: "осмотрюсь и подумаю",
      worldTimeBefore: 0,
      preEvents: [],
      stagedEvents: staged,
      projectedWorld,
      profile: null,
      characterProfile: null,
      inquiries: [],
      deferred: [],
    }).responseText;
    const hinted = buildMixedConversationTurn({
      worldId: LEGACY_WORLD_ID,
      correlationId: "cmd-3",
      idempotencyKey: "hint-4",
      playerText: "осмотрюсь и подумаю",
      worldTimeBefore: 0,
      preEvents: [],
      stagedEvents: staged,
      projectedWorld,
      profile: null,
      characterProfile: null,
      inquiries: [],
      deferred: [],
      continuationHint: HINT,
    }).responseText;
    expect(hinted).toBe(hasGameMomentum(base) ? base : `${base} ${HINT}`);
  });
});
