/**
 * Eval harness tests (packages/cli/test/eval-harness.test.ts).
 *
 * Covers the assertion vocabulary, the invariant auditor (leak/purity/idempotency
 * detection) and a full scripted scenario run through the deterministic core.
 */

import { describe, it, expect } from "vitest";
import { createHarness } from "../src/eval/harness.js";
import { evaluateCheck } from "../src/eval/checks.js";
import { audit, FORBIDDEN_DTO_TOKENS } from "../src/eval/auditor.js";
import type { Check, CheckContext, Scenario } from "../src/eval/types.js";

function makeContext(overrides?: Partial<CheckContext>): CheckContext {
  const emptyTranscript = { state: {}, presentation: {}, gameShell: {}, belief: { beliefs: [] } };
  return {
    allEvents: [],
    lastStepEvents: [],
    world: {
      player: { x: 1, y: 2 },
      walls: new Set(),
      observations: new Map<string, number>([["risk_taken", 5]]),
      consequences: new Map(),
      firedConsequences: new Map(),
      activeSituations: new Map(),
      burnedTrees: 0,
      relations: new Map(),
      heatSources: new Map(),
      heatMap: new Map(),
      lastActionTick: 0,
      strategy: [],
      eventNumber: 0,
      time: 0,
      objects: new Map(),
      locations: new Map(),
      currentLocationId: "",
      pendingChecks: new Map(),
      entities: new Map(),
      journeys: new Map(),
      activeJourneyId: null,
      spatial: null,
      weather: null,
      heat: null,
      settlement: null,
    } as never,
    stateJson: "{}",
    beliefJson: JSON.stringify({ beliefs: [{ id: "b1" }, { id: "b2" }] }),
    transcript: emptyTranscript,
    worldTime: 0,
    ...overrides,
  };
}

describe("eval assertion vocabulary", () => {
  it("eventTypeSeen / eventTypeAbsent", () => {
    const ctx = makeContext({ allEvents: [{ type: "TickPassed", eventId: "t", schemaVersion: 1, payload: {}, timestamp: 1, correlationId: "c", causationId: null } as never] });
    expect(evaluateCheck({ kind: "eventTypeSeen", type: "TickPassed" } as Check, ctx)).toBe("");
    expect(evaluateCheck({ kind: "eventTypeSeen", type: "Nope" } as Check, ctx)).not.toBe("");
    expect(evaluateCheck({ kind: "eventTypeAbsent", type: "Nope" } as Check, ctx)).toBe("");
    expect(evaluateCheck({ kind: "eventTypeAbsent", type: "TickPassed" } as Check, ctx)).not.toBe("");
  });

  it("observationAtLeast and worldTime and playerAt", () => {
    const ctx = makeContext({ worldTime: 7 });
    expect(evaluateCheck({ kind: "observationAtLeast", key: "risk_taken", value: 3 } as Check, ctx)).toBe("");
    expect(evaluateCheck({ kind: "observationAtLeast", key: "risk_taken", value: 9 } as Check, ctx)).not.toBe("");
    expect(evaluateCheck({ kind: "worldTime", value: 7 } as Check, ctx)).toBe("");
    expect(evaluateCheck({ kind: "playerAt", x: 1, y: 2 } as Check, ctx)).toBe("");
    expect(evaluateCheck({ kind: "playerAt", x: 9, y: 9 } as Check, ctx)).not.toBe("");
  });

  it("beliefCountMin reads the serialized belief DTO", () => {
    const ctx = makeContext();
    expect(evaluateCheck({ kind: "beliefCountMin", value: 2 } as Check, ctx)).toBe("");
    expect(evaluateCheck({ kind: "beliefCountMin", value: 5 } as Check, ctx)).not.toBe("");
  });

  it("unknown check kind is reported, not swallowed", () => {
    const ctx = makeContext();
    expect(evaluateCheck({ kind: "bogus" } as unknown as Check, ctx)).toContain("unknown check kind");
  });
});

