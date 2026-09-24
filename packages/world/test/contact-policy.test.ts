/**
 * Contact policy (contact-identity T5): old saves stay intact, no retroactive
 * profile, no automatic merge, and answers about a missing profile stay honest.
 */

import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildGameShellSnapshot,
  buildInquiryAnswer,
  buildMasterTurnSceneContext,
} from "@skald/world";
import type { ReadonlyWorld } from "@skald/world";

const KEEPER = "contact:waystation-keeper";
const FERRYMAN = "contact:waystation-ferryman";

/**
 * An "old" world authored before T1–T4: the crossing entrypoint and the
 * `wanderer` background each placed their OWN contact with one name, and
 * neither carries a profile. This is exactly what the old Event Log holds.
 */
function oldWorldEvents(): readonly DomainEvent[] {
  const contact = (id: string, backgroundId: string | null): DomainEvent => ({
    eventId: "boot#" + id,
    type: "ObjectPlaced",
    schemaVersion: 1,
    payload: {
      entityId: id,
      x: 0,
      y: 0,
      name: "Перевозчик у переправы",
      aliases: [],
      description: "",
      components: { contact: backgroundId ? { locationId: "river_waystation", backgroundId } : { locationId: "river_waystation", entrypointId: "river_waystation_arrival" } },
    },
    timestamp: 0,
    correlationId: "boot",
    causationId: null,
  });
  const relation = (id: string): DomainEvent => ({
    eventId: "rel#" + id,
    type: "RelationChanged",
    schemaVersion: 1,
    payload: { from: "player", to: id, kind: "knows", delta: 1 },
    timestamp: 0,
    correlationId: "boot",
    causationId: null,
  });
  return [
    { eventId: "loc-crossing", type: "LocationDefined", schemaVersion: 1, payload: { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Настил у воды.", objectIds: [], connections: {} }, timestamp: 0, correlationId: "boot", causationId: null },
    { eventId: "loc-city", type: "LocationDefined", schemaVersion: 1, payload: { id: "riverwatch_city", name: "Речной Страж", description: "Город за стенами.", objectIds: [], connections: {} }, timestamp: 0, correlationId: "boot", causationId: null },
    { eventId: "pos", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId: "river_waystation" }, timestamp: 0, correlationId: "boot", causationId: null },
    contact(KEEPER, null),
    contact(FERRYMAN, "wanderer"),
    relation(KEEPER),
    relation(FERRYMAN),
  ];
}

function replayed(events: readonly DomainEvent[]): ReadonlyWorld {
  const projection = new WorldProjector();
  const bus = new EventBus();
  for (const event of events) { projection.apply(event); bus.append(event); }
  return projection.getSnapshot();
}

function askOld(queryId: string, rawText: string, focus: string | undefined, world: ReadonlyWorld, events: readonly DomainEvent[]) {
  const scene = buildMasterTurnSceneContext(events, world).context;
  const shell = buildGameShellSnapshot(events, world, null, "old-save");
  return buildInquiryAnswer(
    { type: "InquiryRequest", queryId, rawText, confidence: 1, source: "deterministic", ...(focus ? { focus: { surface: focus } } : {}) } as never,
    { shell, background: null, scene },
  );
}

describe("contact policy — old saves", () => {
  it("replays old events, keeps both entities, and adds no profile", () => {
    const events = oldWorldEvents();
    const world = replayed(events);
    expect(world.entities.has(KEEPER)).toBe(true);
    expect(world.entities.has(FERRYMAN)).toBe(true);
    // No retroactive profile: the old Event Log is not enriched.
    expect(world.entities.get(KEEPER)?.components.contact?.profile).toBeUndefined();
    expect(world.entities.get(FERRYMAN)?.components.contact?.profile).toBeUndefined();
    // The two same-named entities are never merged.
    expect(KEEPER).not.toBe(FERRYMAN);
  });

  it("lists both same-named people without an invented portrait", () => {
    const events = oldWorldEvents();
    const world = replayed(events);
    const result = askOld("who_is_nearby", "кто рядом?", undefined, world, events);
    expect(result.answer.match(/Перевозчик у переправы/g)?.length).toBe(2);
    expect(result.answer).not.toMatch(/плащ|седина|заплат/i);
  });

  it("answers neutrally when the profile is missing", () => {
    const events = oldWorldEvents();
    const world = replayed(events);
    const result = askOld("visible_scene", "как выглядит перевозчик?", "перевозчик", world, events);
    expect(result.answer).toMatch(/нет подробностей|не различить|не знаешь/i);
    expect(result.answer).not.toMatch(/плащ|седина|заплат/i);
  });

  it("keeps a known but absent person out of the present scene", () => {
    const events = oldWorldEvents();
    const moved = [...events, { eventId: "move", type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId: "riverwatch_city" }, timestamp: 1, correlationId: "move", causationId: null } as DomainEvent];
    const world = replayed(moved);
    const result = askOld("who_is_nearby", "кто рядом?", undefined, world, moved);
    expect(result.answer).toMatch(/никого|никто/i);
    expect(result.answer).not.toContain("Перевозчик у переправы");
  });
});
