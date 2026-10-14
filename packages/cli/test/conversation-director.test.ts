/**
 * Conversation Director shadow tests (S0/P1): context completeness, handle
 * safety, decision schema and fallbacks. The director NEVER executes.
 */

import { describe, expect, it, vi } from "vitest";
import type { MasterTurnSceneContext } from "@skald/world";
import type { ModelRouter } from "@skald/world";
import { buildGmContext } from "../src/conversation/gm-context.js";
import { interpretGmDecision, extractJsonObject, normalizeDecisionShape, createGmDirectorFlight } from "../src/runtime/conversation-director.js";
import { stableActorHandle } from "../src/conversation/gm-context.js";
import { scoreGmCorpus } from "../src/conversation/gm-scorecard.js";
import type { MasterConversationContext } from "../src/conversation/context-builder.js";
import { GM_CORPUS, expectedNpcHandle, expectedSubjectHandle, type GmFixture } from "../src/acceptance/gm-corpus.js";
import { GM_DIRECTOR_SYSTEM_PROMPT, buildGmDecisionPrompt } from "../src/conversation/gm-prompt.js";

const ferrymanLabel = "Перевозчик у переправы";

function sceneOf(fixture: GmFixture): MasterTurnSceneContext {
  return {
    schemaVersion: 1,
    revision: { worldTime: 0, eventNumber: 0 },
    currentLocation: { name: "Переправа", description: "Место у воды" },
    visibleObjects: [],
    knownPeople: fixture.people.map((person, index) => ({
      observerRef: `person_${index + 1}`,
      kind: "person" as const,
      label: person.label,
      knownAs: [],
      known: person.known,
    })),
    knownRoutes: [],
    accessibleItems: [],
    availableActions: [],
    currentSituation: null,
    knownTopics: [],
  } as unknown as MasterTurnSceneContext;
}

function conversationOf(fixture: GmFixture): MasterConversationContext {
  return {
    schemaVersion: 1,
    recentTurns: fixture.recentTurns,
    recentFocus: [],
    pendingClarification: null,
    lastTurns: fixture.recentTurns.map((turn) => ({ speaker: turn.speaker, text: turn.text, turnSeq: turn.turnSeq })),
    currentScene: null,
    recentlyMentionedEntities: [],
  } as unknown as MasterConversationContext;
}

function routerReturning(decision: unknown): ModelRouter {
  return {
    apiKey: "",
    chat: vi.fn(async () => ({ text: JSON.stringify(decision), provider: "ollama_cloud", model: "test-model", usedFallback: false })),
  } as unknown as ModelRouter;
}

describe("buildGmContext", () => {
  it("assigns opaque hash handles and keeps internal ids out of the context", () => {
    const fixture = GM_CORPUS[1];
    const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
    expect(context.actors).toHaveLength(2);
    for (const handle of handleToObserverRef.keys()) expect(handle).toMatch(/^e[0-9a-f]{12}$/);
    const ferryHandle = [...handleToObserverRef.entries()].find(([, ref]) => ref === "person_1")![0];
    expect(ferryHandle).toBe(stableActorHandle("person_1"));
    const serialized = JSON.stringify(context);
    for (const bad of ["contact:", "observerRef", "targetRef", "internalId"]) expect(serialized).not.toContain(bad);
    expect(context.supportedOperations.length).toBeGreaterThan(0);
    expect(context.recentTurns.length).toBe(fixture.recentTurns.length);
  });

  it("keeps a person's handle stable across reorder AND actor insertion", () => {
    const fixture = GM_CORPUS[1];
    const scene = sceneOf(fixture);
    const first = buildGmContext({ scene, conversation: conversationOf(fixture) });
    const ferryHandle = [...first.handleToObserverRef.entries()].find(([, ref]) => ref === "person_1")![0];

    const reordered = { ...scene, knownPeople: [...scene.knownPeople].reverse() };
    const second = buildGmContext({ scene: reordered, conversation: conversationOf(fixture) });
    expect(second.handleToObserverRef.get(ferryHandle)).toBe("person_1");

    // A NEW actor with a smaller observerRef must not shift the old handle.
    const withNewActor = {
      ...scene,
      knownPeople: [{ observerRef: "person_0", kind: "person" as const, label: "Новый", knownAs: [], known: false }, ...scene.knownPeople],
    };
    const third = buildGmContext({ scene: withNewActor as typeof scene, conversation: conversationOf(fixture) });
    expect(third.handleToObserverRef.get(ferryHandle)).toBe("person_1");
    expect(third.context.actors).toHaveLength(3);
  });

  it("caps known facts at the builder-owned bound", () => {
    const fixture = GM_CORPUS[0];
    const { context } = buildGmContext({
      scene: sceneOf(fixture),
      conversation: conversationOf(fixture),
      knowledgeTexts: Array.from({ length: 20 }, (_, i) => `Факт ${i + 1}`),
    });
    expect(context.knownFacts).toHaveLength(8);
    expect(context.knownFacts[0]).toMatchObject({ factId: "k1" });
  });

  it("carries the real sceneEngagement and bounded known facts", () => {
    const fixture = GM_CORPUS[0];
    const { context } = buildGmContext({
      scene: sceneOf(fixture),
      conversation: conversationOf(fixture),
      sceneEngagement: { state: "near", label: ferrymanLabel },
      knowledgeTexts: ["Ты знаешь дорогу к городу", "Ты видел ночной след"],
    });
    expect(context.scene.sceneEngagement).toEqual({ state: "near", label: ferrymanLabel });
    expect(context.knownFacts).toHaveLength(2);
    expect(context.knownFacts[0]).toMatchObject({ factId: "k1" });
  });
});

