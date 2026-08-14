export interface AdventurePlaytestAnswers {
  readonly locationClear: boolean;
  readonly personalReason: boolean;
  readonly meaningfulChoice: boolean;
  readonly travelPaced: boolean;
  readonly conditionsAffectedDecision: boolean;
  readonly discoveryEarned: boolean;
  readonly mapBecameUseful: boolean;
  readonly worldLivedDuringAbsence: boolean;
  readonly chronicleReconstructsAdventure: boolean;
  readonly wantToContinue: boolean;
}

export interface AdventurePlaytestEvidence {
  readonly scenarioCommitSha: string;
  readonly deterministicReportPath: string;
  readonly browserTaskId: string;
  readonly model: string;
  readonly provider: string;
  readonly timeoutSeconds: number;
  readonly domNotesPath: string;
  readonly blockedChecks: readonly string[];
}

export interface AdventurePlaytestReview {
  readonly worldId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly gameplayCommands: number;
  readonly presenceAcknowledgements: number;
  readonly offlineTicks: number;
  readonly screenshots: readonly string[];
  readonly maxConsecutiveLowInformationActions: number;
  readonly evidence: AdventurePlaytestEvidence;
  readonly answers: AdventurePlaytestAnswers;
  readonly notes?: string | undefined;
}

export interface AdventurePlaytestReviewResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const ANSWER_KEYS: readonly (keyof AdventurePlaytestAnswers)[] = [
  "locationClear",
  "personalReason",
  "meaningfulChoice",
  "travelPaced",
  "conditionsAffectedDecision",
  "discoveryEarned",
  "mapBecameUseful",
  "worldLivedDuringAbsence",
  "chronicleReconstructsAdventure",
  "wantToContinue",
];

const MIN_DURATION_SECONDS = 30 * 60;
const MAX_DURATION_SECONDS = 60 * 60;
const MAX_GAMEPLAY_COMMANDS = 35;
const MIN_OFFLINE_TICKS = 24;
const MAX_OFFLINE_TICKS = 48;
const REQUIRED_SCREENSHOT_KINDS = 2;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/iu;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates the human release evidence without contacting the runtime.
 *
 * The validator deliberately requires all ten rubric answers and both desktop
 * and mobile evidence. It cannot prove that a person enjoyed the game; it
 * only prevents an incomplete report from being mistaken for a release PASS.
 */
export function validateAdventurePlaytestReview(
  review: AdventurePlaytestReview,
): AdventurePlaytestReviewResult {
  const errors: string[] = [];
  const evidence = review.evidence;
  if (!evidence || typeof evidence !== "object") {
    errors.push("evidence metadata is required");
  } else {
    if (!COMMIT_SHA_PATTERN.test(evidence.scenarioCommitSha)) errors.push("evidence.scenarioCommitSha must be a git SHA");
    if (!isNonEmptyString(evidence.deterministicReportPath)) errors.push("evidence.deterministicReportPath is required");
    if (!isNonEmptyString(evidence.browserTaskId)) errors.push("evidence.browserTaskId is required");
    if (!isNonEmptyString(evidence.model)) errors.push("evidence.model is required");
    if (!isNonEmptyString(evidence.provider)) errors.push("evidence.provider is required");
    if (!isFiniteNonNegativeInteger(evidence.timeoutSeconds) || evidence.timeoutSeconds <= 0) errors.push("evidence.timeoutSeconds must be positive");
    if (!isNonEmptyString(evidence.domNotesPath)) errors.push("evidence.domNotesPath is required");
    if (!Array.isArray(evidence.blockedChecks)) errors.push("evidence.blockedChecks must be an array");
  }

  if (!isNonEmptyString(review.worldId)) errors.push("worldId is required");
  if (!isNonEmptyString(review.startedAt) || !Number.isFinite(Date.parse(review.startedAt))) errors.push("startedAt must be an ISO timestamp");
  if (!isNonEmptyString(review.endedAt) || !Number.isFinite(Date.parse(review.endedAt))) errors.push("endedAt must be an ISO timestamp");

  if (!isFiniteNonNegativeInteger(review.durationSeconds) || review.durationSeconds < MIN_DURATION_SECONDS || review.durationSeconds > MAX_DURATION_SECONDS) {
    errors.push("durationSeconds must be between 1800 and 3600");
  }

  if (Number.isFinite(Date.parse(review.startedAt)) && Number.isFinite(Date.parse(review.endedAt))) {
    const measured = Math.round((Date.parse(review.endedAt) - Date.parse(review.startedAt)) / 1000);
    if (Math.abs(measured - review.durationSeconds) > 5) errors.push("durationSeconds does not match startedAt/endedAt");
  }

  if (!isFiniteNonNegativeInteger(review.gameplayCommands) || review.gameplayCommands > MAX_GAMEPLAY_COMMANDS) {
    errors.push("gameplayCommands must be an integer from 0 to 35");
  }
  if (review.presenceAcknowledgements !== 1) errors.push("presenceAcknowledgements must equal 1");
  if (!isFiniteNonNegativeInteger(review.offlineTicks) || review.offlineTicks < MIN_OFFLINE_TICKS || review.offlineTicks > MAX_OFFLINE_TICKS) {
    errors.push("offlineTicks must be between 24 and 48");
  }
  if (!Array.isArray(review.screenshots) || review.screenshots.length < REQUIRED_SCREENSHOT_KINDS || review.screenshots.some((path) => !isNonEmptyString(path))) {
    errors.push("screenshots must contain desktop and mobile paths");
  }
  if (!isFiniteNonNegativeInteger(review.maxConsecutiveLowInformationActions) || review.maxConsecutiveLowInformationActions > 3) {
    errors.push("maxConsecutiveLowInformationActions must be at most 3");
  }

  if (!review.answers || typeof review.answers !== "object") {
    errors.push("all ten rubric answers are required");
  } else {
    for (const key of ANSWER_KEYS) {
      if (review.answers[key] !== true) errors.push(`rubric answer ${key} must be true`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export { ANSWER_KEYS, MAX_GAMEPLAY_COMMANDS, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS };

