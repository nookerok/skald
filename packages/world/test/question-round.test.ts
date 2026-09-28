import { describe, expect, it } from "vitest";
import type { QuestionPlan, ReadingRequest, SubjectBinding } from "@skald/intent-parser";
import {
  executeQuestionReadingRound,
  type QuestionRoundContext,
  type QuestionRoundSpec,
} from "@skald/world";
import type { MasterTurnSceneSnapshot } from "@skald/world";
import type { NarrativeAdapterContext } from "@skald/world";

function narrativeFact(id: string, text: string): NarrativeAdapterContext["knowledge"]["observed"][number] {
  return { id, text, epistemicClass: "observed_fact", source: "knowledge", usableNow: true };
}

function scene(): MasterTurnSceneSnapshot {
  return {
    context: {
      schemaVersion: 1,
      revision: { worldTime: 1, eventNumber: 4 },
      currentLocation: { name: "Переправа у Чёрного леса", description: "Ты стоишь у воды." },
      visibleObjects: [],
      knownPeople: [
        {
          observerRef: "person_1",
          kind: "person",
          label: "Перевозчик",
          knownAs: [],
          known: true,
          portrait: { visibleAppearance: ["Потёртый плащ"], distinguishingFeatures: [], publicRole: "Перевозчик", addressForms: [] },
        },
      ],
      knownRoutes: [],
      accessibleItems: [],
      availableActions: [],
      currentSituation: null,
      knownTopics: [],
    },
    references: new Map(),
  };
}

function narrative(): NarrativeAdapterContext {
  return {
    character: {
      name: "Лёха",
      backgroundTitle: "Следопыт",
      formerRole: "Ночному дозору",
      rupture: "Ты ушёл из дозора",
      obligation: "Ты должен вернуть украденный знак",
    },
    arrival: {
      reason: "Ночной поток вынес к переправе след неверно установленного знака.",
      personalHook: "Знак помечен клеймом дозора",
      startingLocation: "Лесная дорога",
    },
    visibleSituation: { facts: [narrativeFact("situation:1", "Вода прибывает.")], sensoryContext: [] },
    knowledge: {
      observed: [narrativeFact("knowledge:1", "Ты видел обломок знака у воды.")],
      testimony: [],
      hypotheses: [],
    },
    contacts: [],
    accessibleItems: [],
    unresolvedSituation: [],
    openingWindow: true,
  };
}

function bindings(): readonly SubjectBinding[] {
  return Object.freeze([
    { subject: { id: "here", surface: "здесь", kind: "place" }, resolution: "resolved", resolvedRef: null },
    { subject: { id: "ferry", surface: "перевозчик", kind: "entity", observerRef: "person_1" }, resolution: "resolved", resolvedRef: "person_1" },
  ]);
}

function questionPlan(): QuestionPlan {
  const plan: QuestionPlan = {
    subjects: bindings(),
    parts: [
      { id: "p-scene", subjectRefs: ["here"], aspect: "current_activity", time: "current", purpose: "describe" },
      { id: "p-look", subjectRefs: ["ferry"], aspect: "appearance", time: "current", purpose: "describe" },
      { id: "p-react", subjectRefs: ["ferry"], aspect: "observed_reaction", time: "current", purpose: "describe" },
    ],
    actionIntent: null,
  };
  return Object.freeze(plan);
}

function spec(readings: readonly ReadingRequest[]): QuestionRoundSpec {
  return Object.freeze({
    questionPlan: questionPlan(),
    readings: Object.freeze([...readings]),
    interpretationRevision: Object.freeze({ worldTime: 1, eventNumber: 4 }),
  });
}

function context(overrides?: Partial<QuestionRoundContext>): QuestionRoundContext {
  return {
    scene: scene(),
    revision: { worldTime: 2, eventNumber: 7 },
    narrative: narrative(),
    transcript: null,
    ...overrides,
  };
}

describe("executeQuestionReadingRound", () => {
  it("executes every request exactly once on one shared context", () => {
    const round = executeQuestionReadingRound(
      spec([
        { partId: "p-scene", source: "scene" },
        { partId: "p-look", source: "person" },
      ]),
      context(),
    );
    expect(round.results).toHaveLength(2);
    expect(round.results.map((entry) => entry.request.partId)).toEqual(["p-scene", "p-look"]);
    expect(round.results.every((entry) => entry.status === "available")).toBe(true);
    expect(round.coveredParts).toEqual(["p-look", "p-scene"]);
    expect(round.revision).toEqual({ worldTime: 2, eventNumber: 7 });
    expect(Object.isFrozen(round)).toBe(true);
    expect(Object.isFrozen(round.results)).toBe(true);
  });

  it("marks an exhausted part uncovered instead of re-requesting it", () => {
    const round = executeQuestionReadingRound(
      spec([{ partId: "p-react", source: "person" }]),
      context(),
    );
    // Exactly one pass: the request appears once and is never retried.
    expect(round.results).toHaveLength(1);
    expect(round.results[0]!.status).toBe("no_data");
    // The portrait source cannot serve observed_reaction, so the part stays
    // outside coveredParts — the explicit incomplete-coverage signal.
    expect(round.coveredParts).toEqual([]);
  });

  it("leaves never-requested parts outside coverage", () => {
    const round = executeQuestionReadingRound(spec([{ partId: "p-scene", source: "scene" }]), context());
    expect(round.coveredParts).toEqual(["p-scene"]);
    expect(round.results).toHaveLength(1);
  });

  it("carries the interpretation revision separately from the read revision", () => {
    const round = executeQuestionReadingRound(
      spec([{ partId: "p-scene", source: "scene" }]),
      context({ revision: { worldTime: 9, eventNumber: 30 } }),
    );
    expect(round.revision).toEqual({ worldTime: 9, eventNumber: 30 });
    expect(round.questionPlan.actionIntent).toBeNull();
  });

  it("reads a null narrative and transcript as honest absence", () => {
    const round = executeQuestionReadingRound(
      spec([{ partId: "p-look", source: "conversation_topics" }]),
      context({ narrative: null, transcript: null }),
    );
    expect(round.results[0]!.status).toBe("no_data");
  });
});
