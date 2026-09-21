import { describe, expect, it } from "vitest";
import {
  INTERPRETATION_CORPUS,
  classifyOutcome,
  evaluateEntry,
  scoreCorpus,
  type CorpusEntry,
  type InterpretationObservation,
} from "../src/acceptance/interpretation-corpus.js";

function observation(overrides: Partial<InterpretationObservation> = {}): InterpretationObservation {
  return { status: "plan", kind: "action", primary: "action", queryId: null, genericFallback: false, ...overrides };
}

describe("interpretation corpus (full-master Stage 1)", () => {
  it("holds 80-120 unique real replicas with complete expectations", () => {
    expect(INTERPRETATION_CORPUS.length).toBeGreaterThanOrEqual(80);
    expect(INTERPRETATION_CORPUS.length).toBeLessThanOrEqual(120);
    const inputs = INTERPRETATION_CORPUS.map((entry) => entry.input.trim());
    expect(new Set(inputs).size).toBe(inputs.length);
    for (const entry of INTERPRETATION_CORPUS) {
      expect(entry.input.trim().length).toBeGreaterThan(0);
      expect(entry.expect.length).toBeGreaterThan(0);
    }
  });

  it("scores a matching observation as correct", () => {
    const entry: CorpusEntry = { input: "где я?", expect: ["inquiry"], primary: ["inquiry"], queryId: "current_location" };
    expect(evaluateEntry(entry, observation({ kind: "inquiry", primary: "inquiry", queryId: "current_location" })).ok).toBe(true);
  });

  it("rejects a generic clarification outright", () => {
    const entry: CorpusEntry = { input: "осматриваюсь", expect: ["action"] };
    const evaluation = evaluateEntry(entry, observation({ kind: "clarification", primary: null, genericFallback: true }));
    expect(evaluation.ok).toBe(false);
    expect(evaluation.reason).toBe("generic_clarification");
  });

  it("rejects the wrong class, primary and query", () => {
    const entry: CorpusEntry = { input: "куда можно пойти?", expect: ["inquiry"], primary: ["inquiry"], queryId: "available_routes" };
    expect(evaluateEntry(entry, observation({ kind: "action" })).ok).toBe(false);
    expect(evaluateEntry(entry, observation({ kind: "inquiry", primary: "meta" })).ok).toBe(false);
    expect(evaluateEntry(entry, observation({ kind: "inquiry", primary: "inquiry", queryId: "who_is_nearby" })).ok).toBe(false);
  });

  it("fails when a declared primary or query is missing entirely", () => {
    const inquiry: CorpusEntry = { input: "где я?", expect: ["inquiry"], primary: ["inquiry"], queryId: "current_location" };
    // An inquiry outcome without its expected query must not pass.
    expect(evaluateEntry(inquiry, observation({ kind: "inquiry", primary: "inquiry", queryId: null })).ok).toBe(false);
    // An executable class without any primary must not pass.
    const action: CorpusEntry = { input: "осматриваюсь", expect: ["action"], primary: ["action"] };
    expect(evaluateEntry(action, observation({ kind: "action", primary: null })).ok).toBe(false);
  });

  it("still accepts a declared clarification when the entry allows it", () => {
    const entry: CorpusEntry = { input: "подхожу к нему", expect: ["action", "clarification"], primary: ["action"] };
    expect(evaluateEntry(entry, observation({ kind: "clarification", primary: null })).ok).toBe(true);
  });

  it("aggregates a corpus score with failures and generic count", () => {
    const entries: readonly CorpusEntry[] = [
      { input: "осматриваюсь", expect: ["action"] },
      { input: "где я?", expect: ["inquiry"], primary: ["inquiry"] },
    ];
    const score = scoreCorpus(entries, [
      observation({ kind: "action" }),
      observation({ kind: "clarification", primary: null, genericFallback: true }),
    ]);
    expect(score.total).toBe(2);
    expect(score.correct).toBe(1);
    expect(score.rate).toBe(0.5);
    expect(score.genericFallback).toBe(1);
    expect(score.failures).toHaveLength(1);
  });

  it("classifies each gateway outcome shape", () => {
    expect(classifyOutcome({ status: "deterministic", intent: { type: "InteractionCommand" } } as never))
      .toMatchObject({ kind: "action", primary: "action" });
    expect(classifyOutcome({ status: "inquiry", inquiry: { queryId: "who_is_nearby" } } as never))
      .toMatchObject({ kind: "inquiry", primary: "inquiry", queryId: "who_is_nearby" });
    expect(classifyOutcome({ status: "clarification", question: "К кому именно — А или Б?", options: [] } as never))
      .toMatchObject({ kind: "clarification", genericFallback: false });
    expect(classifyOutcome({
      status: "plan",
      plan: { kind: "mixed", execution: { intent: { type: "InteractionCommand" } }, postActionInquiries: [{ queryId: "visible_scene" }] },
      scene: {},
    } as never)).toMatchObject({ kind: "mixed", primary: "action", queryId: "visible_scene" });
  });
});