describe("interpretGmDecision — prompt carries the scene (scenario-conditioned router)", () => {
  it("the router sees the replica and the history, and its answer decides", async () => {
    for (const fixture of [GM_CORPUS[0], GM_CORPUS[1]]) {
      const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
      const npcHandle = [...handleToObserverRef.keys()][0];
      const seen = { replica: false, history: fixture.recentTurns.length === 0 };
      const router = {
        apiKey: "",
        chat: vi.fn(async (_category: string, messages: readonly { role: string; content: string }[]) => {
          const user = messages.find((m) => m.role === "user")?.content ?? "";
          seen.replica = user.includes(fixture.input);
          if (fixture.recentTurns.length > 0) seen.history = fixture.recentTurns.every((t) => user.includes(t.text));
          const decision = fixture.id === "ambiguous-recipient"
            ? { schemaVersion: 1, addressee: { kind: "gm" }, kind: "clarification", clarification: { question: "Кто из них?" } }
            : { schemaVersion: 1, addressee: { kind: "npc", handle: npcHandle }, kind: "world_question" };
          return { text: JSON.stringify(decision) };
        }),
      } as unknown as ModelRouter;
      const result = await interpretGmDecision({
        input: fixture.input, context, handleKeys: [...handleToObserverRef.keys()], router, turnKey: `s-${fixture.id}`,
      });
      expect(result.status).toBe("decision");
      expect(seen.replica).toBe(true);
      expect(seen.history).toBe(true);
      if (result.status === "decision") expect(result.decision.kind).toBe(fixture.id === "ambiguous-recipient" ? "clarification" : "world_question");
    }
  });
});

describe("interpretGmDecision — seven problematic replicas", () => {
  for (const fixture of GM_CORPUS) {
    it(`${fixture.id} → ${fixture.expected.addresseeKind}/${fixture.expected.kind}`, async () => {
      const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
      const npcHandle = fixture.expected.addresseeKind === "npc" ? expectedNpcHandle(fixture) : undefined;
      const subjectHandle = expectedSubjectHandle(fixture);
      expect(npcHandle === undefined || [...handleToObserverRef.keys()].includes(npcHandle)).toBe(true);
      expect(subjectHandle === undefined || [...handleToObserverRef.keys()].includes(subjectHandle)).toBe(true);
      const decision = {
        schemaVersion: 1,
        addressee: fixture.expected.addresseeKind === "npc"
          ? { kind: "npc", handle: npcHandle }
          : { kind: fixture.expected.addresseeKind },
        kind: fixture.expected.kind,
        ...(subjectHandle !== undefined ? { subjectHandle } : {}),
      };
      const result = await interpretGmDecision({
        input: fixture.input,
        context,
        handleKeys: [...handleToObserverRef.keys()],
        router: routerReturning(decision),
        turnKey: `intent-${fixture.id}`,
      });
      expect(result.status).toBe("decision");
      if (result.status !== "decision") return;
      expect(result.decision.addressee.kind).toBe(fixture.expected.addresseeKind);
      expect(result.decision.kind).toBe(fixture.expected.kind);
      expect(result.trace.schemaValid).toBe(true);
      // Attribution: the trace records which provider/model actually answered.
      expect(result.trace.provider).toBe("ollama_cloud");
      expect(result.trace.model).toBe("test-model");
      expect(result.trace.usedFallback).toBe(false);
      const serialized = JSON.stringify(context);
      for (const forbidden of fixture.forbidden) expect(serialized).not.toContain(forbidden);
    });
  }
});

