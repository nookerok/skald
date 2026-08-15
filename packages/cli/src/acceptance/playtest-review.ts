import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LLM_CONFIG } from "@skald/world";
import { validateAdventureReport } from "./adventure-report.js";

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

export interface PlaytestReviewRuntime {
  /** Current commit SHA of the runtime the evidence was produced against. */
  readonly currentCommitSha: () => string;
  /** True when a report-relative artifact path exists on disk. */
  readonly fileExists: (path: string) => boolean;
  /** UTF-8 text content of an artifact, or undefined when missing/unreadable. */
  readonly readFileText: (path: string) => string | undefined;
  /** First 8 bytes of a binary artifact as lowercase hex, or undefined when missing. */
  readonly readFileSignature: (path: string) => string | undefined;
  /** Models the runtime is actually configured to use. */
  readonly validModels: readonly string[];
  /** Providers the runtime is actually configured to use. */
  readonly validProviders: readonly string[];
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
const MIN_GAMEPLAY_COMMANDS = 1;
const MAX_GAMEPLAY_COMMANDS = 35;
const MIN_OFFLINE_TICKS = 24;
const MAX_OFFLINE_TICKS = 48;
const REQUIRED_SCREENSHOT_KINDS = 2;
const MIN_DOM_NOTES_CHARS = 40;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/iu;
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/iu;
/** Leading magic bytes (hex) of the image formats the browser QA captures. */
const IMAGE_MAGIC: readonly string[] = Object.freeze([
  "89504e47", // PNG
  "ffd8ff", // JPEG
  "47494638", // GIF87a/89a
  "52494646", // RIFF (WebP)
]);

const PLACEHOLDER_LABELS = new Set<string>(["unknown", "test", "dummy", "placeholder", "none", "n/a", "x"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlaceholderLabel(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3) return true;
  if (trimmed.includes("<") || trimmed.includes(">")) return true;
  return PLACEHOLDER_LABELS.has(trimmed.toLowerCase());
}

function isConfiguredValue(value: string, configured: readonly string[]): boolean {
  if (configured.length === 0) return !isPlaceholderLabel(value);
  const query = value.trim().toLowerCase();
  return configured.some((name) => name.toLowerCase() === query);
}

function isScreenshotImage(path: string, signature: string | undefined): boolean {
  if (!IMAGE_EXTENSION.test(path)) return false;
  if (!signature) return false;
  return IMAGE_MAGIC.some((magic) => signature.startsWith(magic));
}

/** Default runtime: resolve artifacts against the working directory and pin to git HEAD. */
export function defaultPlaytestRuntime(): PlaytestReviewRuntime {
  return {
    currentCommitSha: () => {
      try {
        return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
      } catch {
        return "unknown";
      }
    },
    fileExists: (path) => existsSync(resolve(process.cwd(), path)),
    readFileText: (path) => {
      try {
        return readFileSync(resolve(process.cwd(), path), "utf8");
      } catch {
        return undefined;
      }
    },
    readFileSignature: (path) => {
      try {
        const buffer = readFileSync(resolve(process.cwd(), path));
        const slice = buffer.subarray(0, 8);
        return [...slice].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      } catch {
        return undefined;
      }
    },
    validModels: [...new Set(Object.values(LLM_CONFIG.routes).flatMap((route) => route.models))],
    validProviders: [...new Set([LLM_CONFIG.policy.skaldProvider, ...Object.keys(LLM_CONFIG.providers)])],
  };
}

/**
 * Validates the human release evidence against the runtime it claims to be
 * from. The gate refuses formally empty reports: it requires at least one
 * gameplay command, a scenario commit that matches the current runtime commit,
 * real artifacts on disk whose content matches their claimed type (an actual
 * adventure report JSON, non-empty DOM notes, real image files), a configured
 * model/provider and task id, desktop and mobile screenshot evidence, no
 * blocked checks, and all ten truthful rubric answers. It cannot prove that a
 * person enjoyed the game; it only prevents an incomplete report from being
 * mistaken for a release PASS.
 */
export function validateAdventurePlaytestReview(
  review: AdventurePlaytestReview,
  runtime: PlaytestReviewRuntime = defaultPlaytestRuntime(),
): AdventurePlaytestReviewResult {
  const errors: string[] = [];
  const evidence = review.evidence;
  if (!evidence || typeof evidence !== "object") {
    errors.push("evidence metadata is required");
  } else {
    if (!COMMIT_SHA_PATTERN.test(evidence.scenarioCommitSha)) errors.push("evidence.scenarioCommitSha must be a git SHA");
    const runtimeSha = runtime.currentCommitSha();
    if (runtimeSha !== "unknown" && runtimeSha !== evidence.scenarioCommitSha && !runtimeSha.startsWith(evidence.scenarioCommitSha)) {
      errors.push("evidence.scenarioCommitSha does not match the runtime commit");
    }
    if (!isNonEmptyString(evidence.deterministicReportPath)) errors.push("evidence.deterministicReportPath is required");
    else if (!runtime.fileExists(evidence.deterministicReportPath)) errors.push("evidence.deterministicReportPath does not exist");
    else {
      const content = runtime.readFileText(evidence.deterministicReportPath);
      if (!content || content.trim().length === 0) errors.push("evidence.deterministicReportPath must not be empty");
      else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          parsed = undefined;
        }
        const schema = parsed === undefined ? ["must be valid JSON"] : validateAdventureReport(parsed);
        if (schema.length > 0) errors.push(`evidence.deterministicReportPath does not conform to the adventure report schema: ${schema.join(", ")}`);
      }
    }
    if (!isNonEmptyString(evidence.browserTaskId)) errors.push("evidence.browserTaskId is required");
    else if (!TASK_ID_PATTERN.test(evidence.browserTaskId.trim())) errors.push("evidence.browserTaskId must be a task id");
    if (!isNonEmptyString(evidence.model)) errors.push("evidence.model is required");
    else if (!isConfiguredValue(evidence.model, runtime.validModels)) errors.push("evidence.model must be a configured model");
    if (!isNonEmptyString(evidence.provider)) errors.push("evidence.provider is required");
    else if (!isConfiguredValue(evidence.provider, runtime.validProviders)) errors.push("evidence.provider must be a configured provider");
    if (!isFiniteNonNegativeInteger(evidence.timeoutSeconds) || evidence.timeoutSeconds <= 0) errors.push("evidence.timeoutSeconds must be positive");
    if (!isNonEmptyString(evidence.domNotesPath)) errors.push("evidence.domNotesPath is required");
    else if (!runtime.fileExists(evidence.domNotesPath)) errors.push("evidence.domNotesPath does not exist");
    else {
      const content = runtime.readFileText(evidence.domNotesPath);
      if (!content || content.trim().length < MIN_DOM_NOTES_CHARS) {
        errors.push(`evidence.domNotesPath must be a non-empty notes file with at least ${MIN_DOM_NOTES_CHARS} characters`);
      }
    }
    if (!Array.isArray(evidence.blockedChecks)) errors.push("evidence.blockedChecks must be an array");
    else if (evidence.blockedChecks.length > 0) errors.push("evidence.blockedChecks must be empty");
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

  if (!isFiniteNonNegativeInteger(review.gameplayCommands) || review.gameplayCommands < MIN_GAMEPLAY_COMMANDS || review.gameplayCommands > MAX_GAMEPLAY_COMMANDS) {
    errors.push(`gameplayCommands must be an integer from ${MIN_GAMEPLAY_COMMANDS} to ${MAX_GAMEPLAY_COMMANDS}`);
  }
  if (review.presenceAcknowledgements !== 1) errors.push("presenceAcknowledgements must equal 1");
  if (!isFiniteNonNegativeInteger(review.offlineTicks) || review.offlineTicks < MIN_OFFLINE_TICKS || review.offlineTicks > MAX_OFFLINE_TICKS) {
    errors.push("offlineTicks must be between 24 and 48");
  }
  if (!Array.isArray(review.screenshots) || review.screenshots.length < REQUIRED_SCREENSHOT_KINDS || review.screenshots.some((path) => !isNonEmptyString(path))) {
    errors.push("screenshots must contain desktop and mobile paths");
  } else {
    if (!review.screenshots.some((path) => /desktop/i.test(path))) errors.push("screenshots must include a desktop screenshot");
    if (!review.screenshots.some((path) => /mobile/i.test(path))) errors.push("screenshots must include a mobile screenshot");
    for (const screenshot of review.screenshots) {
      if (!runtime.fileExists(screenshot)) errors.push(`screenshot artifact does not exist: ${screenshot}`);
      else if (!isScreenshotImage(screenshot, runtime.readFileSignature(screenshot))) {
        errors.push(`screenshot artifact must be a real image file: ${screenshot}`);
      }
    }
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

export { ANSWER_KEYS, MAX_GAMEPLAY_COMMANDS, MIN_GAMEPLAY_COMMANDS, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS };