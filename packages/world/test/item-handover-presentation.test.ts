import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../src/projection.js";
import { ITEM_GIVEN } from "../src/presentation/templates.js";
import { selectTurnPresentation } from "../src/presentation/selector.js";

function world(name = "Обломок дорожного знака"): ReadonlyWorld {
  return {
    time: 1,
    player: { x: 0, y: 0 },
    objects: new Map([["item:carried", { id: "item:carried", name }]]),
    entities: new Map([["contact:secret", { name: "Тайное каноническое имя" }]]),
  } as unknown as ReadonlyWorld;
}

function given(overrides: Record<string, unknown> = {}): DomainEvent {
  return {
    eventId: "give-result", type: "ItemMoved", schemaVersion: 1, timestamp: 1,
    correlationId: "give-command", causationId: "validated-give",
    payload: {
      itemId: "item:carried", reason: "given", subjectId: "player",
      from: { kind: "carried", holderId: "player" },
      to: { kind: "carried", holderId: "contact:secret" },
      ...overrides,
    },
  };
}

describe("completed item handover presentation", () => {
  it("renders a required action result with canonical event provenance", () => {
    const event = given();
    const snapshot = world();
    const candidate = ITEM_GIVEN.present(event, snapshot);
    expect(candidate).toMatchObject({
      kind: "action", defaultImportance: "primary", epistemicClass: "established_fact",
      text: "Ты передаёшь «Обломок дорожного знака».", sourceEventIds: [event.eventId],
    });
    const presentation = selectTurnPresentation([event], snapshot);
    expect(presentation.response).toMatchObject({
      kind: "action_outcome", text: candidate!.text, sourceEventIds: [event.eventId],
    });
    expect(presentation.primary?.text).toBe(candidate!.text);
    expect(JSON.stringify(presentation)).not.toMatch(/contact:secret|Тайное каноническое имя|item:carried/);
  });

  it("does not label another actor's transfer as the player's action", () => {
    const event = given({ subjectId: "npc", from: { kind: "carried", holderId: "npc" } });
    expect(ITEM_GIVEN.present(event, world())).toBeNull();
    const presentation = selectTurnPresentation([event], world());
    expect(presentation.response).toBeNull();
    expect(presentation.primary).toBeNull();
  });

  it("ignores other moves and invalid handover shapes", () => {
    for (const event of [
      given({ reason: "taken" }),
      given({ to: { kind: "carried", holderId: "player" } }),
      given({ from: { kind: "ground" } }),
      given({ to: { kind: "container", containerId: "box" } }),
    ]) expect(ITEM_GIVEN.present(event, world())).toBeNull();
  });

  it("falls back without exposing internal item labels", () => {
    expect(ITEM_GIVEN.present(given(), world("object_hidden_17"))?.text).toBe("Ты передаёшь предмет.");
    expect(ITEM_GIVEN.present(given({ itemId: "missing:internal" }), world())?.text).toBe("Ты передаёшь предмет.");
  });
});