describe("interpretGmDecision — fallbacks", () => {
  const base = {
    input: "Привет",
    context: buildGmContext({ scene: sceneOf(GM_CORPUS[2]), conversation: conversationOf(GM_CORPUS[2]) }).context,
    handleKeys: ["e1"],
    turnKey: "intent-fb",
  };

  it("falls back on a non-JSON reply", async () => {
    const result = await interpretGmDecision({ ...base, router: { apiKey: "", chat: vi.fn(async () => ({ text: "I am not JSON" })) } as unknown as ModelRouter });
    expect(result).toMatchObject({ status: "fallback", reason: "shape:not_json" });
  });

  it("falls back on an invalid decision schema", async () => {
    const result = await interpretGmDecision({ ...base, router: routerReturning({ schemaVersion: 1, addressee: { kind: "alien" }, kind: "nope", extra: 1 }) });
    expect(result).toMatchObject({ status: "fallback", reason: "schema:invalid" });
    if (result.status === "fallback") expect(result.trace.validationErrors.length).toBeGreaterThan(0);
  });

  it("falls back on a handle not visible in this scene", async () => {
    const result = await interpretGmDecision({ ...base, router: routerReturning({ schemaVersion: 1, addressee: { kind: "npc", handle: "e7" }, kind: "conversation" }) });
    expect(result).toMatchObject({ status: "fallback", reason: "schema:invalid" });
  });

  it("falls back on a clarification candidate that is invisible in this scene", async () => {
    const twoPeople = GM_CORPUS[1]; // two visible people
    const built = buildGmContext({ scene: sceneOf(twoPeople), conversation: conversationOf(twoPeople) });
    const [first] = [...built.handleToObserverRef.keys()];
    const result = await interpretGmDecision({
      input: twoPeople.input,
      context: built.context,
      handleKeys: [first], // only ONE handle is visible to the director
      turnKey: "intent-invisible-candidate",
      router: routerReturning({
        schemaVersion: 1,
        addressee: { kind: "gm" },
        kind: "clarification",
        clarification: { question: "Кто?", candidateHandles: [first, "efabricated01"] },
      }),
    });
    expect(result).toMatchObject({ status: "fallback", reason: "schema:invalid" });
    if (result.status === "fallback") expect(result.trace.validationErrors.join("\n")).toContain("not a visible actor");
  });

  it("falls back on a provider error", async () => {
    const result = await interpretGmDecision({ ...base, router: { apiKey: "", chat: vi.fn(async () => { throw new Error("down"); }) } as unknown as ModelRouter });
    expect(result).toMatchObject({ status: "fallback", reason: "provider_error" });
  });

  it("keeps provider/model attribution on a PROVIDER ERROR (not just successes)", async () => {
    const result = await interpretGmDecision({
      ...base,
      router: {
        apiKey: "",
        chat: vi.fn(async () => {
          const error = new Error("unavailable") as Error & { provider: string; model: string };
          error.provider = "openrouter";
          error.model = "nvidia/nemotron-3-super-120b-a12b:free";
          throw error;
        }),
      } as unknown as ModelRouter,
    });
    expect(result).toMatchObject({ status: "fallback", reason: "provider_error" });
    // Attribution survives the failure path.
    expect(result.trace.provider).toBe("openrouter");
    expect(result.trace.model).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });
});

describe("extractJsonObject", () => {
  it("extracts a JSON object and tolerates surrounding prose", () => {
    expect(extractJsonObject('Вот ответ: {"a":1} окончательно')).toEqual({ a: 1 });
    expect(extractJsonObject("no braces")).toBeNull();
    expect(extractJsonObject('{"a":{"b":1}}')).toEqual({ a: { b: 1 } });
  });
});

