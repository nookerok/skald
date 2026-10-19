import { describe, expect, it } from "vitest";
import {
  PREFLIGHT_CAPABILITIES,
  QA_AREA_NAMES,
  buildBrowserQaReport,
  evaluatePreflightGate,
  preflightBlockedCapabilities,
  preflightCoveredCapabilities,
  REQUIRED_RENDERED_AUDIT_CHECKS,
  summarizeBrowserQaVerdict,
  validateBrowserQaPreflight,
  validateBrowserQaReport,
} from "../src/acceptance/browser-qa-contract.js";
import type {
  BrowserQaAreaVerdicts,
  BrowserQaEvidence,
  BrowserQaPreflight,
  PreflightCapability,
  BrowserQaRenderedAudit,
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

function preflightWith(capability: PreflightCapability, status: "pass" | "blocked"): BrowserQaPreflight {
  const base = fullPreflight();
  return { ...base, probes: base.probes.map((entry) => entry.capability === capability ? probe(capability, status) : entry) };
}

function renderedAudit(): BrowserQaRenderedAudit {
  const style = {
    display: "block", visibility: "visible", opacity: 1, position: "static",
    overflowX: "visible", overflowY: "visible", pointerEvents: "auto",
    fontSize: "16px", lineHeight: "24px", color: "rgb(20, 20, 20)", backgroundColor: "rgb(255, 255, 255)",
  };
  const viewport = (label: string, width: number, height: number, isMobile: boolean) => ({
    label, width, height, deviceScaleFactor: 1, isMobile,
    document: { clientWidth: width, scrollWidth: width, clientHeight: height, scrollHeight: height },
    elements: [
      { semanticKey: "shell-header", role: "banner", accessibleName: "Skald", visible: true, interactive: false, textContent: true,
        rect: { x: 0, y: 0, width, height: 56 }, computedStyle: style,
        contentMetrics: { clientWidth: width, scrollWidth: width, clientHeight: 56, scrollHeight: 56 }, hitTargetMatches: null },
      { semanticKey: "command-input", role: "textbox", accessibleName: "Команда", visible: true, interactive: true, textContent: false,
        rect: { x: 16, y: height - 60, width: width - 32, height: 44 }, computedStyle: style,
        contentMetrics: { clientWidth: width - 32, scrollWidth: width - 32, clientHeight: 44, scrollHeight: 44 }, hitTargetMatches: true },
    ],
    overlapPairs: [],
    checks: [...REQUIRED_RENDERED_AUDIT_CHECKS, ...(isMobile ? ["mobile-touch-targets"] : [])].map((id) => ({ id, passed: true })),
  });
  return { collector: "dom-geometry-computed-style-v1", complete: true, viewports: [viewport("desktop", 1280, 800, false), viewport("mobile-390x844", 390, 844, true)] };
}

function renderedStructureEvidence() {
  return { method: "rendered_structure" as const, pixelCapture: "not_captured" as const, pixelReview: "not_run" as const,
    notAssessed: ["pixel_appearance", "subjective_aesthetics"] as const, renderedAudit: renderedAudit() };
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
    preflight: fullPreflight(),
    preflightGate: "proceed",
    inputs: [{ index: 0, input: "осмотреться", httpStatus: 200, responseKind: "action_outcome", worldTimeBefore: 0, worldTimeAfter: 1 }],
    domAssertions: [{ id: "composer-visible", selector: "#command-input", passed: true }],
    consoleMessages: [],
    screenshots: ["world.png"],
    visualEvidence: { method: "screenshot", pixelCapture: "captured", pixelReview: "pass", notAssessed: [] },
    blockedCapabilities: [],
    coveredCapabilities: [],
    uncoveredCapabilities: [],
    mutationCount: 1,
    clickBudget: 5,
    verdicts: allPass(),
    ...over,
  };
}

