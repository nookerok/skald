import { describe, expect, it } from "vitest";
import {
  PREFLIGHT_CAPABILITIES,
  QA_AREA_NAMES,
  buildBrowserQaReport,
  evaluatePreflightGate,
  preflightBlockedCapabilities,
  summarizeBrowserQaVerdict,
  validateBrowserQaPreflight,
  validateBrowserQaReport,
} from "../src/acceptance/browser-qa-contract.js";
import type {
  BrowserQaAreaVerdicts,
  BrowserQaEvidence,
  BrowserQaPreflight,
  PreflightCapability,
  PreflightProbe,
} from "../src/acceptance/browser-qa-contract.js";
function probe(capability: PreflightCapability, status: "pass" | "blocked", detail?: string): PreflightProbe {
  return detail === undefined ? { capability, status } : { capability, status, detail };
}

function fullPreflight(status: "pass" | "blocked" = "pass"): BrowserQaPreflight {
  return {
    jobId: "qa-1",
    probes: PREFLIGHT_CAPABILITIES.map((capability) => probe(capability, status)),
  };
}

function allPass(): BrowserQaAreaVerdicts {
  return { repository: "pass", api: "pass", browser: "pass", visual: "pass", provider: "pass", human: "pass" };
}

function evidence(over: Partial<BrowserQaEvidence> = {}): BrowserQaEvidence {
  return {
    jobId: "qa-1",
    deployedCommit: "abc123",
    browserWorldId: "world-1",
    apiWorldId: "world-1",
    inputs: [{ index: 0, input: "осмотреться", httpStatus: 200, responseKind: "action_outcome", worldTimeBefore: 0, worldTimeAfter: 1 }],
    domAssertions: [{ id: "composer-visible", selector: "#command-input", passed: true }],
    consoleMessages: [],
    screenshots: ["world.png"],
    blockedCapabilities: [],
    mutationCount: 1,
    clickBudget: 5,
    verdicts: allPass(),
    ...over,
  };
}

describe("plan_9 §15 preflight gate", () => {
  it("fixes the six required capabilities", () => {
    expect([...PREFLIGHT_CAPABILITIES]).toEqual(["browser", "viewport", "screenshot", "dom", "console", "report_dir"]);
    expect(Object.isFrozen(PREFLIGHT_CAPABILITIES)).toBe(true);
  });

  it("proceeds only when every capability passes", () => {
    expect(evaluatePreflightGate(fullPreflight("pass"))).toBe("proceed");
  });

  it("stops before the first mutation when anything is blocked", () => {
    const preflight = fullPreflight("pass");
    const console = preflight.probes.map((entry) => (entry.capability === "console" ? probe("console", "blocked", "capture unavailable") : entry));
    expect(evaluatePreflightGate({ ...preflight, probes: console })).toBe("stop");
  });

  it("stops when a probe is missing entirely", () => {
    const preflight = fullPreflight("pass");
    expect(evaluatePreflightGate({ ...preflight, probes: preflight.probes.slice(0, 5) })).toBe("stop");
  });

  it("proceeds reduced only with an explicit acknowledgment covering every gap", () => {
    const preflight = fullPreflight("pass");
    const probes = preflight.probes.map((entry) => (entry.capability === "console" ? probe("console", "blocked") : entry));
    const acknowledged: BrowserQaPreflight = { ...preflight, probes, reducedScope: { missing: ["console"], acknowledgedBy: "operator" } };
    expect(evaluatePreflightGate(acknowledged)).toBe("proceed_reduced");
    const partial: BrowserQaPreflight = { ...preflight, probes, reducedScope: { missing: ["dom"], acknowledgedBy: "operator" } };
    expect(evaluatePreflightGate(partial)).toBe("stop");
    const anonymous: BrowserQaPreflight = { ...preflight, probes, reducedScope: { missing: ["console"], acknowledgedBy: "  " } };
    expect(evaluatePreflightGate(anonymous)).toBe("stop");
  });

  it("lists blocked capabilities deduplicated in probe order", () => {
    const preflight: BrowserQaPreflight = {
      jobId: "qa-1",
      probes: [probe("console", "blocked"), probe("browser", "pass"), probe("console", "blocked"), probe("viewport", "blocked")],
    };
    expect([...preflightBlockedCapabilities(preflight)]).toEqual(["console", "viewport"]);
    expect(preflightBlockedCapabilities(fullPreflight("pass"))).toEqual([]);
  });
});

