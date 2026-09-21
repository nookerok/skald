import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { classifyCommandResponse, evaluateScenarioStep, INTERPRETATION_SCENARIOS } from "../src/acceptance/interpretation-scenarios.js";
import { applyServiceEnv } from "../src/acceptance/service-env.js";

describe("sequential interpretation scenarios (full-master Stage 1)", () => {
  it("classifies confirmed command responses into observations", () => {
    expect(classifyCommandResponse({ statusCode: 200, body: { ok: true, status: "inquiry", inquiry: { queryId: "who_is_nearby" } } }))
      .toMatchObject({ kind: "inquiry", primary: "inquiry", queryId: "who_is_nearby" });
    expect(classifyCommandResponse({ statusCode: 200, body: { ok: true, status: "clarification", question: "К кому именно — А или Б?" } }))
      .toMatchObject({ kind: "clarification", genericFallback: false });
    expect(classifyCommandResponse({ statusCode: 200, body: { ok: true, conversationTurn: { responseKind: "mixed_outcome" } } }))
      .toMatchObject({ kind: "mixed", primary: "action" });
    expect(classifyCommandResponse({ statusCode: 200, body: { ok: true, conversationTurn: { responseKind: "speech_reaction" } } }))
      .toMatchObject({ kind: "speech", primary: "speech" });
    expect(classifyCommandResponse({ statusCode: 200, body: { ok: true, conversationTurn: { responseKind: "action_outcome" } } }))
      .toMatchObject({ kind: "action", primary: "action" });
  });

  it("classifies errors and unconfirmed responses as unavailable, never action", () => {
    for (const bad of [
      { statusCode: 500, body: { ok: false, error: { code: "internal_error" } } },
      { statusCode: 200, body: { ok: false, error: { code: "idempotency_conflict" } } },
      { statusCode: 200, body: { ok: true } },
      { statusCode: 200, body: { ok: true, conversationTurn: {} } },
      { statusCode: 200, body: { ok: true, status: "weird" } },
      // Unknown status must fail even WITH a familiar responseKind.
      { statusCode: 200, body: { ok: true, status: "weird", conversationTurn: { responseKind: "action_outcome" } } },
    ]) {
      expect(classifyCommandResponse(bad).kind, JSON.stringify(bad)).toBe("unavailable");
    }
  });

  it("requires a declared primary and query in scenario steps too", () => {
    expect(evaluateScenarioStep({ input: "где я?", expect: ["inquiry"], primary: ["inquiry"], queryId: "current_location" },
      { status: "inquiry", kind: "inquiry", primary: "inquiry", queryId: null, genericFallback: false }).ok).toBe(false);
    expect(evaluateScenarioStep({ input: "осматриваюсь", expect: ["action"], primary: ["action"] },
      { status: "ok", kind: "action", primary: null, queryId: null, genericFallback: false }).ok).toBe(false);
  });

  it("fails a step that expects an action when the response is unavailable", () => {
    const observation = classifyCommandResponse({ statusCode: 500, body: { ok: false } });
    const evaluation = evaluateScenarioStep({ input: "осматриваюсь", expect: ["action"], primary: ["action"] }, observation);
    expect(evaluation.ok).toBe(false);
  });

  it("parses provider settings as systemd data and rejects unusable env", () => {
    const target: NodeJS.ProcessEnv = {};
    // systemd keeps an inline `#` as part of a bare value; Bash would treat it
    // as a comment. Quoted values keep their spaces.
    expect(applyServiceEnv(target, 'SKALD_KEY=a # not a comment\nSKALD_OTHER="two words"\n').ok).toBe(true);
    expect(target["SKALD_KEY"]).toBe("a # not a comment");
    expect(target["SKALD_OTHER"]).toBe("two words");

    // Fail-closed: malformed line, duplicate keys and ambient conflicts reject.
    expect(applyServiceEnv({}, "1BAD=x\n").ok).toBe(false);
    expect(applyServiceEnv({}, 'SKALD_KEY="unterminated\n').ok).toBe(false);
    expect(applyServiceEnv({}, "SKALD_KEY=one\nSKALD_KEY=two\n").ok).toBe(false);
    const conflict = applyServiceEnv({ SKALD_KEY: "ambient" }, "SKALD_KEY=from-file\n");
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.reason).toContain("SKALD_KEY");
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
          const observation = classifyCommandResponse({ statusCode: response.statusCode, body: JSON.parse(response.body) });
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
