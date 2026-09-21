/**
 * Opening Situation at the crossing (plan: simulation-backed opening problem).
 *
 * Observable start: the player's own observation of the crossing's water
 * traces / upper stones raises a crossing watch. The situation carries its
 * participants, stakes and ways forward; a reopened crossing resolves it.
 * No new event types, no QuestManager.
 */

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  OPENING_SITUATION_ID,
  OPENING_SITUATION_TYPE,
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  buildNarrativeAdapterContext,
  crossingWatchResolve,
  crossingWatchStart,
  getRegionEntrypoint,
  rebuildProjection,
} from "@skald/world";

function event(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

function livingEvents(): readonly DomainEvent[] {
  return buildBootstrapEvents({
    templateId: "living_region",
    entrypointId: "river_waystation_arrival",
    backgroundId: "keeper",
  });
}

describe("opening situation at the crossing", () => {
  it("starts on the player's own observation of the crossing water traces", () => {
    const world = rebuildProjection(livingEvents()).getSnapshot();
    const observed = event("ObjectObserved", "obs-water", {
      objectId: "water_trace_marks",
      name: "Следы воды на настиле",
      description: "На настиле остались тёмные следы воды выше обычного уровня.",
    });
    const started = crossingWatchStart.handle(observed, world);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      type: "SituationStarted",
      causationId: "obs-water",
      payload: { situationId: OPENING_SITUATION_ID, type: OPENING_SITUATION_TYPE },
    });
    const data = (started[0]!.payload as { data: { approaches: readonly string[] } }).data;
    expect(data.approaches.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores objects that are not part of the crossing", () => {
    const world = rebuildProjection(livingEvents()).getSnapshot();
    expect(crossingWatchStart.handle(event("ObjectObserved", "obs-other", { objectId: "old_ruins_masonry" }), world)).toHaveLength(0);
  });

  it("does not start twice while the watch stands", () => {
    let events = livingEvents();
    const observed = event("ObjectObserved", "obs-water", { objectId: "crossing_upper_stones" });
    events = [...events, observed, ...crossingWatchStart.handle(observed, rebuildProjection(events).getSnapshot())];
    const world = rebuildProjection(events).getSnapshot();
    expect(world.activeSituations.has(OPENING_SITUATION_ID)).toBe(true);
    expect(crossingWatchStart.handle(event("ObjectObserved", "obs-again", { objectId: "water_trace_marks" }), world)).toHaveLength(0);
  });

  it("exposes the situation to the scene once the player has observed it", () => {
    let events = livingEvents();
    const observed = event("ObjectObserved", "obs-water", {
      objectId: "water_trace_marks",
      name: "Следы воды на настиле",
      description: "На настиле остались тёмные следы воды выше обычного уровня.",
    });
    events = [...events, observed, ...crossingWatchStart.handle(observed, rebuildProjection(events).getSnapshot())];
    const world = rebuildProjection(events).getSnapshot();
    const narrative = buildNarrativeAdapterContext(events, world, {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
      characterName: "Виктор",
    });
    const scene = buildMasterTurnSceneContext(events, world, narrative);
    expect(scene.context.currentSituation?.title).toContain("Переправа");
  });

  it("resolves early when the crossing reopens", () => {
    let events = livingEvents();
    const observed = event("ObjectObserved", "obs-water", { objectId: "water_trace_marks" });
    events = [...events, observed, ...crossingWatchStart.handle(observed, rebuildProjection(events).getSnapshot())];
    const world = rebuildProjection(events).getSnapshot();

    expect(crossingWatchResolve.handle(event("CrossingConditionChanged", "ccc-1", { condition: "difficult" }), world)).toHaveLength(0);
    const resolved = crossingWatchResolve.handle(event("CrossingConditionChanged", "ccc-2", { condition: "open" }), world);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ type: "SituationEnded", payload: { situationId: OPENING_SITUATION_ID } });

    const after = rebuildProjection([...events, ...resolved]).getSnapshot();
    expect(after.activeSituations.has(OPENING_SITUATION_ID)).toBe(false);
  });
});
