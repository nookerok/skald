import { describe, expect, it } from "vitest";
import { bindTurnPronouns } from "../src/conversation/focus-stack.js";
import { EMPTY_MASTER_CONVERSATION } from "../src/conversation/context-builder.js";
import type { MasterConversationContext } from "../src/conversation/context-builder.js";
import type { MasterTurnSceneContext } from "@skald/world";

function scene(overrides: Partial<MasterTurnSceneContext> = {}): MasterTurnSceneContext {
  return {
    schemaVersion: 1,
    revision: { worldTime: 5, eventNumber: 41 },
    currentLocation: { name: "Переправа", description: "Шум воды." },
    visibleObjects: [
      { observerRef: "object_1", kind: "object", label: "Ограда", knownAs: ["Ограда"] },
      { observerRef: "object_2", kind: "object", label: "Двор", knownAs: ["Двор"] },
    ],
    knownPeople: [
      { observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: ["Перевозчик"] },
      { observerRef: "person_2", kind: "person", label: "Страж", knownAs: ["Страж"] },
    ],
    knownRoutes: [
      { observerRef: "route_1", kind: "route", label: "Переправа", knownAs: ["Переправа"], status: "open" },
    ],
    accessibleItems: [],
    availableActions: [],
    currentSituation: null,
    knownTopics: [
      { observerRef: "topic_1", category: "told", text: "Старое русло открывает путь.", status: "current" },
    ],
    ...overrides,
  };
}

function conversation(overrides: Partial<MasterConversationContext> = {}): MasterConversationContext {
  return {
    ...EMPTY_MASTER_CONVERSATION,
    recentTurns: [],
    recentFocus: [],
    pendingClarification: null,
    ...overrides,
  };
}

const EMPTY_CONVERSATION = conversation();

