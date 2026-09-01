import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ADVENTURE_COMMANDS,
  MIN_ADVENTURE_COMMANDS,
  validateAdventureScenario,
} from "../src/acceptance/adventure-contract.js";
import type { AdventureScenario } from "../src/acceptance/adventure-types.js";

function loadScenario(): AdventureScenario {
  return JSON.parse(readFileSync(resolve(process.cwd(), "packages/cli/acceptance-scenarios/riverwatch-old-course.json"), "utf8")) as AdventureScenario;
}

function loadGoldenWorld(): {
  schemaVersion: number;
  milestones: readonly { id: string; targetMinutes: number; evidenceType: string }[];
  requiredUiSelectors: readonly string[];
  sourceScenario: string;
  humanGate: { automatedChecksAreNotHumanEvidence: boolean };
} {
  return JSON.parse(readFileSync(resolve(process.cwd(), "docs/acceptance/golden-world.json"), "utf8")) as {
    schemaVersion: number;
    milestones: readonly { id: string; targetMinutes: number; evidenceType: string }[];
    requiredUiSelectors: readonly string[];
    sourceScenario: string;
    humanGate: { automatedChecksAreNotHumanEvidence: boolean };
  };
}

describe("full adventure scenario contract", () => {
  it("keeps the canonical scenario long enough to represent an adventure", () => {
    expect(validateAdventureScenario(loadScenario())).toEqual([]);
  });

  it("rejects a shortened smoke with missing release beats", () => {
    const scenario = loadScenario();
    const shortened = {
      ...scenario,
      turns: scenario.turns.filter((step) => "say" in step).slice(0, MIN_ADVENTURE_COMMANDS - 1),
    };
    const errors = validateAdventureScenario(shortened);
    expect(errors).toContain(`command count must be between ${MIN_ADVENTURE_COMMANDS} and ${MAX_ADVENTURE_COMMANDS}`);
    expect(errors).toContain("exactly one offline period is required");
  });

  it("rejects an over-budget scenario", () => {
    const scenario = loadScenario();
    const commands = scenario.turns.filter((step) => "say" in step);
    const overBudget = { ...scenario, turns: [...scenario.turns, ...commands] };
    expect(validateAdventureScenario(overBudget)).toContain(`command count must be between ${MIN_ADVENTURE_COMMANDS} and ${MAX_ADVENTURE_COMMANDS}`);
  });

  it("declares the first-15-minute contract and keeps human evidence explicit", () => {
    const golden = loadGoldenWorld();
    expect(golden.schemaVersion).toBe(1);
    expect(golden.milestones.map((milestone) => milestone.id)).toEqual([
      "first-consequence",
      "first-observation",
      "first-question",
    ]);
    expect(golden.milestones.map((milestone) => milestone.targetMinutes)).toEqual([5, 10, 15]);
    expect(golden.milestones.map((milestone) => milestone.evidenceType)).toEqual(["human", "human", "human"]);
    expect(golden.requiredUiSelectors).toEqual(expect.arrayContaining([
      "#command-form",
      "#command-input",
      "#send-btn",
      "#open-map-btn",
      "#open-knowledge-btn",
      "#chat-feed",
    ]));
    expect(existsSync(resolve(process.cwd(), golden.sourceScenario))).toBe(true);
    expect(golden.humanGate.automatedChecksAreNotHumanEvidence).toBe(true);
  });
});
