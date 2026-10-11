/**
 * Pure helpers for the Conversation Director shadow scorecard runner (S0).
 *
 * Kept separate from the runner script so every guard is unit-testable: the
 * runner itself is an executable entry point and cannot be imported safely.
 * All of these fail closed — an unparseable value or a dirty worktree must
 * never degrade into a silent "pass".
 */

import type { GmFixture } from "./gm-corpus.js";

/** Only these untracked paths are tolerated in a scorecard worktree. */
const UNTRACKED_ALLOWLIST = /^plan_\d+\.md$/;

/**
 * Parses `GM_RUNS`. Accepts only a positive integer string; anything else
 * (`abc`, `1.5`, `0`, `-2`, `""`) is invalid so the runner can fail closed
 * instead of looping zero times and exiting 0 with no scorecard.
 *
 * @returns the run count, or `null` when the value is not a positive integer.
 */
export function parseGmRuns(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Filters `git status --porcelain` lines into offenders: any tracked change
 * and any untracked file outside the allowlist. A scorecard signed by `HEAD`
 * must describe exactly that tree, so a dirty worktree is a hard block.
 *
 * @param porcelainLines raw lines of `git status --porcelain`.
 * @returns paths that make the worktree unacceptable for scoring.
 */
export function dirtyOffenders(porcelainLines: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const line of porcelainLines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("??")) {
      const path = trimmed.slice(2).trim();
      if (!UNTRACKED_ALLOWLIST.test(path)) offenders.push(path);
      continue;
    }
    // Any tracked change (staged, unstaged, conflicted).
    offenders.push(trimmed.slice(3).trim());
  }
  return offenders;
}

/**
 * Validates the corpus itself before scoring: an `npcLabel` that names nobody
 * in the fixture scene would silently downgrade the npc check to "any visible
 * handle", so it is a configuration error, not a soft miss.
 *
 * @param corpus the fixtures about to be scored.
 * @returns human-readable configuration errors; empty means the corpus is sound.
 */
export function corpusConfigErrors(corpus: readonly GmFixture[]): string[] {
  const errors: string[] = [];
  for (const fixture of corpus) {
    const label = fixture.expected.npcLabel;
    if (label === undefined) continue;
    if (!fixture.people.some((person) => person.label === label)) {
      errors.push(`${fixture.id}: npcLabel "${label}" is not in fixture.people`);
    }
  }
  return errors;
}