describe("normalizeDecisionShape", () => {
  it("maps a closed addressee alias and leaves a bare handle untouched", () => {
    const gm = normalizeDecisionShape({ schemaVersion: 1, addressee: "gm", kind: "conversation" }) as Record<string, unknown>;
    expect(gm["addressee"]).toEqual({ kind: "gm" });
    const meta = normalizeDecisionShape({ schemaVersion: 1, addressee: "meta", kind: "meta" }) as Record<string, unknown>;
    expect(meta["addressee"]).toEqual({ kind: "meta" });
    const bare = normalizeDecisionShape({ schemaVersion: 1, addressee: "e1", kind: "conversation" }) as Record<string, unknown>;
    expect(bare["addressee"]).toBe("e1");
  });
});

describe("scoreGmCorpus", () => {
  const trace = (schemaValid: boolean, raw = true) => ({
    turnKey: "t", contractVersion: 1, schemaValid, rawSchemaValid: raw,
    decisionAccepted: schemaValid, validationErrors: [],
    providerLatencyMs: 10, totalLatencyMs: 100,
  });

  it("uses end-to-end denominators (a fallback misses every dimension)", () => {
    const entries = [
      { input: "a", expected: { addresseeKind: "gm" as const, kind: "conversation" }, trace: trace(true), decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" } as never },
      { input: "b", expected: { addresseeKind: "npc" as const, kind: "action", allowedHandles: ["e000001"] }, trace: trace(true), decision: { schemaVersion: 1, addressee: { kind: "npc", handle: "e000001" }, kind: "action" } as never },
      { input: "c", expected: { addresseeKind: "gm" as const, kind: "world_question" }, trace: trace(false, false) }, // fallback
    ];
    const card = scoreGmCorpus(entries);
    expect(card.corpusSize).toBe(3);
    expect(card.schemaValid).toBe(2);
    expect(card.rawSchemaValid).toBe(2);
    expect(card.decisionAccepted).toBe(2);
    const dim = (name: string) => card.dimensions.find((d) => d.dimension === name)!;
    // Denominator is the FULL corpus: the fallback misses addressee/kind/handles.
    expect(dim("addressee").total).toBe(3);
    expect(dim("addressee").passed).toBe(2);
    expect(dim("kind").passed).toBe(2);
    expect(dim("handles").passed).toBe(2);
    expect(card.p50LatencyMs).toBe(100);
  });

  it("checks clarification candidate handles against the scene allowlist", () => {
    const good = scoreGmCorpus([{
      input: "ok",
      expected: { addresseeKind: "clarification" as const, kind: "clarification", allowedHandles: ["e000001", "e000002"] },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "clarification", clarification: { question: "?", candidateHandles: ["e000001", "e000002"] } } as never,
    }]);
    expect(good.dimensions.find((d) => d.dimension === "handles")!.passed).toBe(1);

    const fabricated = scoreGmCorpus([{
      input: "bad",
      expected: { addresseeKind: "clarification" as const, kind: "clarification", allowedHandles: ["e000001"] },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "clarification", clarification: { question: "?", candidateHandles: ["e999999"] } } as never,
    }]);
    expect(fabricated.dimensions.find((d) => d.dimension === "handles")!.passed).toBe(0);
  });

  it("requires the SPECIFIC npc handle when the expectation names one", () => {
    const wrongVisibleNpc = scoreGmCorpus([{
      input: "bad-target",
      expected: { addresseeKind: "npc" as const, kind: "conversation", allowedHandles: ["eaaa111", "ebbb222"], expectedHandle: "eaaa111" },
      trace: trace(true),
      // Visible, but the wrong person: another NPC of the same class.
      decision: { schemaVersion: 1, addressee: { kind: "npc", handle: "ebbb222" }, kind: "conversation" } as never,
    }]);
    expect(wrongVisibleNpc.dimensions.find((d) => d.dimension === "handles")!.passed).toBe(0);

    const rightNpc = scoreGmCorpus([{
      input: "good-target",
      expected: { addresseeKind: "npc" as const, kind: "conversation", allowedHandles: ["eaaa111", "ebbb222"], expectedHandle: "eaaa111" },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "npc", handle: "eaaa111" }, kind: "conversation" } as never,
    }]);
    expect(rightNpc.dimensions.find((d) => d.dimension === "handles")!.passed).toBe(1);
  });

  it("fails an entry whose context leaks a forbidden substring, even on fallback", () => {
    const leaked = scoreGmCorpus([{
      input: "leak",
      expected: { addresseeKind: "gm" as const, kind: "conversation" },
      trace: trace(false, false), // fallback
      contextJson: '{"note":"contact:waystation-keeper"}',
      forbidden: ["contact:"],
    }]);
    expect(leaked.dimensions.find((d) => d.dimension === "privacy")!.passed).toBe(0);

    const clean = scoreGmCorpus([{
      input: "clean",
      expected: { addresseeKind: "gm" as const, kind: "conversation" },
      trace: trace(false, false),
      contextJson: '{"actors":[]}',
      forbidden: ["contact:"],
    }]);
    expect(clean.dimensions.find((d) => d.dimension === "privacy")!.passed).toBe(1);

    // Fail-closed: forbidden substrings without a context to check is a miss.
    const noContext = scoreGmCorpus([{
      input: "no-context",
      expected: { addresseeKind: "gm" as const, kind: "conversation" },
      trace: trace(true),
      forbidden: ["contact:"],
    }]);
    expect(noContext.dimensions.find((d) => d.dimension === "privacy")!.passed).toBe(0);

    // No forbidden set at all: nothing to leak, so it passes.
    const unrestricted = scoreGmCorpus([{
      input: "unrestricted",
      expected: { addresseeKind: "gm" as const, kind: "conversation" },
      trace: trace(true),
    }]);
    expect(unrestricted.dimensions.find((d) => d.dimension === "privacy")!.passed).toBe(1);
  });

  it("emits sanitized per-case facts: expected vs actual, provider and fallback reason", () => {
    const withProvider = { ...trace(true), provider: "ollama_cloud", model: "gemma4:31b-cloud", usedFallback: false } as ReturnType<typeof trace>;
    const card = scoreGmCorpus([
      {
        input: "case-npc",
        expected: { addresseeKind: "npc" as const, kind: "action", allowedHandles: ["eaaa111"], expectedHandle: "eaaa111" },
        trace: withProvider,
        decision: { schemaVersion: 1, addressee: { kind: "npc", handle: "eaaa111" }, kind: "action" } as never,
      },
      { // fallback case: no decision, but the reason and provider stay visible
        input: "case-fallback",
        expected: { addresseeKind: "gm" as const, kind: "conversation" },
        trace: { ...trace(false, false), fallbackReason: "schema:invalid", provider: "ollama_cloud", model: "gemma4:31b-cloud" } as ReturnType<typeof trace>,
      },
    ]);
    expect(card.cases).toHaveLength(2);
    const [npc, fb] = card.cases;
    expect(npc).toMatchObject({
      scenario: "case-npc",
      expected: { addresseeKind: "npc", kind: "action", expectedHandle: "eaaa111", allowedHandles: ["eaaa111"] },
      actual: { addresseeKind: "npc", kind: "action", handle: "eaaa111" },
      passes: { schema: true, addressee: true, kind: true, handles: true, privacy: true },
      provider: "ollama_cloud",
      model: "gemma4:31b-cloud",
      usedFallback: false,
    });
    expect(fb.actual.addresseeKind).toBeUndefined();
    expect(fb.expected.allowedHandles).toBeUndefined();
    expect(fb).toMatchObject({
      scenario: "case-fallback",
      passes: { schema: false, addressee: false, kind: false, handles: false, subject: true, privacy: true },
      fallbackReason: "schema:invalid",
      provider: "ollama_cloud",
    });
  });

  it("fails handles when the decision has the WRONG TYPE (not just a wrong handle)", () => {
    // Expected npc target, answered gm: the handle dimension must not pass.
    const wrongAddresseeType = scoreGmCorpus([{
      input: "pronoun",
      expected: { addresseeKind: "npc" as const, kind: "world_question", allowedHandles: ["eaaa111"], expectedHandle: "eaaa111" },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "world_question" } as never,
    }]);
    expect(wrongAddresseeType.dimensions.find((d) => d.dimension === "handles")!.passed).toBe(0);

    // Expected clarification with candidates, answered world_question.
    const wrongKindType = scoreGmCorpus([{
      input: "ambiguous",
      expected: { addresseeKind: "gm" as const, kind: "clarification", allowedHandles: ["eaaa111", "ebbb222"] },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "world_question" } as never,
    }]);
    expect(wrongKindType.dimensions.find((d) => d.dimension === "handles")!.passed).toBe(0);
  });

  it("fails privacy when the MODEL ANSWER leaks a forbidden substring", () => {
    const leakedAnswer = scoreGmCorpus([{
      input: "leaky-answer",
      expected: { addresseeKind: "gm" as const, kind: "clarification", allowedHandles: ["eaaa111"] },
      trace: trace(true),
      contextJson: '{"actors":[]}',
      forbidden: ["contact:"],
      decision: {
        schemaVersion: 1, addressee: { kind: "gm" }, kind: "clarification",
        clarification: { question: "Кто ведёт журнал — contact:waystation-keeper?", candidateHandles: ["eaaa111"] },
      } as never,
    }]);
    expect(leakedAnswer.dimensions.find((d) => d.dimension === "privacy")!.passed).toBe(0);
  });

  it("scores the subject dimension end-to-end (missing or wrong topic fails)", () => {
    const base = { allowedHandles: ["eaaa111", "ebbb222"], expectedSubjectHandle: "eaaa111" };
    const right = scoreGmCorpus([{
      input: "pronoun",
      expected: { addresseeKind: "gm" as const, kind: "world_question", ...base },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "world_question", subjectHandle: "eaaa111" } as never,
    }]);
    expect(right.dimensions.find((d) => d.dimension === "subject")!.passed).toBe(1);

    const missing = scoreGmCorpus([{
      input: "pronoun",
      expected: { addresseeKind: "gm" as const, kind: "world_question", ...base },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "world_question" } as never,
    }]);
    expect(missing.dimensions.find((d) => d.dimension === "subject")!.passed).toBe(0);

    const wrongTopic = scoreGmCorpus([{
      input: "pronoun",
      expected: { addresseeKind: "gm" as const, kind: "world_question", ...base },
      trace: trace(true),
      decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "world_question", subjectHandle: "ebbb222" } as never,
    }]);
    expect(wrongTopic.dimensions.find((d) => d.dimension === "subject")!.passed).toBe(0);

    // A fallback with an expected subject also fails it.
    const fallback = scoreGmCorpus([{
      input: "pronoun",
      expected: { addresseeKind: "gm" as const, kind: "world_question", ...base },
      trace: trace(false, false),
    }]);
    expect(fallback.dimensions.find((d) => d.dimension === "subject")!.passed).toBe(0);
  });
});