describe("validateBrowserQaPreflight", () => {
  it("accepts a complete preflight", () => {
    expect(validateBrowserQaPreflight(fullPreflight())).toEqual([]);
  });

  it("rejects malformed preflights", () => {
    expect(validateBrowserQaPreflight(null)).toEqual(["must be a JSON object"]);
    expect(validateBrowserQaPreflight({ ...fullPreflight(), jobId: "  " })).toContain("jobId must be a non-empty string");
    expect(validateBrowserQaPreflight({ jobId: "qa-1", probes: [] })).toContain("probes must be a non-empty array");
    expect(validateBrowserQaPreflight({ jobId: "qa-1", probes: [{ capability: "teleport", status: "pass" }] }))
      .toContain("unknown preflight capability: teleport");
    const dup = fullPreflight();
    expect(validateBrowserQaPreflight({ ...dup, probes: [...dup.probes, probe("browser", "pass")] }))
      .toContain("duplicate preflight probe: browser");
    const badStatus = fullPreflight().probes.map((entry) => ({ ...entry, status: "maybe" }));
    expect(validateBrowserQaPreflight({ jobId: "qa-1", probes: badStatus }).some((message) => message.includes("must be pass or blocked"))).toBe(true);
    expect(validateBrowserQaPreflight({ jobId: "qa-1", probes: fullPreflight().probes.slice(1) }))
      .toContain("missing preflight probe: browser");
    expect(validateBrowserQaPreflight({ ...fullPreflight(), reducedScope: { missing: [], acknowledgedBy: "op" } }))
      .toContain("reducedScope.missing must be a non-empty array");
    expect(validateBrowserQaPreflight({ ...fullPreflight(), reducedScope: { missing: ["console"], acknowledgedBy: "" } }))
      .toContain("reducedScope.acknowledgedBy must be a non-empty string");
  });
});

describe("plan_9 §16 verdict separation", () => {
  it("fixes the six verdict areas", () => {
    expect([...QA_AREA_NAMES]).toEqual(["repository", "api", "browser", "visual", "provider", "human"]);
    expect(Object.isFrozen(QA_AREA_NAMES)).toBe(true);
  });

  it("passes only when every area passes", () => {
    expect(summarizeBrowserQaVerdict(allPass())).toBe("pass");
  });

  it("never lets a green API smoke mask a red browser gameplay", () => {
    expect(summarizeBrowserQaVerdict({ ...allPass(), browser: "fail" })).toBe("fail");
    expect(summarizeBrowserQaVerdict({ ...allPass(), visual: "fail" })).toBe("fail");
    expect(summarizeBrowserQaVerdict({ ...allPass(), repository: "fail" })).toBe("fail");
  });

  it("blocks on blocked areas and fails when fail meets blocked", () => {
    expect(summarizeBrowserQaVerdict({ ...allPass(), visual: "blocked" })).toBe("blocked");
    expect(summarizeBrowserQaVerdict({ ...allPass(), browser: "fail", visual: "blocked" })).toBe("fail");
  });

  it("buildBrowserQaReport derives the overall verdict", () => {
    expect(buildBrowserQaReport(evidence()).overall).toBe("pass");
    expect(buildBrowserQaReport(evidence({ verdicts: { ...allPass(), provider: "blocked" } })).overall).toBe("blocked");
    expect(Object.isFrozen(buildBrowserQaReport(evidence()))).toBe(true);
  });
});

