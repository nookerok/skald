import { readFileSync } from "node:fs";
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
});