describe("expectedNpcHandle", () => {
  it("maps npcLabel to the hash of the matching scene person", () => {
    const fixture = GM_CORPUS.find((f) => f.expected.npcLabel !== undefined)!;
    const handle = expectedNpcHandle(fixture)!;
    expect(handle).toBe(stableActorHandle(`person_${fixture.people.findIndex((p) => p.label === fixture.expected.npcLabel) + 1}`));
    expect(expectedNpcHandle(GM_CORPUS[2])).toBeUndefined(); // no npcLabel
    // A label absent from the corpus scene must not silently pick anyone.
    expect(expectedNpcHandle({ ...fixture, expected: { ...fixture.expected, npcLabel: "Несуществующий" } })).toBeUndefined();
  });

  it("maps subjectLabel to the topic handle (pronoun question is master-answered)", () => {
    const fixture = GM_CORPUS.find((f) => f.expected.subjectLabel !== undefined)!;
    expect(fixture.id).toBe("pronoun-after-mention");
    expect(fixture.expected.addresseeKind).toBe("gm"); // master responds…
    const handle = expectedSubjectHandle(fixture)!; // …the NPC is the subject
    expect(handle).toBe(stableActorHandle(`person_${fixture.people.findIndex((p) => p.label === fixture.expected.subjectLabel) + 1}`));
    expect(expectedSubjectHandle(GM_CORPUS[2])).toBeUndefined();
  });
});