describe("eval invariant auditor", () => {
  function cleanInput(overrides: Record<string, unknown> = {}) {
    return {
      allEvents: [],
      liveWorld: {
        player: { x: 0, y: 0 },
        walls: new Set(), observations: new Map(), consequences: new Map(), firedConsequences: new Map(),
        activeSituations: new Map(), burnedTrees: 0, relations: new Map(), heatSources: new Map(), heatMap: new Map(),
        lastActionTick: 0, strategy: [], eventNumber: 0, time: 0, objects: new Map(), locations: new Map(),
        currentLocationId: "", pendingChecks: new Map(), entities: new Map(), journeys: new Map(), activeJourneyId: null,
        spatial: null, weather: null, heat: null, settlement: null,
      } as never,
      worldTimes: [1, 2, 3],
      idempotencyProbe: { duplicateRejected: true, noNewEvents: true },
      transcriptJsons: ['{"state":{"worldTime":3}}'],
      presentationTexts: ["Мир спокоен"],
      ...overrides,
    };
  }

  it("passes on a clean transcript", () => {
    const result = audit(cleanInput());
    expect(result.noTruthLeak).toBe(true);
    expect(result.presentationHonest).toBe(true);
    expect(result.purity).toBe(true);
    expect(result.worldTimeMonotonic).toBe(true);
    expect(result.idempotency).toBe(true);
  });

  it("detects internal truth state leaking into a player DTO", () => {
    const result = audit(cleanInput({ transcriptJsons: ['{"state":{"weatherProcesses":{}}}'] }));
    expect(result.noTruthLeak).toBe(false);
    expect(result.notes.join(" ")).toContain(FORBIDDEN_DTO_TOKENS[0]);
  });

  it("detects raw internal keys in player-facing presentation", () => {
    const result = audit(cleanInput({ presentationTexts: ["Лесной пожар начался: forest_fire"] }));
    expect(result.presentationHonest).toBe(false);
  });

  it("detects non-monotonic world time", () => {
    const result = audit(cleanInput({ worldTimes: [1, 1, 2] }));
    expect(result.worldTimeMonotonic).toBe(false);
  });

  it("detects idempotency violation", () => {
    const result = audit(cleanInput({ idempotencyProbe: { duplicateRejected: true, noNewEvents: false } }));
    expect(result.idempotency).toBe(false);
  });
});

describe("eval harness scenario run", () => {
  it("a scripted living-region scenario passes with live systems", () => {
    const scenario: Scenario = {
      name: "test-living",
      worldTemplate: "living_region",
      turns: [
        { wait: 1 },
        {
          assert: {
            checks: [
              { kind: "eventTypeSeen", type: "WeatherStateChanged" },
              { kind: "eventTypeSeen", type: "RiverLevelChanged" },
              { kind: "observerMapPresent" },
            ],
          },
        },
      ],
      finalChecks: [{ kind: "worldTime", value: 1 }],
    };
    const harness = createHarness(scenario.worldTemplate, scenario.name);
    const report = harness.runScenario(scenario);
    expect(report.pass).toBe(true);
    expect(report.audit.purity).toBe(true);
    expect(report.audit.noTruthLeak).toBe(true);
  });

  it("a scenario with a wrong assertion reports a failure and not a pass", () => {
    const scenario: Scenario = {
      name: "test-bad",
      worldTemplate: "legacy",
      turns: [
        { wait: 1 },
        { assert: { checks: [{ kind: "eventTypeSeen", type: "MovementSucceeded" }] } },
      ],
    };
    const harness = createHarness(scenario.worldTemplate, scenario.name);
    const report = harness.runScenario(scenario);
    expect(report.pass).toBe(false);
    expect(report.steps.some((step) => step.failures.length > 0)).toBe(true);
  });

  it("a duplicate command key creates no new events (idempotency audit)", () => {
    const scenario: Scenario = {
      name: "test-idem",
      worldTemplate: "legacy",
      turns: [{ input: "examine old cart" }],
    };
    const harness = createHarness(scenario.worldTemplate, scenario.name);
    const report = harness.runScenario(scenario);
    expect(report.pass).toBe(true);
    expect(report.audit.idempotency).toBe(true);
  });
});
