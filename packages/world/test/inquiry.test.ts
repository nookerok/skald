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

  it("never repeats one scene line twice in a visible-scene answer", () => {
    const { shell, background } = context();
    const locationLine = shell.world.locationDescription ?? "";
    expect(locationLine.length).toBeGreaterThan(0);
    // The previous turn's primary is normally the current location line, so
    // the raw parts would hold the same sentence twice.
    const patched = { ...shell, lastTurn: { primary: { text: locationLine }, notable: [] } };
    const result = buildInquiryAnswer(
      { type: "InquiryRequest", queryId: "visible_scene", rawText: "что я вижу?", confidence: 1, source: "deterministic" },
      { shell: patched as never, background },
    );
    expect(result.answer.split(locationLine).length - 1).toBe(1);
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

  it("renders one character arriving through several sources once (review P2)", () => {
    const { shell, background } = context();
    const scene = {
      knownPeople: [
        { observerRef: "person_1", kind: "person" as const, label: "Перевозчик у переправы", knownAs: ["Перевозчик у переправы"] },
        { observerRef: "person_1", kind: "person" as const, label: "Перевозчик у переправы", knownAs: ["Перевозчик у переправы"] },
        { observerRef: "person_3", kind: "person" as const, label: "Страж", knownAs: ["Страж"] },
      ],
    } as any;
    const result = buildInquiryAnswer(whoRequest(), { shell, background, scene });

    expect(result.answer.match(/Перевозчик у переправы/g)).toHaveLength(1);
    expect(result.answer).toContain("Страж");
  });

  it("marks distinct same-named people instead of merging them silently (review P2)", () => {
    const { shell, background } = context();
    const scene = {
      knownPeople: [
        { observerRef: "person_1", kind: "person" as const, label: "Ночной перевозчик", knownAs: ["Ночной перевозчик"] },
        { observerRef: "person_2", kind: "person" as const, label: "Ночной перевозчик", knownAs: ["Ночной перевозчик"] },
      ],
    } as any;
    const result = buildInquiryAnswer(whoRequest(), { shell, background, scene });

    expect(result.answer).toContain("«Ночной перевозчик» (первый)");
    expect(result.answer).toContain("«Ночной перевозчик» (второй)");
  });

  it("renders a labeled later entry for a ref whose first entry had no label", () => {
    const { shell, background } = context();
    const scene = {
      knownPeople: [
        { observerRef: "person_1", kind: "person" as const, label: "  ", knownAs: ["  "] },
        { observerRef: "person_1", kind: "person" as const, label: "Страж", knownAs: ["Страж"] },
      ],
    } as any;
    const result = buildInquiryAnswer(whoRequest(), { shell, background, scene });

    expect(result.answer).toContain("Страж");
    expect(result.answer.match(/Страж/g)).toHaveLength(1);
  });
});

describe("environmental indication", () => {
  function indicationRequest(rawText: string, surface?: string) {
    return {
      type: "InquiryRequest" as const,
      queryId: "environmental_indication" as const,
      rawText,
      confidence: 1 as const,
      source: "deterministic" as const,
      ...(surface ? { focus: { surface } } : {}),
    };
  }

  it("quotes location prose mentioning water", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(indicationRequest("что подсказывает вода?"), { shell, background });

    expect(result.queryId).toBe("environmental_indication");
    expect(result.answer).toContain("Камни скрыты высокой водой");
  });

  it("matches a declined focus surface against shell prose", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(indicationRequest("что подсказывает вода?", "воде"), { shell, background });

    expect(result.answer).toContain("Камни скрыты высокой водой");
  });

  it("answers honestly when nothing signals", () => {
    const { shell, background } = context();
    const before = JSON.stringify({ shell, background });
    const result = buildInquiryAnswer(indicationRequest("что подсказывает дорога?", "дороге"), { shell, background });

    expect(result.answer).toMatch(/ничего особенного не/);
    expect(result.answer).not.toContain("crossing");
    expect(JSON.stringify({ shell, background })).toBe(before);
  });
});

describe("observational answers (full-master Stage 6 finding)", () => {
  it("describes the place instead of answering with a route list", () => {
    const { shell, background } = context();
    const result = buildInquiryAnswer(
      { type: "InquiryRequest", queryId: "current_location", rawText: "где я и что вижу?", confidence: 1, source: "deterministic" },
      { shell, background },
    );
    expect(result.answer).toContain("Переправа у Чёрного леса");
    expect(result.answer).toContain("Камни скрыты высокой водой");
    expect(result.answer).not.toContain("Из известных направлений");
  });

  it("visible scene includes seen knowledge and what is present, not one line", () => {
    const { shell, background } = context();
    const patched = {
      ...shell,
      knowledge: { ...shell.knowledge, entries: [{ category: "seen", text: "У воды видны свежие следы.", origin: "Ты заметил это сам.", status: "current", worldTime: 0 }] },
    };
    const scene = {
      knownTopics: [],
      visibleObjects: [{ observerRef: "object_1", kind: "object" as const, label: "Ограда", knownAs: ["Ограда"] }],
      knownPeople: [],
    };
    const result = buildInquiryAnswer(
      { type: "InquiryRequest", queryId: "visible_scene", rawText: "что я вижу?", confidence: 1, source: "deterministic" },
      { shell: patched as never, background, scene: scene as never },
    );
    expect(result.answer).toContain("Камни скрыты высокой водой");
    expect(result.answer).toContain("свежие следы");
    expect(result.answer).toContain("Ограда");
  });

  it("annotates a nearby person with the relation the player has", () => {
    const { shell, background } = context();
    const patched = {
      ...shell,
      character: { ...shell.character, relations: [{ targetLabel: "Перевозчик у переправы", relationLabel: "Знакомство" }] },
    };
    const scene = { knownPeople: [{ observerRef: "person_1", kind: "person" as const, label: "Перевозчик у переправы", knownAs: ["Перевозчик у переправы"] }] };
    const result = buildInquiryAnswer(
      { type: "InquiryRequest", queryId: "who_is_nearby", rawText: "кто рядом?", confidence: 1, source: "deterministic" },
      { shell: patched as never, background, scene: scene as never },
    );
    expect(result.answer).toContain("Перевозчик у переправы");
    expect(result.answer).toContain("знакомство");
    expect(result.answer).not.toContain("person_1");
  });
});
