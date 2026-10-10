/**
 * Conversation Director shadow tests (S0/P1): context completeness, handle
 * safety, decision schema and fallbacks. The director NEVER executes.
 */

import { describe, expect, it, vi } from "vitest";
import type { MasterTurnSceneContext } from "@skald/world";
import type { ModelRouter } from "@skald/world";
import { buildGmContext } from "../src/conversation/gm-context.js";
import { interpretGmDecision, extractJsonObject } from "../src/runtime/conversation-director.js";
import type { MasterConversationContext } from "../src/conversation/context-builder.js";
import { GM_FIXTURES, type GmFixture } from "./gm-fixtures.js";

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
  it("assigns opaque handles and keeps internal ids out of the context", () => {
    const fixture = GM_FIXTURES[1];
    const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
    expect(context.actors.map((a) => a.handle)).toEqual(["e1", "e2"]);
    expect(handleToObserverRef.get("e1")).toBe("person_1");
    const serialized = JSON.stringify(context);
    for (const bad of ["contact:", "observerRef", "targetRef", "internalId"]) expect(serialized).not.toContain(bad);
    expect(context.supportedOperations.length).toBeGreaterThan(0);
    expect(context.recentTurns.length).toBe(fixture.recentTurns.length);
  });
});

describe("interpretGmDecision — seven problematic replicas", () => {
  for (const fixture of GM_FIXTURES) {
    it(`${fixture.id} → ${fixture.expected.addresseeKind}/${fixture.expected.kind}`, async () => {
      const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
      const decision = {
        schemaVersion: 1,
        addressee: fixture.expected.addresseeKind === "npc"
          ? { kind: "npc", handle: "e1" }
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