describe("turn focus stack", () => {
  it("binds nothing without pronouns", () => {
    expect(bindTurnPronouns("осматриваю реку", EMPTY_CONVERSATION, scene())).toEqual([]);
    expect(bindTurnPronouns("иду к Речной Страже", EMPTY_CONVERSATION, scene())).toEqual([]);
  });

  it("resolves a lone person to a single candidate", () => {
    const alone = scene({
      visibleObjects: [],
      knownPeople: [{ observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: ["Перевозчик"] }],
    });
    const [binding] = bindTurnPronouns("подойду к нему", EMPTY_CONVERSATION, alone);

    expect(binding?.pronoun).toBe("нему");
    expect(binding?.classes).toEqual(["person", "thing"]);
    expect(binding?.candidates).toEqual(["person_1"]);
    expect(binding?.resolution).toBe("single");
  });

  it("drops plural labels for a singular pronoun", () => {
    const mixed = scene({
      visibleObjects: [
        { observerRef: "object_1", kind: "object", label: "Письменные принадлежности", knownAs: ["Письменные принадлежности"] },
        { observerRef: "object_2", kind: "object", label: "Ограда", knownAs: ["Ограда"] },
      ],
      knownPeople: [
        { observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: ["Перевозчик"] },
      ],
    });
    const [binding] = bindTurnPronouns("подойду к нему", EMPTY_CONVERSATION, mixed);

    expect(binding?.candidates).toEqual(["object_2", "person_1"]);
    expect(binding?.candidates).not.toContain("object_1");
  });

  it("drops masculine-singular labels for a plural pronoun", () => {
    const mixed = scene({
      visibleObjects: [
        { observerRef: "object_1", kind: "object", label: "Ограда", knownAs: ["Ограда"] },
      ],
      knownPeople: [
        { observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: ["Перевозчик"] },
      ],
    });
    const [binding] = bindTurnPronouns("подойду к ним", EMPTY_CONVERSATION, mixed);

    expect(binding?.candidates).toEqual(["object_1"]);
  });

  it("leaves case-ambiguous pronouns unfiltered", () => {
    const mixed = scene({
      visibleObjects: [
        { observerRef: "object_1", kind: "object", label: "Письменные принадлежности", knownAs: ["Письменные принадлежности"] },
      ],
      knownPeople: [
        { observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: ["Перевозчик"] },
      ],
    });
    // Bare "им"/"ним" can be instrumental singular or dative plural: no
    // filtering. A preposition disambiguates ("к ним" is plural).
    for (const input of ["доволен им", "горжусь ним"]) {
      const [binding] = bindTurnPronouns(input, EMPTY_CONVERSATION, mixed);
      expect(binding?.candidates).toContain("object_1");
      expect(binding?.candidates).toContain("person_1");
    }
  });

  it("boosts the mentioned candidate but stays ambiguous with several people", () => {
    const mentioned = conversation({
      recentFocus: [{ kind: "target", surface: "перевозчику", turnSeq: 4 }],
    });
    const [binding] = bindTurnPronouns("подойду к нему", mentioned, scene());

    expect(binding?.candidates).toEqual(["person_1", "object_1", "object_2", "person_2"]);
    expect(binding?.resolution).toBe("ambiguous");
    expect(binding?.mention).toEqual({ surface: "перевозчику", turnSeq: 4 });
  });

  it("binds addressee and topic pronouns of one replica separately", () => {
    const bindings = bindTurnPronouns("спрошу у него об этом", EMPTY_CONVERSATION, scene());

    expect(bindings.map((binding) => binding.pronoun)).toEqual(["него", "этом"]);
    const addressee = bindings[0];
    expect(addressee?.preposition).toBe("у");
    expect(addressee?.resolution).toBe("ambiguous");
    const topic = bindings[1];
    expect(topic?.classes).toEqual(["topic"]);
    expect(topic?.preposition).toBe("об");
    expect(topic?.candidates).toEqual(["topic_1"]);
    expect(topic?.resolution).toBe("single");
  });

  it("ranks objects before people for a dual-form pronoun", () => {
    const [binding] = bindTurnPronouns("осмотрю её внимательнее", EMPTY_CONVERSATION, scene());

    expect(binding?.pronoun).toBe("ее");
    expect(binding?.preposition).toBeNull();
    expect(binding?.candidates).toEqual(["object_1", "object_2", "person_1", "person_2"]);
    expect(binding?.resolution).toBe("ambiguous");
  });

  it("narrows dual pronouns to people in speech-governed replicas", () => {
    const [binding] = bindTurnPronouns("спрошу у него", EMPTY_CONVERSATION, scene());

    expect(binding?.classes).toEqual(["person"]);
    expect(binding?.candidates).toEqual(["person_1", "person_2"]);
  });

  it("captures the spatial preposition of an inquiry pronoun", () => {
    const [binding] = bindTurnPronouns("а что за ней?", EMPTY_CONVERSATION, scene());

    expect(binding?.pronoun).toBe("ней");
    expect(binding?.preposition).toBe("за");
    expect(binding?.resolution).toBe("ambiguous");
  });

  it("reports missing with the stale mention when the candidate is gone", () => {
    const mentioned = conversation({
      recentFocus: [{ kind: "target", surface: "перевозчику", turnSeq: 4 }],
    });
    const empty = scene({ visibleObjects: [], knownPeople: [], knownRoutes: [], knownTopics: [] });
    const [binding] = bindTurnPronouns("подойду к нему", mentioned, empty);

    expect(binding?.candidates).toEqual([]);
    expect(binding?.resolution).toBe("missing");
    expect(binding?.mention).toEqual({ surface: "перевозчику", turnSeq: 4 });
  });

  it("resolves locative adverbs to known routes", () => {
    const [binding] = bindTurnPronouns("пойду туда", EMPTY_CONVERSATION, scene());

    expect(binding?.classes).toEqual(["place"]);
    expect(binding?.candidates).toEqual(["route_1"]);
    expect(binding?.resolution).toBe("single");
  });

  it("reports missing topics when none are known", () => {
    const [binding] = bindTurnPronouns("что мне об этом известно?", conversation(), scene({ knownTopics: [] }));

    expect(binding?.candidates).toEqual([]);
    expect(binding?.resolution).toBe("missing");
  });

  it("binds mixed replicas carrying an explicit noun and a pronoun", () => {
    const bindings = bindTurnPronouns("осмотрю ограду, что за ней", EMPTY_CONVERSATION, scene());

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.pronoun).toBe("ней");
  });

  it("is deterministic across reloads", () => {
    const mentioned = conversation({
      recentFocus: [
        { kind: "target", surface: "перевозчику", turnSeq: 4 },
        { kind: "target", surface: "реку", turnSeq: 2 },
      ],
    });
    const first = JSON.stringify(bindTurnPronouns("спрошу у него об этом", mentioned, scene()));
    const second = JSON.stringify(bindTurnPronouns("спрошу у него об этом", mentioned, scene()));

    expect(second).toBe(first);
    expect(JSON.parse(first)[0].candidates[0]).toBe("person_1");
  });
});
