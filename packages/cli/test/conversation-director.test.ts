/**
 * Conversation Director shadow tests (S0/P1): context completeness, handle
 * safety, decision schema and fallbacks. The director NEVER executes.
 */

import { describe, expect, it, vi } from "vitest";
import type { MasterTurnSceneContext } from "@skald/world";
import type { ModelRouter } from "@skald/world";
import { buildGmContext } from "../src/conversation/gm-context.js";
import { interpretGmDecision, extractJsonObject, normalizeDecisionShape } from "../src/runtime/conversation-director.js";
import { stableActorHandle } from "../src/conversation/gm-context.js";
import { scoreGmCorpus } from "../src/conversation/gm-scorecard.js";
import type { MasterConversationContext } from "../src/conversation/context-builder.js";
import { GM_FIXTURES, type GmFixture } from "./gm-fixtures.js";

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
    chat: vi.fn(async () => ({ text: JSON.stringify(decision) })),
  } as unknown as ModelRouter;
}

describe("buildGmContext", () => {
  it("assigns opaque hash handles and keeps internal ids out of the context", () => {
    const fixture = GM_FIXTURES[1];
    const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
    expect(context.actors).toHaveLength(2);
    for (const handle of handleToObserverRef.keys()) expect(handle).toMatch(/^e[0-9a-f]{6}$/);
    const ferryHandle = [...handleToObserverRef.entries()].find(([, ref]) => ref === "person_1")![0];
    expect(ferryHandle).toBe(stableActorHandle("person_1"));
    const serialized = JSON.stringify(context);
    for (const bad of ["contact:", "observerRef", "targetRef", "internalId"]) expect(serialized).not.toContain(bad);
    expect(context.supportedOperations.length).toBeGreaterThan(0);
    expect(context.recentTurns.length).toBe(fixture.recentTurns.length);
  });

  it("keeps a person's handle stable across reorder AND actor insertion", () => {
    const fixture = GM_FIXTURES[1];
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
    const fixture = GM_FIXTURES[0];
    const { context } = buildGmContext({
      scene: sceneOf(fixture),
      conversation: conversationOf(fixture),
      knowledgeTexts: Array.from({ length: 20 }, (_, i) => `Факт ${i + 1}`),
    });
    expect(context.knownFacts).toHaveLength(8);
    expect(context.knownFacts[0]).toMatchObject({ factId: "k1" });
  });

  it("carries the real sceneEngagement and bounded known facts", () => {
    const fixture = GM_FIXTURES[0];
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
    for (const fixture of [GM_FIXTURES[0], GM_FIXTURES[1]]) {
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
  for (const fixture of GM_FIXTURES) {
    it(`${fixture.id} → ${fixture.expected.addresseeKind}/${fixture.expected.kind}`, async () => {
      const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
      const npcHandle = fixture.expected.addresseeKind === "npc" ? [...handleToObserverRef.keys()][0] : undefined;
      const decision = {
        schemaVersion: 1,
        addressee: fixture.expected.addresseeKind === "npc"
          ? { kind: "npc", handle: npcHandle }
          : { kind: fixture.expected.addresseeKind },
        kind: fixture.expected.kind,
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
      const serialized = JSON.stringify(context);
      for (const forbidden of fixture.forbidden) expect(serialized).not.toContain(forbidden);
    });
  }
});

describe("interpretGmDecision — fallbacks", () => {
  const base = {
    input: "Привет",
    context: buildGmContext({ scene: sceneOf(GM_FIXTURES[2]), conversation: conversationOf(GM_FIXTURES[2]) }).context,
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

  it("falls back on a provider error", async () => {
    const result = await interpretGmDecision({ ...base, router: { apiKey: "", chat: vi.fn(async () => { throw new Error("down"); }) } as unknown as ModelRouter });
    expect(result).toMatchObject({ status: "fallback", reason: "provider_error" });
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
  it("scores each dimension separately and reports latency/fallback", () => {
    const trace = (schemaValid: boolean) => ({
      turnKey: "t", contractVersion: 1, schemaValid, validationErrors: [],
      providerLatencyMs: 10, totalLatencyMs: 100,
    });
    const entries = [
      { input: "a", expected: { addresseeKind: "gm" as const, kind: "conversation" }, trace: trace(true), decision: { schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" } as never },
      { input: "b", expected: { addresseeKind: "npc" as const, kind: "action", allowedHandles: ["e000001"] }, trace: trace(true), decision: { schemaVersion: 1, addressee: { kind: "npc", handle: "e000001" }, kind: "action" } as never },
      { input: "c", expected: { addresseeKind: "gm" as const, kind: "world_question" }, trace: trace(false) },
    ];
    const card = scoreGmCorpus(entries);
    expect(card.corpusSize).toBe(3);
    expect(card.schemaValid).toBe(2);
    expect(card.decision).toBe(2);
    expect(card.fallback).toBe(1);
    const dim = (name: string) => card.dimensions.find((d) => d.dimension === name)!;
    expect(dim("addressee").passed).toBe(2);
    expect(dim("kind").passed).toBe(2);
    expect(dim("handles").passed).toBe(2);
    expect(card.p50LatencyMs).toBe(100);
    expect(card.p95LatencyMs).toBe(100);
  });
});
