import { describe, expect, it } from "vitest";
import { buildGameShellSnapshot } from "../src/game-shell/builder.js";
import { buildInquiryAnswer } from "../src/inquiry/index.js";
import { rebuildProjection } from "../src/projection.js";
import type { DomainEvent } from "@skald/event-bus";

function event(type: string, eventId: string, timestamp: number, payload: Record<string, unknown>): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: eventId, causationId: null };
}

function context() {
  const events = [
    event("LocationDefined", "location", 0, {
      id: "crossing", name: "Переправа у Чёрного леса", description: "Камни скрыты высокой водой.", objectIds: [], connections: {},
    }),
    event("PlayerLocationChanged", "position", 0, { locationId: "crossing" }),
  ];
  const world = rebuildProjection(events).getSnapshot();
  const shell = buildGameShellSnapshot(events, world, { display_name: "Зоя", wound: "Память архива", promise: "Сохранить запись", principle: "Не искажать свидетельства" }, "inquiry-world");
  return { shell, background: null };
}

describe("read-only inquiry builder", () => {
  it("answers from the current observer shell", () => {
    const result = buildInquiryAnswer({ type: "InquiryRequest", queryId: "current_location", rawText: "где я?", confidence: 1, source: "deterministic" }, context());
    expect(result.answer).toContain("Переправа у Чёрного леса");
    expect(result.revision).toEqual({ worldTime: 0, eventNumber: 2 });
  });

  it("does not expose hidden route ids or canonical state", () => {
    const result = buildInquiryAnswer({ type: "InquiryRequest", queryId: "available_routes", rawText: "куда можно пойти?", confidence: 1, source: "deterministic" }, context());
    expect(result.answer).not.toContain("crossing");
    expect(result.answer).toContain("Известного маршрута");
  });

  it("returns the same answer for the same shell revision", () => {
    const request = { type: "InquiryRequest" as const, queryId: "map_position" as const, rawText: "где я на карте?", confidence: 1, source: "deterministic" as const };
    expect(buildInquiryAnswer(request, context())).toEqual(buildInquiryAnswer(request, context()));
  });
});