describe("validateBrowserQaReport", () => {
  it("accepts a complete mutating run", () => {
    expect(validateBrowserQaReport(buildBrowserQaReport(evidence()))).toEqual([]);
  });

  it("accepts a read-only run without world ids", () => {
    const readOnly = buildBrowserQaReport(evidence({
      browserWorldId: null,
      apiWorldId: null,
      inputs: [],
      mutationCount: 0,
      clickBudget: 0,
    }));
    expect(validateBrowserQaReport(readOnly)).toEqual([]);
  });

  it("rejects identity and ledger defects", () => {
    expect(validateBrowserQaReport({})).toContain("jobId must be a non-empty string");
    expect(validateBrowserQaReport(buildBrowserQaReport(evidence({ deployedCommit: "" })))).toContain("deployedCommit must be a non-empty string");
    expect(validateBrowserQaReport(buildBrowserQaReport(evidence({ browserWorldId: "  " })))).toContain("browserWorldId must be a non-empty string or null");
    const badIndex = evidence({ inputs: [{ index: 3, input: "x" }] });
    expect(validateBrowserQaReport(buildBrowserQaReport(badIndex))).toContain("inputs[0].index must equal 0");
    const emptyInput = evidence({ inputs: [{ index: 0, input: "  " }] });
    expect(validateBrowserQaReport(buildBrowserQaReport(emptyInput))).toContain("inputs[0].input must be a non-empty string");
    const badStatus = evidence({ inputs: [{ index: 0, input: "x", httpStatus: 99 }] });
    expect(validateBrowserQaReport(buildBrowserQaReport(badStatus))).toContain("inputs[0].httpStatus must be an HTTP status code");
    const timeTravel = evidence({ inputs: [{ index: 0, input: "x", worldTimeBefore: 5, worldTimeAfter: 4 }] });
    expect(validateBrowserQaReport(buildBrowserQaReport(timeTravel))).toContain("inputs[0].worldTimeAfter must not precede worldTimeBefore");
  });

  it("rejects evidence-array defects", () => {
    const badDom = evidence({ domAssertions: [{ id: "", passed: true }] });
    expect(validateBrowserQaReport(buildBrowserQaReport(badDom)).some((message) => message.includes("domAssertions[0]"))).toBe(true);
    const badConsole = evidence({ consoleMessages: [{ type: "fatal", text: "x" }] as unknown as BrowserQaEvidence["consoleMessages"] });
    expect(validateBrowserQaReport(buildBrowserQaReport(badConsole))).toContain("consoleMessages[0] must carry a known type and text");
    const badShots = evidence({ screenshots: ["ok.png", " "] });
    expect(validateBrowserQaReport(buildBrowserQaReport(badShots))).toContain("screenshots must be an array of non-empty paths");
  });

  it("enforces the authorized click budget", () => {
    const over = evidence({ mutationCount: 6, clickBudget: 5 });
    expect(validateBrowserQaReport(buildBrowserQaReport(over))).toContain("mutationCount must not exceed the authorized clickBudget");
  });

  it("requires world ids from a mutating run", () => {
    const nameless = evidence({ browserWorldId: null, apiWorldId: null, mutationCount: 2, clickBudget: 5 });
    const errors = validateBrowserQaReport(buildBrowserQaReport(nameless));
    expect(errors).toContain("a mutating run must name browserWorldId");
    expect(errors).toContain("a mutating run must name apiWorldId");
  });

  it("rejects a hand-written overall and hidden blocked capabilities", () => {
    const forged = { ...buildBrowserQaReport(evidence({ verdicts: { ...allPass(), browser: "fail" } })), overall: "pass" as const };
    expect(validateBrowserQaReport(forged)).toContain("overall must derive from the area verdicts (expected fail)");
    const hidden = evidence({ blockedCapabilities: ["console"], verdicts: allPass() });
    expect(validateBrowserQaReport(buildBrowserQaReport(hidden))).toContain("blocked capabilities require at least one blocked area verdict");
    const badVerdict = evidence({ verdicts: { ...allPass(), api: "maybe" } as unknown as BrowserQaEvidence["verdicts"] });
    expect(validateBrowserQaReport(buildBrowserQaReport(badVerdict)))
      .toContain("verdicts.api must be pass, fail or blocked");
  });
});
