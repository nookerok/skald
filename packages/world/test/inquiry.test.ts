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

describe("focused scene questions", () => {
  function focused(rawText: string, surface: string, relation?: "behind" | "near" | "inside" | "beyond", observerRef?: string) {
    return {
      type: "InquiryRequest" as const,
      queryId: "visible_scene" as const,
      rawText,
      confidence: 1 as const,
      source: "deterministic" as const,
      focus: observerRef ? { observerRef, surface } : { surface },
      ...(relation ? { relation } : {}),
    };
  }

  it("quotes shell prose mentioning an explicit-noun focus", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(focused("что за водой?", "водой", "behind"), { shell, background });

    expect(result.queryId).toBe("visible_scene");
    expect(result.answer).toContain("Камни скрыты высокой водой");
    expect(result.revision).toEqual({ worldTime: 0, eventNumber: 2 });
  });

  it("answers honestly when the focus is unknown", () => {
    const { shell, background } = context();
    const before = JSON.stringify({ shell, background });
    const result = buildInquiryAnswer(focused("что за башней?", "башней", "behind"), { shell, background });

    expect(result.answer).toContain("башней");
    expect(result.answer).toMatch(/не различить|пока ничего нет/);
    expect(result.answer).not.toContain("crossing");
    expect(JSON.stringify({ shell, background })).toBe(before);
  });

  it("does not guess at pronoun focus", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(focused("а что за ней?", "ней", "behind"), { shell, background });

    expect(result.answer).toMatch(/не различить|пока ничего нет/);
  });

  it("treats a present observerRef as validation-side metadata only", () => {
    const { shell, background } = context();
    const plain = buildInquiryAnswer(focused("что за водой?", "водой", "behind"), { shell, background });
    const withRef = buildInquiryAnswer(focused("что за водой?", "водой", "behind", "object_1"), { shell, background });

    expect(withRef).toEqual(plain);
  });

  it("leaves other queries unaffected by focus", () => {
    const { shell, background } = context();
    const request = {
      type: "InquiryRequest" as const,
      queryId: "current_location" as const,
      rawText: "где я?",
      confidence: 1 as const,
      source: "deterministic" as const,
      focus: { surface: "водой" },
    };
    const result = buildInquiryAnswer(request, { shell, background });

    expect(result.answer).toContain("Переправа у Чёрного леса");
  });
});

describe("who is nearby", () => {
  function whoRequest() {
    return {
      type: "InquiryRequest" as const,
      queryId: "who_is_nearby" as const,
      rawText: "кто рядом?",
      confidence: 1 as const,
      source: "deterministic" as const,
    };
  }

  function sceneWithPeople(labels: readonly string[]) {
    return {
      knownPeople: labels.map((label, index) => ({ observerRef: `person_${index + 1}`, kind: "person" as const, label, knownAs: [label] })),
    } as any;
  }

  it("lists observer-safe scene people by label", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(whoRequest(), { shell, background, scene: sceneWithPeople(["Перевозчик у переправы", "Страж"]) });

    expect(result.queryId).toBe("who_is_nearby");
    expect(result.answer).toContain("Перевозчик у переправы");
    expect(result.answer).toContain("Страж");
    expect(result.answer).not.toContain("person_1");
  });

  it("honestly reports nobody distinguishable without a scene", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(whoRequest(), { shell, background });

    expect(result.answer).toMatch(/никого различимого нет/);
  });

  it("honestly reports nobody distinguishable with an empty scene", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(whoRequest(), { shell, background, scene: sceneWithPeople([]) });

    expect(result.answer).toMatch(/никого различимого нет/);
  });
});