describe("interpretGmDecision — single-flight", () => {
  const built = buildGmContext({ scene: sceneOf(GM_CORPUS[2]), conversation: conversationOf(GM_CORPUS[2]) });
  const base = {
    input: "Привет",
    context: built.context,
    handleKeys: [...built.handleToObserverRef.keys()],
    turnKey: "intent-same-key",
  };

  it("two concurrent identical calls share ONE provider call; the follower is marked shared", async () => {
    const chat = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { text: JSON.stringify({ schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" }), provider: "ollama_cloud", model: "test-model", usedFallback: false };
    });
    const router = { apiKey: "", chat } as unknown as ModelRouter;
    const flight = createGmDirectorFlight();

    const [a, b] = await Promise.all([
      interpretGmDecision({ ...base, router, flight }),
      interpretGmDecision({ ...base, router, flight }),
    ]);
    // ONE provider call for both concurrent requests.
    expect(chat).toHaveBeenCalledTimes(1);
    // Same outcome; exactly one of the two is the shared follower.
    expect(a.status).toBe("decision");
    expect(b.status).toBe("decision");
    expect([a.shared === true, b.shared === true].filter(Boolean)).toHaveLength(1);
    // The registry releases the key on settle — no result caching.
    expect(flight.size).toBe(0);
  });

  it("a later call after settle is a NEW provider call (concurrency collapse, not a cache)", async () => {
    const chat = vi.fn(async () => ({ text: JSON.stringify({ schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" }), provider: "ollama_cloud", model: "m", usedFallback: false }));
    const router = { apiKey: "", chat } as unknown as ModelRouter;
    const flight = createGmDirectorFlight();
    await interpretGmDecision({ ...base, router, flight });
    await interpretGmDecision({ ...base, router, flight });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("different turnKeys never share a call (cross-world scope)", async () => {
    const chat = vi.fn(async () => ({ text: JSON.stringify({ schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" }), provider: "ollama_cloud", model: "m", usedFallback: false }));
    const router = { apiKey: "", chat } as unknown as ModelRouter;
    const flight = createGmDirectorFlight();
    await Promise.all([
      interpretGmDecision({ ...base, turnKey: "intent-k1", router, flight }),
      interpretGmDecision({ ...base, turnKey: "intent-k2", router, flight }),
    ]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("the SAME turnKey with a DIFFERENT replica does not share (text scope)", async () => {
    const chat = vi.fn(async () => ({ text: JSON.stringify({ schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" }), provider: "ollama_cloud", model: "m", usedFallback: false }));
    const router = { apiKey: "", chat } as unknown as ModelRouter;
    const flight = createGmDirectorFlight();
    await Promise.all([
      interpretGmDecision({ ...base, input: "Привет", router, flight }),
      interpretGmDecision({ ...base, input: "Кто здесь?", router, flight }),
    ]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("a provider ERROR collapses too: follower gets the SAME fallback, the registry clears, the next call retries", async () => {
    const chat = vi.fn(async () => {
      const error = new Error("upstream down") as Error & { provider: string; model: string };
      error.provider = "openrouter";
      error.model = "nemotron:free";
      throw error;
    });
    const router = { apiKey: "", chat } as unknown as ModelRouter;
    const flight = createGmDirectorFlight();

    const [a, b] = await Promise.all([
      interpretGmDecision({ ...base, router, flight }),
      interpretGmDecision({ ...base, router, flight }),
    ]);
    // ONE failed provider call serves both concurrent requests.
    expect(chat).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ status: "fallback", reason: "provider_error" });
    expect(b).toMatchObject({ status: "fallback", reason: "provider_error" });
    expect(a.trace.provider).toBe("openrouter");
    expect(b.trace.provider).toBe("openrouter");
    expect([a.shared === true, b.shared === true].filter(Boolean)).toHaveLength(1);
    // Failure does NOT poison the registry: the key is released on settle.
    expect(flight.size).toBe(0);

    // The next call is a fresh attempt, not a cached failure.
    await interpretGmDecision({ ...base, router, flight });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("without a flight registry behavior is unchanged (pass-through)", async () => {
    const chat = vi.fn(async () => ({ text: JSON.stringify({ schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" }), provider: "ollama_cloud", model: "m", usedFallback: false }));
    const router = { apiKey: "", chat } as unknown as ModelRouter;
    await Promise.all([
      interpretGmDecision({ ...base, router }),
      interpretGmDecision({ ...base, router }),
    ]);
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

describe("gm prompt", () => {
  it("carries no literal placeholder handles and embeds the scene's real ones", async () => {
    expect(GM_DIRECTOR_SYSTEM_PROMPT).not.toContain("<HANDLE");
    const fixture = GM_CORPUS[1]; // two visible people
    const { context } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
    const userPrompt = buildGmDecisionPrompt(fixture.input, context);
    for (const actor of context.actors) expect(userPrompt).toContain(actor.handle);
    expect(userPrompt).not.toContain("<HANDLE");
  });
});