describe("plan_9 §15 preflight gate", () => {
  it("fixes the seven recorded capabilities", () => {
    expect([...PREFLIGHT_CAPABILITIES]).toEqual(["browser", "viewport", "screenshot", "rendered_audit", "dom", "console", "report_dir"]);
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


  it("allows the rendered audit to cover an unavailable screenshot", () => {
    const preflight = preflightWith("screenshot", "blocked");
    expect(evaluatePreflightGate(preflight)).toBe("proceed");
    expect([...preflightBlockedCapabilities(preflight)]).toEqual(["screenshot"]);
    expect([...preflightCoveredCapabilities(preflight, "rendered_structure")]).toEqual(["screenshot"]);
    expect([...preflightCoveredCapabilities(preflight, "not_run")]).toEqual([]);
  });

  it("allows screenshot capability to cover an unavailable rendered audit", () => {
    const preflight = preflightWith("rendered_audit", "blocked");
    expect(evaluatePreflightGate(preflight)).toBe("proceed");
    expect([...preflightCoveredCapabilities(preflight, "screenshot")]).toEqual(["rendered_audit"]);
  });

  it("stops if both visual instruments are unavailable", () => {
    const preflight = fullPreflight();
    const probes = preflight.probes.map((entry) => entry.capability === "screenshot" || entry.capability === "rendered_audit" ? probe(entry.capability, "blocked") : entry);
    expect(evaluatePreflightGate({ ...preflight, probes })).toBe("stop");
    expect(evaluatePreflightGate({ ...preflight, probes, reducedScope: { missing: ["screenshot", "rendered_audit"], acknowledgedBy: "operator" } })).toBe("proceed_reduced");
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


  it("accepts structural visual PASS without screenshot and records what covered it", () => {
    const preflight = preflightWith("screenshot", "blocked");
    const report = buildBrowserQaReport(evidence({
      preflight, preflightGate: "proceed", screenshots: [], visualEvidence: renderedStructureEvidence(),
      blockedCapabilities: ["screenshot"], coveredCapabilities: ["screenshot"], uncoveredCapabilities: [],
      // A structural audit is machine evidence: the human area stays unassessed.
      verdicts: { ...allPass(), human: "blocked" },
    }));
    expect(validateBrowserQaReport(report)).toEqual([]);
  });

  it("requires complete, non-contradictory structural measurements for visual PASS", () => {
    const audit = renderedAudit();
    const missingCheck = { ...audit, viewports: audit.viewports.map((viewport) => ({ ...viewport, checks: viewport.checks.filter((check) => check.id !== "no-unintended-overlap") })) };
    const missingCheckReport = buildBrowserQaReport(evidence({ screenshots: [], visualEvidence: { ...renderedStructureEvidence(), renderedAudit: missingCheck } }));
    expect(validateBrowserQaReport(missingCheckReport).some((message) => message.includes("must pass no-unintended-overlap"))).toBe(true);
    const smallTarget = { ...audit, viewports: audit.viewports.map((viewport) => viewport.isMobile ? { ...viewport, elements: viewport.elements.map((element) => element.semanticKey === "command-input" ? { ...element, rect: { ...element.rect, height: 42 } } : element) } : viewport) };
    const smallTargetReport = buildBrowserQaReport(evidence({ screenshots: [], visualEvidence: { ...renderedStructureEvidence(), renderedAudit: smallTarget } }));
    expect(validateBrowserQaReport(smallTargetReport).some((message) => message.includes("touch-target check contradicts"))).toBe(true);
    const noDisclaimer = buildBrowserQaReport(evidence({ screenshots: [], visualEvidence: { ...renderedStructureEvidence(), notAssessed: [] } }));
    expect(validateBrowserQaReport(noDisclaimer)).toContain("screenshotless PASS must disclose pixel appearance and subjective aesthetics as not assessed");
  });

  it("requires blocked visual evidence when no visual audit was run", () => {
    const report = buildBrowserQaReport(evidence({ screenshots: [], visualEvidence: { method: "not_run", pixelCapture: "not_captured", pixelReview: "not_run", notAssessed: [] } }));
    expect(validateBrowserQaReport(report)).toContain("not_run visual evidence requires a blocked visual verdict");
  });

  it("rejects a visual PASS without a screenshot and without a complete render audit", () => {
    // No visual instrument ran at all, yet the area claims a pass.
    const noInstrument = buildBrowserQaReport(evidence({
      screenshots: [],
      visualEvidence: { method: "not_run", pixelCapture: "not_captured", pixelReview: "not_run", notAssessed: [] },
    }));
    expect(validateBrowserQaReport(noInstrument)).toContain("not_run visual evidence requires a blocked visual verdict");

    // A render audit exists but is incomplete: it cannot carry a visual PASS.
    const incomplete = renderedAudit();
    const incompleteReport = buildBrowserQaReport(evidence({
      screenshots: [],
      visualEvidence: { ...renderedStructureEvidence(), renderedAudit: { ...incomplete, complete: false } },
    }));
    expect(validateBrowserQaReport(incompleteReport).some((message) => message.includes("visual PASS requires a complete rendered audit"))).toBe(true);
  });

  it("does not let a structural audit stand in for a human judgement", () => {
    const preflight = preflightWith("screenshot", "blocked");
    const report = buildBrowserQaReport(evidence({
      preflight,
      preflightGate: "proceed",
      screenshots: [],
      visualEvidence: renderedStructureEvidence(),
      blockedCapabilities: ["screenshot"],
      coveredCapabilities: ["screenshot"],
      uncoveredCapabilities: [],
      verdicts: { ...allPass(), human: "pass" },
    }));
    expect(validateBrowserQaReport(report)).toContain("a rendered-structure audit must not be reported as a human pass");

    // The same evidence with the human area honestly left unassessed is valid.
    const honest = buildBrowserQaReport(evidence({
      preflight,
      preflightGate: "proceed",
      screenshots: [],
      visualEvidence: renderedStructureEvidence(),
      blockedCapabilities: ["screenshot"],
      coveredCapabilities: ["screenshot"],
      uncoveredCapabilities: [],
      verdicts: { ...allPass(), human: "blocked" },
    }));
    expect(validateBrowserQaReport(honest)).toEqual([]);
  });

  it("refuses to mark a blocked screenshot as captured evidence", () => {
    const preflight = preflightWith("screenshot", "blocked");
    const claimed = buildBrowserQaReport(evidence({
      preflight,
      preflightGate: "proceed",
      screenshots: ["claimed.png"],
      visualEvidence: { method: "screenshot", pixelCapture: "captured", pixelReview: "pass", notAssessed: [] },
      blockedCapabilities: ["screenshot"],
      coveredCapabilities: [],
      uncoveredCapabilities: ["screenshot"],
    }));
    const errors = validateBrowserQaReport(claimed);
    expect(errors.some((message) => message.includes("the report must not claim screenshot evidence"))).toBe(true);
    expect(errors.some((message) => message.includes("pixels must not be reported as captured"))).toBe(true);
  });

  it("treats vertical overflow as scrollable, but catches a horizontally off-screen element", () => {
    const audit = renderedAudit();
    // A conversation feed that extends below the fold is normal: the
    // in-viewport check must not contradict the measurements.
    const scrolled = {
      ...audit,
      viewports: audit.viewports.map((viewport) => ({
        ...viewport,
        elements: viewport.elements.map((element) => (element.semanticKey === "shell-header"
          ? { ...element, rect: { ...element.rect, height: element.rect.height + 4000 } }
          : element)),
      })),
    };
    const scrolledReport = buildBrowserQaReport(evidence({ screenshots: [], visualEvidence: { ...renderedStructureEvidence(), renderedAudit: scrolled }, verdicts: { ...allPass(), human: "blocked" } }));
    expect(validateBrowserQaReport(scrolledReport)).toEqual([]);

    // An element pushed sideways out of the viewport IS a defect.
    const offScreen = {
      ...audit,
      viewports: audit.viewports.map((viewport) => ({
        ...viewport,
        elements: viewport.elements.map((element) => (element.semanticKey === "command-input"
          ? { ...element, rect: { ...element.rect, x: element.rect.x + viewport.width + 40 } }
          : element)),
      })),
    };
    const offScreenReport = buildBrowserQaReport(evidence({ screenshots: [], visualEvidence: { ...renderedStructureEvidence(), renderedAudit: offScreen }, verdicts: { ...allPass(), human: "blocked" } }));
    expect(validateBrowserQaReport(offScreenReport).some((message) => message.includes("viewport check contradicts bounding boxes"))).toBe(true);
  });

  it("fails the visual area on a measured overflow, a hidden element or an overlap", () => {
    const audit = renderedAudit();
    // A failed check is recorded as failed: the measurement and the verdict
    // must not contradict each other.
    const withFailedCheck = (id: string, patch: (viewport: typeof audit.viewports[number]) => typeof audit.viewports[number]) => ({
      ...audit,
      viewports: audit.viewports.map((viewport) => ({
        ...patch(viewport),
        checks: viewport.checks.map((check) => (check.id === id ? { ...check, passed: false } : check)),
      })),
    });
    const overflowAudit = withFailedCheck("horizontal-overflow", (viewport) => ({
      ...viewport,
      document: { ...viewport.document, scrollWidth: viewport.document.clientWidth + 120 },
    }));
    const overlapAudit = withFailedCheck("no-unintended-overlap", (viewport) => ({
      ...viewport,
      overlapPairs: [{ firstSemanticKey: "shell-header", secondSemanticKey: "command-input", overlapArea: 900, allowed: false }],
    }));
    const hiddenAudit = withFailedCheck("key-elements-visible", (viewport) => ({
      ...viewport,
      elements: viewport.elements.map((element) => (element.semanticKey === "command-input"
        ? { ...element, visible: false, computedStyle: { ...element.computedStyle, display: "none" } }
        : element)),
    }));

    for (const broken of [overflowAudit, overlapAudit, hiddenAudit]) {
      const failed = buildBrowserQaReport(evidence({
        screenshots: [],
        visualEvidence: { ...renderedStructureEvidence(), renderedAudit: broken },
        verdicts: { ...allPass(), visual: "fail", human: "blocked" },
      }));
      // The honest FAIL report is accepted; the same measurements may not pass.
      expect(validateBrowserQaReport(failed)).toEqual([]);
      const claimedPass = buildBrowserQaReport(evidence({
        screenshots: [],
        visualEvidence: { ...renderedStructureEvidence(), renderedAudit: broken },
        verdicts: { ...allPass(), human: "blocked" },
      }));
      expect(validateBrowserQaReport(claimedPass).length).toBeGreaterThan(0);
    }
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
    const hidden = evidence({ preflight: { ...preflightWith("console", "blocked"), reducedScope: { missing: ["console"], acknowledgedBy: "operator" } }, preflightGate: "proceed_reduced", blockedCapabilities: ["console"], coveredCapabilities: [], uncoveredCapabilities: ["console"], mutationCount: 0, clickBudget: 0, verdicts: allPass() });
    expect(validateBrowserQaReport(buildBrowserQaReport(hidden))).toContain("uncovered blocked capabilities require at least one blocked area verdict");
    const badVerdict = evidence({ verdicts: { ...allPass(), api: "maybe" } as unknown as BrowserQaEvidence["verdicts"] });
    expect(validateBrowserQaReport(buildBrowserQaReport(badVerdict)))
      .toContain("verdicts.api must be pass, fail or blocked");
  });
});
