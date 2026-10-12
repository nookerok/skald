/**
 * Shadow scorecard runner guards (S0): GM_RUNS parsing, dirty-worktree
 * detection and corpus self-validation. All fail-closed pure helpers — the
 * runner script itself is an entry point and is not importable.
 */

import { describe, expect, it } from "vitest";
import { parseGmRuns, dirtyOffenders, corpusConfigErrors } from "../src/acceptance/scorecard-env.js";
import { GM_CORPUS } from "../src/acceptance/gm-corpus.js";

describe("parseGmRuns", () => {
  it("accepts only positive integers", () => {
    expect(parseGmRuns(undefined)).toBe(1);
    expect(parseGmRuns("1")).toBe(1);
    expect(parseGmRuns("3")).toBe(3);
  });

  it("rejects anything else (fail-closed, no silent zero-loop)", () => {
    expect(parseGmRuns("abc")).toBeNull();
    expect(parseGmRuns("1.5")).toBeNull();
    expect(parseGmRuns("0")).toBeNull();
    expect(parseGmRuns("-2")).toBeNull();
    expect(parseGmRuns("")).toBeNull();
    expect(parseGmRuns("01")).toBeNull(); // leading zero is not a plain positive integer
  });
});

describe("dirtyOffenders", () => {
  it("tolerates only untracked plan_*.md files", () => {
    expect(dirtyOffenders(["?? plan_1.md", "?? plan_12.md"])).toEqual([]);
  });

  it("blocks tracked changes and unexpected untracked files", () => {
    const offenders = dirtyOffenders([
      " M packages/cli/src/conversation/gm-prompt.ts", // tracked modification
      "M  staged.ts", // staged
      "?? packages/cli/src/acceptance/new-source.ts", // untracked source
      "?? plan_x.md", // wrong name pattern
    ]);
    expect(offenders).toEqual([
      "packages/cli/src/conversation/gm-prompt.ts",
      "staged.ts",
      "packages/cli/src/acceptance/new-source.ts",
      "plan_x.md",
    ]);
  });

  it("ignores empty lines", () => {
    expect(dirtyOffenders(["", "?? plan_1.md", ""])).toEqual([]);
  });
});

describe("corpusConfigErrors", () => {
  it("accepts the shipped corpus", () => {
    expect(corpusConfigErrors(GM_CORPUS)).toEqual([]);
  });

  it("rejects an npcLabel or subjectLabel that names nobody in the fixture scene", () => {
    const brokenNpc = [{
      ...GM_CORPUS[0],
      expected: { ...GM_CORPUS[0].expected, npcLabel: "Кого нет" },
    }];
    const npcErrors = corpusConfigErrors(brokenNpc);
    expect(npcErrors).toHaveLength(1);
    expect(npcErrors[0]).toContain("npcLabel");
    expect(npcErrors[0]).toContain("Кого нет");

    const brokenSubject = [{
      ...GM_CORPUS[0],
      expected: { ...GM_CORPUS[0].expected, subjectLabel: "Кого нет" },
    }];
    const subjectErrors = corpusConfigErrors(brokenSubject);
    expect(subjectErrors).toHaveLength(1);
    expect(subjectErrors[0]).toContain("subjectLabel");
  });
});
