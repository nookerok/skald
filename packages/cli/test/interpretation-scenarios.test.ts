import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { classifyHttpResponse, evaluateScenarioStep, INTERPRETATION_SCENARIOS } from "../src/acceptance/interpretation-scenarios.js";

describe("sequential interpretation scenarios (full-master Stage 1)", () => {
  it("classifies command responses into observations", () => {
    expect(classifyHttpResponse({ status: "inquiry", inquiry: { queryId: "who_is_nearby" } }))
      .toMatchObject({ kind: "inquiry", primary: "inquiry", queryId: "who_is_nearby" });
    expect(classifyHttpResponse({ status: "clarification", question: "К кому именно — А или Б?" }))
      .toMatchObject({ kind: "clarification", genericFallback: false });
    expect(classifyHttpResponse({ status: "ok", conversationTurn: { responseKind: "mixed_outcome" } }))
      .toMatchObject({ kind: "mixed", primary: "action" });
    expect(classifyHttpResponse({ status: "ok", conversationTurn: { responseKind: "speech_reaction" } }))
      .toMatchObject({ kind: "speech", primary: "action" });
    expect(classifyHttpResponse({ status: "ok", conversationTurn: { responseKind: "action_outcome" } }))
      .toMatchObject({ kind: "action", primary: "action" });
  });

  it("requires a declared primary and query in scenario steps too", () => {
    expect(evaluateScenarioStep({ input: "где я?", expect: ["inquiry"], primary: ["inquiry"], queryId: "current_location" },
      { status: "inquiry", kind: "inquiry", primary: "inquiry", queryId: null, genericFallback: false }).ok).toBe(false);
    expect(evaluateScenarioStep({ input: "осматриваюсь", expect: ["action"], primary: ["action"] },
      { status: "ok", kind: "action", primary: null, queryId: null, genericFallback: false }).ok).toBe(false);
  });

  it("runs every scenario step through the command path without a generic fallback", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-scenario-test-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "scenario-test";
      store.createWorld({
        worldId, idempotencyKey: `create-${worldId}`, requestHash: `hash-${worldId}`,
        saveLabel: worldId, characterName: "Corpus", characterPresetId: "wanderer",
        worldTemplateId: "living_region", characterWound: "none", characterPromise: "observe",
        characterPrinciple: "care", characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents("living_region"),
      });
      const throwing = { apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) } as any;
      const runtime = await new WorldRuntimeManager(store, throwing).get(worldId);
      for (const scenario of INTERPRETATION_SCENARIOS) {
        let index = 0;
        for (const step of scenario.steps) {
          const response = await handleWorldCommand(runtime, { input: step.input, idempotencyKey: `${scenario.id}-${index}` });
          const observation = classifyHttpResponse(JSON.parse(response.body));
          const evaluation = evaluateScenarioStep(step, observation);
          // The degraded path may clarify (pronoun/continuation without a model),
          // but it must never answer with the generic last resort.
          expect(evaluation.reason, `${scenario.id}: ${step.input}`).not.toBe("generic_clarification");
          index += 1;
        }
      }
    } finally {
      store.close();
    }
  });
});
