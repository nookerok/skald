import { describe, expect, it } from "vitest";
import {
  validateAdventurePlaytestReview,
  type AdventurePlaytestReview,
} from "../src/acceptance/playtest-review.js";

const answers = {
  locationClear: true,
  personalReason: true,
  meaningfulChoice: true,
  travelPaced: true,
  conditionsAffectedDecision: true,
  discoveryEarned: true,
  mapBecameUseful: true,
  worldLivedDuringAbsence: true,
  chronicleReconstructsAdventure: true,
  wantToContinue: true,
} as const;

function review(overrides: Partial<AdventurePlaytestReview> = {}): AdventurePlaytestReview {
  return {
    worldId: "world-disposable-review",
    startedAt: "2026-08-13T10:00:00.000Z",
    endedAt: "2026-08-13T10:30:00.000Z",
    durationSeconds: 1_800,
    gameplayCommands: 27,
    presenceAcknowledgements: 1,
    offlineTicks: 24,
    screenshots: ["desktop.png", "mobile.png"],
    maxConsecutiveLowInformationActions: 3,
    answers,
    ...overrides,
  };
}

describe("adventure playtest review", () => {
  it("accepts complete human evidence at the lower duration boundary", () => {
    expect(validateAdventurePlaytestReview(review())).toEqual({ valid: true, errors: [] });
  });

  it("accepts a review at the upper duration boundary", () => {
    const result = validateAdventurePlaytestReview(review({
      endedAt: "2026-08-13T11:00:00.000Z",
      durationSeconds: 3_600,
      offlineTicks: 48,
    }));
    expect(result.valid).toBe(true);
  });

  it("rejects a short automated browser smoke", () => {
    const result = validateAdventurePlaytestReview(review({ durationSeconds: 1_799 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("durationSeconds must be between 1800 and 3600");
  });

  it("rejects mismatched timestamps and duration", () => {
    const result = validateAdventurePlaytestReview(review({ endedAt: "2026-08-13T10:45:00.000Z" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("durationSeconds does not match startedAt/endedAt");
  });

  it("requires exactly one Presence acknowledgement and bounded commands", () => {
    const result = validateAdventurePlaytestReview(review({
      presenceAcknowledgements: 2,
      gameplayCommands: 36,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "presenceAcknowledgements must equal 1",
      "gameplayCommands must be an integer from 0 to 35",
    ]));
  });

  it("requires an offline period and desktop/mobile screenshots", () => {
    const result = validateAdventurePlaytestReview(review({
      offlineTicks: 12,
      screenshots: ["desktop.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "offlineTicks must be between 24 and 48",
      "screenshots must contain desktop and mobile paths",
    ]));
  });

  it("requires all ten rubric answers and the pacing constraint", () => {
    const result = validateAdventurePlaytestReview(review({
      answers: { ...answers, wantToContinue: false },
      maxConsecutiveLowInformationActions: 4,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "rubric answer wantToContinue must be true",
      "maxConsecutiveLowInformationActions must be at most 3",
    ]));
  });
});

