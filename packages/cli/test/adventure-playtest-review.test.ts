import { describe, expect, it } from "vitest";
import {
  validateAdventurePlaytestReview,
  defaultPlaytestRuntime,
  type AdventurePlaytestReview,
  type PlaytestReviewRuntime,
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

const RUNTIME_SHA = "7575189abcdef0123456789abcdef0123456789";
const PNG_SIGNATURE = "89504e470d0a1a0a";

const reportJson = JSON.stringify({
  scenario: "disposable-review",
  pass: true,
  requiredBeatsCovered: 1,
  meaningfulPlayerChoices: 4,
  journeyLegsCompleted: 4,
  worldChangesEncountered: 4,
  discoveriesAdvanced: 4,
  mapKnowledgeGrowth: 3,
  offlineMeaningfulEvents: 90,
  chatAlternationIntegrity: true,
  chronicleCoverage: 1,
  narrationDuplicateRate: 0,
  truthLeakCount: 0,
  orphanResponseCount: 0,
  replayPurity: true,
  idempotency: true,
  persistenceRestart: true,
  offlineObservationLeak: 0,
  missingRequiredBeats: [],
  failures: [],
  httpFailures: [],
  trace: {},
  transcript: [],
});

const domNotes = "# Browser DOM notes\n\nPlayer and master alternated turns across the desktop and mobile surface. The map, journal and belief panels rendered, no console errors observed.";

/**
 * Builds a fake runtime backed by an in-memory map of paths to text content,
 * a set of image paths whose signature reads as a real PNG, and the live
 * configured model/provider lists.
 */
function runtime(opts: {
  readonly text?: Readonly<Record<string, string>>;
  readonly images?: readonly string[];
  readonly models?: readonly string[];
  readonly providers?: readonly string[];
} = {}): PlaytestReviewRuntime {
  const text = new Map(Object.entries(opts.text ?? {}));
  const images = new Set(opts.images ?? []);
  const models = opts.models ?? ["deepseek-v4-flash-free", "nemotron-3-ultra-free", "gemma4:31b"];
  const providers = opts.providers ?? ["opencode_zen", "ollama_cloud"];
  return {
    currentCommitSha: () => RUNTIME_SHA,
    fileExists: (path) => text.has(path) || images.has(path),
    readFileText: (path) => text.get(path),
    readFileSignature: (path) => (images.has(path) ? PNG_SIGNATURE : undefined),
    validModels: models,
    validProviders: providers,
  };
}

function review(overrides: Partial<AdventurePlaytestReview> = {}): AdventurePlaytestReview {
  return {
    worldId: "world-disposable-review",
    startedAt: "2026-08-13T10:00:00.000Z",
    endedAt: "2026-08-13T10:30:00.000Z",
    durationSeconds: 1_800,
    gameplayCommands: 27,
    presenceAcknowledgements: 1,
    offlineTicks: 24,
    screenshots: ["artifacts/desktop.png", "artifacts/mobile.png"],
    maxConsecutiveLowInformationActions: 3,
    evidence: {
      scenarioCommitSha: "7575189",
      deterministicReportPath: "acceptance-out/adventure.json",
      browserTaskId: "019fa52b-1610-7b23-9567-37891d24c782",
      model: "deepseek-v4-flash-free",
      provider: "opencode_zen",
      timeoutSeconds: 120,
      domNotesPath: "docs/acceptance/browser-dom.md",
      blockedChecks: [],
    },
    answers,
    ...overrides,
  };
}

function fullRuntime(): PlaytestReviewRuntime {
  return runtime({
    text: {
      "acceptance-out/adventure.json": reportJson,
      "docs/acceptance/browser-dom.md": domNotes,
    },
    images: ["artifacts/desktop.png", "artifacts/mobile.png"],
  });
}

describe("adventure playtest review", () => {
  it("accepts complete human evidence at the lower duration boundary", () => {
    expect(validateAdventurePlaytestReview(review(), fullRuntime())).toEqual({ valid: true, errors: [] });
  });

  it("accepts a review at the upper duration boundary", () => {
    const result = validateAdventurePlaytestReview(review({
      endedAt: "2026-08-13T11:00:00.000Z",
      durationSeconds: 3_600,
      offlineTicks: 48,
    }), fullRuntime());
    expect(result.valid).toBe(true);
  });

  it("rejects a short automated browser smoke", () => {
    const result = validateAdventurePlaytestReview(review({ durationSeconds: 1_799 }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("durationSeconds must be between 1800 and 3600");
  });

  it("rejects mismatched timestamps and duration", () => {
    const result = validateAdventurePlaytestReview(review({ endedAt: "2026-08-13T10:45:00.000Z" }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("durationSeconds does not match startedAt/endedAt");
  });

  it("requires exactly one Presence acknowledgement and bounded commands", () => {
    const result = validateAdventurePlaytestReview(review({
      presenceAcknowledgements: 2,
      gameplayCommands: 36,
    }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "presenceAcknowledgements must equal 1",
      "gameplayCommands must be an integer from 1 to 35",
    ]));
  });

  it("rejects formally empty evidence: zero gameplay commands", () => {
    const result = validateAdventurePlaytestReview(review({ gameplayCommands: 0 }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("gameplayCommands must be an integer from 1 to 35");
  });

  it("rejects a commit sha that does not match the runtime commit", () => {
    const result = validateAdventurePlaytestReview(review({
      evidence: { ...review().evidence, scenarioCommitSha: "fedcba9" },
    }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("evidence.scenarioCommitSha does not match the runtime commit");
  });

  it("rejects missing report, dom notes and screenshot artifacts", () => {
    const result = validateAdventurePlaytestReview(review(), runtime({
      text: {
        "acceptance-out/adventure.json": reportJson,
        "docs/acceptance/browser-dom.md": domNotes,
      },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "screenshot artifact does not exist: artifacts/desktop.png",
      "screenshot artifact does not exist: artifacts/mobile.png",
    ]));
  });

  it("rejects a missing deterministic report and dom notes on disk", () => {
    const result = validateAdventurePlaytestReview(review(), runtime({
      images: ["artifacts/desktop.png", "artifacts/mobile.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "evidence.deterministicReportPath does not exist",
      "evidence.domNotesPath does not exist",
    ]));
  });

  it("rejects blocked checks", () => {
    const result = validateAdventurePlaytestReview(review({
      evidence: { ...review().evidence, blockedChecks: ["browser-qa-unavailable"] },
    }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("evidence.blockedChecks must be empty");
  });

  it("rejects arbitrary .png strings as desktop/mobile evidence", () => {
    const result = validateAdventurePlaytestReview(review({
      screenshots: ["artifacts/a.png", "artifacts/b.png"],
    }), runtime({
      text: {
        "acceptance-out/adventure.json": reportJson,
        "docs/acceptance/browser-dom.md": domNotes,
      },
      images: ["artifacts/a.png", "artifacts/b.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "screenshots must include a desktop screenshot",
      "screenshots must include a mobile screenshot",
    ]));
  });

  it("requires an offline period and desktop/mobile screenshots", () => {
    const result = validateAdventurePlaytestReview(review({
      offlineTicks: 12,
      screenshots: ["artifacts/desktop.png"],
    }), runtime({
      text: {
        "acceptance-out/adventure.json": reportJson,
        "docs/acceptance/browser-dom.md": domNotes,
      },
      images: ["artifacts/desktop.png"],
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
    }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "rubric answer wantToContinue must be true",
      "maxConsecutiveLowInformationActions must be at most 3",
    ]));
  });

  it("requires reproducible evidence metadata", () => {
    const result = validateAdventurePlaytestReview(review({
      evidence: { ...review().evidence, scenarioCommitSha: "not-a-sha" },
    }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("evidence.scenarioCommitSha must be a git SHA");
  });

  it("rejects text stubs masquerading as screenshot evidence", () => {
    const result = validateAdventurePlaytestReview(review({
      screenshots: ["artifacts/desktop.txt", "artifacts/mobile.txt"],
    }), runtime({
      text: {
        "acceptance-out/adventure.json": reportJson,
        "docs/acceptance/browser-dom.md": domNotes,
        "artifacts/desktop.txt": "this is not an image",
        "artifacts/mobile.txt": "this is not an image",
      },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "screenshot artifact must be a real image file: artifacts/desktop.txt",
      "screenshot artifact must be a real image file: artifacts/mobile.txt",
    ]));
  });

  it("rejects an empty deterministic report JSON", () => {
    const result = validateAdventurePlaytestReview(review(), runtime({
      text: {
        "acceptance-out/adventure.json": "",
        "docs/acceptance/browser-dom.md": domNotes,
      },
      images: ["artifacts/desktop.png", "artifacts/mobile.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("evidence.deterministicReportPath must not be empty");
  });

  it("rejects report JSON that is not valid JSON", () => {
    const result = validateAdventurePlaytestReview(review(), runtime({
      text: {
        "acceptance-out/adventure.json": "not-json",
        "docs/acceptance/browser-dom.md": domNotes,
      },
      images: ["artifacts/desktop.png", "artifacts/mobile.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("does not conform to the adventure report schema")]));
  });

  it("rejects report JSON that does not conform to the adventure report schema", () => {
    const result = validateAdventurePlaytestReview(review(), runtime({
      text: {
        "acceptance-out/adventure.json": JSON.stringify({ pass: false, scenario: "x" }),
        "docs/acceptance/browser-dom.md": domNotes,
      },
      images: ["artifacts/desktop.png", "artifacts/mobile.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("pass must be true"),
      expect.stringContaining("requiredBeatsCovered must be a finite number"),
    ]));
  });

  it("rejects a hand-written pass report whose invariants failed", () => {
    const failedReport = JSON.parse(reportJson) as Record<string, unknown>;
    failedReport.pass = true;
    failedReport.requiredBeatsCovered = 0;
    failedReport.meaningfulPlayerChoices = 0;
    failedReport.missingRequiredBeats = ["journey_reached_ruins"];
    failedReport.chatAlternationIntegrity = false;
    failedReport.replayPurity = false;
    failedReport.idempotency = false;
    failedReport.persistenceRestart = false;
    const result = validateAdventurePlaytestReview(review(), runtime({
      text: {
        "acceptance-out/adventure.json": JSON.stringify(failedReport),
        "docs/acceptance/browser-dom.md": domNotes,
      },
      images: ["artifacts/desktop.png", "artifacts/mobile.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("missingRequiredBeats must be empty"),
      expect.stringContaining("chatAlternationIntegrity must be true"),
      expect.stringContaining("requiredBeatsCovered must equal 1"),
      expect.stringContaining("meaningfulPlayerChoices must be at least 3"),
    ]));
  });

  it("rejects an empty or stub dom notes file", () => {
    const result = validateAdventurePlaytestReview(review(), runtime({
      text: {
        "acceptance-out/adventure.json": reportJson,
        "docs/acceptance/browser-dom.md": "",
      },
      images: ["artifacts/desktop.png", "artifacts/mobile.png"],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("non-empty notes file")]));
  });

  it("rejects a placeholder browser task id", () => {
    const result = validateAdventurePlaytestReview(review({
      evidence: { ...review().evidence, browserTaskId: "<fixed-ntfs-task-id>" },
    }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("evidence.browserTaskId must be a task id");
  });

  it("rejects a placeholder model or provider", () => {
    const result = validateAdventurePlaytestReview(review({
      evidence: {
        ...review().evidence,
        model: "configured-live-model",
        provider: "configured-provider",
      },
    }), fullRuntime());
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "evidence.model must be a configured model",
      "evidence.provider must be a configured provider",
    ]));
  });

  it("default runtime pins to git HEAD and real artifacts", () => {
    const runtime = defaultPlaytestRuntime();
    expect(runtime.currentCommitSha()).toMatch(/^[0-9a-f]{7,64}$/);
  });
});
