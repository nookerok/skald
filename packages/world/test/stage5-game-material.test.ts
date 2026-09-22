/**
 * Stage 5 game material: the authored situation carries an open question,
 * stakes and distinct approaches into the observer-safe scene and the scene
 * rhythm, without inventing a menu.
 */

import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildMasterTurnSceneContext,
  buildObserverGuidanceContext,
} from "@skald/world";
import { buildSceneRhythm } from "../src/game-director/scene-rhythm.js";

const MATERIAL = {
  approaches: ["осмотреть следы воды", "расспросить перевозчика", "найти обход или дождаться спада"],
  stakes: "к Речному Стражу не пройти напрямую, пока переправа трудная",
  completion: "понять причину подъёма воды, найти обход или дождаться спада",
};

function situationEvent(): DomainEvent {
  return {
    eventId: "sit-1",
    type: "SituationStarted",
    schemaVersion: 1,
    payload: {
      situationId: "river_waystation_flood",
      type: "crossing_watch",
      startedAt: 1,
      duration: 12,
      data: { participant: "carrier", ...MATERIAL },
    },
    timestamp: 1,
    correlationId: "c",
    causationId: null,
  };
}

function worldWithSituation() {
  const projection = new WorldProjector();
  const bus = new EventBus();
  for (const entry of [situationEvent()]) { projection.apply(entry); bus.append(entry); }
  return { events: bus.query(), world: projection.getSnapshot() };
}

describe("Stage 5 — authored situation material", () => {
  it("carries approaches, stakes and completion into the guidance view", () => {
    const { events, world } = worldWithSituation();
    const situation = buildObserverGuidanceContext(events, world).activeSituation;
    expect(situation?.masterMaterial).toEqual(MATERIAL);
  });

  it("carries the material into the observer-safe master scene", () => {
    const { events, world } = worldWithSituation();
    const scene = buildMasterTurnSceneContext(events, world).context;
    expect(scene.currentSituation).toMatchObject(MATERIAL);
  });

  it("exposes the approaches, stakes and completion through the scene rhythm", () => {
    const { events, world } = worldWithSituation();
    const scene = buildMasterTurnSceneContext(events, world).context;
    const rhythm = buildSceneRhythm({
      situation: scene.currentSituation,
      journey: { status: "idle", from: null, to: null, elapsedTicks: 0, totalTicks: 0, text: "" },
      recentConsequences: [],
    });
    expect(rhythm.approaches).toEqual(MATERIAL.approaches);
    expect(rhythm.pressure).toBe(MATERIAL.stakes);
    expect(rhythm.completionCondition).toBe(MATERIAL.completion);
  });
});
