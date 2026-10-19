/**
 * Browser QA run contract (plan_9 §§15-16).
 *
 * The repository task is WSL-backed and cannot drive the in-app browser;
 * actual runs execute through the fixed NTFS browser task described in the
 * browser-QA skill. This module is the shared, testable contract between
 * the two sides: which capabilities the runner must prove BEFORE the first
 * game mutation (§15 preflight), and which evidence every run must bring
 * back with separate per-area verdicts (§16 evidence contract).
 *
 * Pure data and pure functions only: no browser, no network, no world
 * access, no mutations. A green API smoke never masks a red browser
 * gameplay verdict — the overall verdict fails on ANY failed area.
 */

/** One QA verdict per area. No fourth state: unknown is blocked, never pass. */
export type BrowserQaVerdict = "pass" | "fail" | "blocked";

/**
 * Capabilities the runner must prove before creating a scratch world or
 * clicking a state-changing control (plan_9 §15). Names are stable:
 * assignments and evidence files use exactly these strings.
 */
export const PREFLIGHT_CAPABILITIES = Object.freeze([
  "browser",
  "viewport",
  "screenshot",
  "rendered_audit",
  "dom",
  "console",
  "report_dir",
] as const);

export type PreflightCapability = (typeof PREFLIGHT_CAPABILITIES)[number];

const REQUIRED_PREFLIGHT_CAPABILITIES = Object.freeze([
  "browser",
  "viewport",
  "dom",
  "console",
  "report_dir",
] as const satisfies readonly PreflightCapability[]);
const ALTERNATIVE_VISUAL_CAPABILITIES = Object.freeze([
  "screenshot",
  "rendered_audit",
] as const satisfies readonly PreflightCapability[]);

/** One capability probe outcome. `detail` carries the exact symptom, never secrets. */
export interface PreflightProbe {
  readonly capability: PreflightCapability;
  readonly status: "pass" | "blocked";
  readonly detail?: string | undefined;
}

/**
 * Reduced scope is never implicit: the runner may proceed past a blocked
 * capability only with an explicit acknowledgment naming who accepted the
 * gap. Uncovered areas then report `blocked`, never `pass`.
 */
export interface PreflightReducedScope {
  readonly missing: readonly PreflightCapability[];
  readonly acknowledgedBy: string;
}

/** Preflight evidence for one QA job. */
export interface BrowserQaPreflight {
  readonly jobId: string;
  readonly probes: readonly PreflightProbe[];
  readonly reducedScope?: PreflightReducedScope | null | undefined;
}

/** Gate decision before the first game mutation. */
export type PreflightGateDecision = "proceed" | "proceed_reduced" | "stop";

/**
 * Evaluates the preflight gate (plan_9 §15). Browser, viewport, DOM, console
 * and report output are required; screenshot capture and rendered audit are
 * alternatives. Reduced scope requires explicit acknowledgment for each gap.
 */
export function evaluatePreflightGate(preflight: BrowserQaPreflight): PreflightGateDecision {
  const byCapability = new Map<PreflightCapability, "pass" | "blocked">();
  for (const probe of preflight.probes) {
    if (!byCapability.has(probe.capability)) byCapability.set(probe.capability, probe.status);
  }
  const uncovered = preflightUncoveredCapabilities(byCapability);
  if (uncovered.length === 0) return "proceed";
  const acknowledged = new Set(preflight.reducedScope?.missing ?? []);
  const covered = uncovered.every((capability) => acknowledged.has(capability));
  return covered && (preflight.reducedScope?.acknowledgedBy.trim() ?? "").length > 0 ? "proceed_reduced" : "stop";
}
function preflightUncoveredCapabilities(
  statuses: ReadonlyMap<PreflightCapability, "pass" | "blocked">,
): readonly PreflightCapability[] {
  const uncovered: PreflightCapability[] = REQUIRED_PREFLIGHT_CAPABILITIES.filter(
    (capability) => statuses.get(capability) !== "pass",
  );
  const hasVisualInstrumentation = ALTERNATIVE_VISUAL_CAPABILITIES.some(
    (capability) => statuses.get(capability) === "pass",
  );
  if (!hasVisualInstrumentation) {
    for (const capability of ALTERNATIVE_VISUAL_CAPABILITIES) {
      if (statuses.get(capability) !== "pass") uncovered.push(capability);
    }
  }
  return Object.freeze(uncovered);
}

/** Capabilities the preflight reported blocked (deduplicated, stable order). */
export function preflightBlockedCapabilities(preflight: BrowserQaPreflight): readonly PreflightCapability[] {
  const seen = new Set<PreflightCapability>();
  const blocked: PreflightCapability[] = [];
  for (const probe of preflight.probes) {
    if (probe.status === "blocked" && !seen.has(probe.capability)) {
      seen.add(probe.capability);
      blocked.push(probe.capability);
    }
  }
  return Object.freeze(blocked);
}
/** A failed visual capability covered by the instrument actually used in the run. */
export function preflightCoveredCapabilities(
  preflight: BrowserQaPreflight,
  visualMethod: BrowserQaVisualEvidence["method"],
): readonly PreflightCapability[] {
  const byCapability = new Map(preflight.probes.map((probe) => [probe.capability, probe.status]));
  const covered: PreflightCapability[] = [];
  if (byCapability.get("screenshot") === "blocked" && byCapability.get("rendered_audit") === "pass" && visualMethod === "rendered_structure") {
    covered.push("screenshot");
  }
  if (byCapability.get("rendered_audit") === "blocked" && byCapability.get("screenshot") === "pass" && (visualMethod === "screenshot" || visualMethod === "combined")) {
    covered.push("rendered_audit");
  }
  return Object.freeze(covered);
}

/**
 * Validates preflight evidence shape. Returns error strings, empty when
 * the preflight is well-formed (well-formed is not passing: use
 * evaluatePreflightGate for the go/no-go decision).
 */
export function validateBrowserQaPreflight(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["must be a JSON object"];
  const record = value as Record<string, unknown>;
  if (typeof record.jobId !== "string" || record.jobId.trim().length === 0) errors.push("jobId must be a non-empty string");
  if (!Array.isArray(record.probes) || record.probes.length === 0) {
    errors.push("probes must be a non-empty array");
  } else {
    const seen = new Set<string>();
    for (const probe of record.probes as unknown[]) {
      if (typeof probe !== "object" || probe === null || Array.isArray(probe)) {
        errors.push("every probe must be a JSON object");
        continue;
      }
      const entry = probe as Record<string, unknown>;
      if (!(PREFLIGHT_CAPABILITIES as readonly string[]).includes(entry.capability as string)) {
        errors.push(`unknown preflight capability: ${String(entry.capability)}`);
      } else if (seen.has(entry.capability as string)) {
        errors.push(`duplicate preflight probe: ${String(entry.capability)}`);
      } else {
        seen.add(entry.capability as string);
      }
      if (entry.status !== "pass" && entry.status !== "blocked") {
        errors.push(`probe ${String(entry.capability)} status must be pass or blocked`);
      }
      if (entry.detail !== undefined && typeof entry.detail !== "string") {
        errors.push(`probe ${String(entry.capability)} detail must be a string`);
      }
    }
    for (const capability of PREFLIGHT_CAPABILITIES) {
      if (!seen.has(capability)) errors.push(`missing preflight probe: ${capability}`);
    }
  }
  const scope = record.reducedScope;
  if (scope !== undefined && scope !== null) {
    if (typeof scope !== "object" || Array.isArray(scope)) {
      errors.push("reducedScope must be a JSON object");
    } else {
      const entry = scope as Record<string, unknown>;
      if (!Array.isArray(entry.missing) || entry.missing.length === 0) {
        errors.push("reducedScope.missing must be a non-empty array");
      } else {
        for (const capability of entry.missing as unknown[]) {
          if (!(PREFLIGHT_CAPABILITIES as readonly string[]).includes(capability as string)) {
            errors.push(`unknown reducedScope capability: ${String(capability)}`);
          }
        }
      }
      if (typeof entry.acknowledgedBy !== "string" || entry.acknowledgedBy.trim().length === 0) {
        errors.push("reducedScope.acknowledgedBy must be a non-empty string");
      }
    }
  }
  return errors;
}

/** One ledger row: the exact input plus what the world answered (plan_9 §16). */
export interface BrowserQaInputLedgerEntry {
  /** Zero-based position in the run. */
  readonly index: number;
  /** Exact player input or control id the runner used. */
  readonly input: string;
  /** HTTP status of the command request, when the input went through HTTP. */
  readonly httpStatus?: number | undefined;
  /** Master turn kind the input produced (inquiry_answer, action_outcome, ...). */
  readonly responseKind?: string | undefined;
  /** World time before the input committed. */
  readonly worldTimeBefore?: number | undefined;
  /** World time after the input committed (delta = after - before). */
  readonly worldTimeAfter?: number | undefined;
}

/** One DOM assertion with its outcome. */
export interface BrowserQaDomAssertion {
  readonly id: string;
  readonly selector?: string | undefined;
  readonly passed: boolean;
  readonly detail?: string | undefined;
}

/** One captured console message. */
export interface BrowserQaConsoleMessage {
  readonly type: "error" | "warning" | "log" | "info" | "debug";
  readonly text: string;
}
/** Required machine-checkable layout assertions for screenshotless visual acceptance. */
export const REQUIRED_RENDERED_AUDIT_CHECKS = Object.freeze([
  "horizontal-overflow",
  "key-elements-visible",
  "key-elements-in-viewport",
  "no-unintended-overlap",
  "key-text-not-clipped",
  "interactive-hit-targets",
] as const);

/**
 * Meaning of `key-elements-in-viewport`: no audited element is pushed outside
 * the HORIZONTAL viewport and no audited element is unrendered (zero size).
 * Vertical overflow is normal for a scrollable page — a long conversation feed
 * legitimately extends below the fold — so it is not a defect on its own;
 * reachability is asserted separately (a runner measures that the composer
 * becomes visible after scrolling).
 */

/** Rendered bounding box measured in CSS pixels. */
export interface BrowserQaRenderRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One semantically named UI element with DOM, geometry and computed-style evidence. */
export interface BrowserQaRenderedElement {
  readonly semanticKey: string;
  readonly role: string;
  readonly accessibleName: string;
  readonly visible: boolean;
  readonly interactive: boolean;
  readonly textContent: boolean;
  readonly rect: BrowserQaRenderRect;
  readonly computedStyle: {
    readonly display: string;
    readonly visibility: string;
    /** Numeric opacity (0..1); CSS strings are not accepted. */
    readonly opacity: number;
    readonly position: string;
    readonly overflowX: string;
    readonly overflowY: string;
    readonly pointerEvents: string;
    readonly fontSize: string;
    readonly lineHeight: string;
    readonly color: string;
    readonly backgroundColor: string;
  };
  readonly contentMetrics: {
    readonly clientWidth: number;
    readonly scrollWidth: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
  };
  readonly hitTargetMatches: boolean | null;
}

/** One explicit rendered-layout check and its measured explanation. */
export interface BrowserQaRenderCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail?: string | undefined;
}

/** Measured evidence for one desktop or mobile viewport. */
export interface BrowserQaRenderedViewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly document: {
    readonly clientWidth: number;
    readonly scrollWidth: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
  };
  readonly elements: readonly BrowserQaRenderedElement[];
  /** Measured intersections; each overlap must be marked intentional or harmful. */
  readonly overlapPairs: readonly {
    readonly firstSemanticKey: string;
    readonly secondSemanticKey: string;
    readonly overlapArea: number;
    readonly allowed: boolean;
  }[];
  readonly checks: readonly BrowserQaRenderCheck[];
}

/** Browser-collected structure/geometry snapshot; it contains no screenshot pixels. */
export interface BrowserQaRenderedAudit {
  readonly collector: "dom-geometry-computed-style-v1";
  readonly complete: boolean;
  readonly viewports: readonly BrowserQaRenderedViewport[];
}

/** Truthful declaration of what the visual verdict measured and what it did not. */
export interface BrowserQaVisualEvidence {
  readonly method: "screenshot" | "rendered_structure" | "combined" | "not_run";
  readonly pixelCapture: "captured" | "not_captured";
  readonly pixelReview: BrowserQaVerdict | "not_run";
  readonly notAssessed: readonly ("pixel_appearance" | "subjective_aesthetics")[];
  readonly renderedAudit?: BrowserQaRenderedAudit | null | undefined;
}

/**
 * Separate verdicts (plan_9 §16). A green API smoke never overrides a red
 * browser gameplay verdict: the overall verdict fails on ANY failed area.
 */
export interface BrowserQaAreaVerdicts {
  readonly repository: BrowserQaVerdict;
  readonly api: BrowserQaVerdict;
  readonly browser: BrowserQaVerdict;
  readonly visual: BrowserQaVerdict;
  readonly provider: BrowserQaVerdict;
  readonly human: BrowserQaVerdict;
}

export const QA_AREA_NAMES = Object.freeze(["repository", "api", "browser", "visual", "provider", "human"] as const);

export type QaAreaName = (typeof QA_AREA_NAMES)[number];

/** Complete evidence one browser QA run must bring back (plan_9 §16). */
export interface BrowserQaEvidence {
  readonly jobId: string;
  /** Deployed commit the run verified, full or abbreviated sha. */
  readonly deployedCommit: string;
  /** World the browser drove (null only when the run never reached a world). */
  readonly browserWorldId: string | null;
  /** World the API ledger scoped to (null only when the run never reached a world). */
  readonly apiWorldId: string | null;
  /** Raw capability probes and the gate decision recorded before the first mutation. */
  readonly preflight: BrowserQaPreflight;
  readonly preflightGate: PreflightGateDecision;
  readonly inputs: readonly BrowserQaInputLedgerEntry[];
  readonly domAssertions: readonly BrowserQaDomAssertion[];
  readonly consoleMessages: readonly BrowserQaConsoleMessage[];
  readonly screenshots: readonly string[];
  readonly visualEvidence: BrowserQaVisualEvidence;
  /** Capabilities the preflight reported blocked (stable capability names). */
  readonly blockedCapabilities: readonly PreflightCapability[];
  readonly coveredCapabilities: readonly PreflightCapability[];
  /** Capability gaps not covered by the visual evidence actually collected. */
  readonly uncoveredCapabilities: readonly PreflightCapability[];
  /** State-changing clicks/gameplay commands actually performed. */
  readonly mutationCount: number;
  /** Authorized state-changing budget for the run. */
  readonly clickBudget: number;
  readonly verdicts: BrowserQaAreaVerdicts;
}

export interface BrowserQaReport extends BrowserQaEvidence {
  readonly overall: BrowserQaVerdict;
}

/**
 * Derives the overall verdict: fail on ANY failed area, else blocked on
 * ANY blocked area, else pass. Pure and total.
 */
export function summarizeBrowserQaVerdict(verdicts: BrowserQaAreaVerdicts): BrowserQaVerdict {
  const values = QA_AREA_NAMES.map((area) => verdicts[area]);
  if (values.some((verdict) => verdict === "fail")) return "fail";
  if (values.some((verdict) => verdict === "blocked")) return "blocked";
  return "pass";
}

/**
 * Builds a report from evidence, deriving the overall verdict. The caller
 * supplies every evidence field; nothing is defaulted except the overall
 * verdict itself.
 */
export function buildBrowserQaReport(evidence: BrowserQaEvidence): BrowserQaReport {
  return Object.freeze({ ...evidence, overall: summarizeBrowserQaVerdict(evidence.verdicts) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateRenderedAudit(value: unknown, verdict: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["renderedAudit must be an object"];
  if (value.collector !== "dom-geometry-computed-style-v1") errors.push("renderedAudit.collector is unsupported");
  if (!Array.isArray(value.viewports) || value.viewports.length === 0) return [...errors, "renderedAudit.viewports must be non-empty"];
  if (verdict === "pass" && value.complete !== true) errors.push("visual PASS requires a complete rendered audit");
  if (typeof value.complete !== "boolean") errors.push("renderedAudit.complete must be boolean");
  for (let index = 0; index < value.viewports.length; index += 1) {
    const viewport = value.viewports[index];
    const prefix = "renderedAudit.viewports[" + index + "]";
    if (!isRecord(viewport)) { errors.push(prefix + " must be an object"); continue; }
    for (const key of ["width", "height", "deviceScaleFactor"] as const) {
      if (!isFiniteNonNegative(viewport[key]) || viewport[key] === 0) errors.push(prefix + "." + key + " must be positive");
    }
    if (typeof viewport.label !== "string" || !viewport.label.trim()) errors.push(prefix + ".label must be non-empty");
    if (typeof viewport.isMobile !== "boolean") errors.push(prefix + ".isMobile must be boolean");
    const doc = viewport.document;
    if (!isRecord(doc)) errors.push(prefix + ".document must be an object");
    else for (const key of ["clientWidth", "scrollWidth", "clientHeight", "scrollHeight"] as const) if (!isFiniteNonNegative(doc[key])) errors.push(prefix + ".document metrics must be non-negative");
    const elements = Array.isArray(viewport.elements) ? viewport.elements : [];
    if (!Array.isArray(viewport.elements) || (value.complete === true && elements.length === 0)) errors.push(prefix + ".elements must be non-empty for a complete audit");
    for (let itemIndex = 0; itemIndex < elements.length; itemIndex += 1) {
      const item = elements[itemIndex];
      if (!isRecord(item)) { errors.push(prefix + ".elements contains a non-object"); continue; }
      for (const key of ["semanticKey", "role", "accessibleName"] as const) if (typeof item[key] !== "string" || !item[key].trim()) errors.push(prefix + ".elements requires semantic key, role and accessible name");
      for (const key of ["visible", "interactive", "textContent"] as const) if (typeof item[key] !== "boolean") errors.push(prefix + ".elements boolean flags are invalid");
      const rect = item.rect;
      if (!isRecord(rect)) errors.push(prefix + ".elements.rect must be an object");
      else for (const key of ["x", "y", "width", "height"] as const) if (!isFiniteNonNegative(rect[key])) errors.push(prefix + ".elements.rect metrics must be non-negative");
      const style = item.computedStyle;
      if (!isRecord(style)) errors.push(prefix + ".elements.computedStyle must be an object");
      else {
        for (const key of ["display", "visibility", "position", "overflowX", "overflowY", "pointerEvents", "fontSize", "lineHeight", "color", "backgroundColor"] as const) if (typeof style[key] !== "string") errors.push(prefix + ".elements.computedStyle fields must be strings");
        if (!isFiniteNonNegative(style.opacity) || style.opacity > 1) errors.push(prefix + ".elements.opacity must be between zero and one");
      }
      const content = item.contentMetrics;
      if (!isRecord(content)) errors.push(prefix + ".elements.contentMetrics must be an object");
      else for (const key of ["clientWidth", "scrollWidth", "clientHeight", "scrollHeight"] as const) if (!isFiniteNonNegative(content[key])) errors.push(prefix + ".elements content metrics must be non-negative");
      if (item.hitTargetMatches !== null && typeof item.hitTargetMatches !== "boolean") errors.push(prefix + ".elements.hitTargetMatches must be boolean or null");
    }
    if (!Array.isArray(viewport.checks)) { errors.push(prefix + ".checks must be an array"); continue; }
    if (!Array.isArray(viewport.overlapPairs)) errors.push(prefix + ".overlapPairs must be an array");
    else for (const overlap of viewport.overlapPairs) {
      if (!isRecord(overlap) || typeof overlap.firstSemanticKey !== "string" || typeof overlap.secondSemanticKey !== "string"
        || !isFiniteNonNegative(overlap.overlapArea) || typeof overlap.allowed !== "boolean") {
        errors.push(prefix + ".overlapPairs entries must identify measured geometry and intent");
      }
    }
    const checks = new Map<string, boolean>();
    for (const check of viewport.checks) {
      if (!isRecord(check) || typeof check.id !== "string" || typeof check.passed !== "boolean") { errors.push(prefix + ".checks entries must have id and passed"); continue; }
      if (checks.has(check.id)) errors.push(prefix + ".checks ids must be unique");
      checks.set(check.id, check.passed);
    }
    const requirePass = (id: string): void => { if (checks.get(id) !== true) errors.push(prefix + " must pass " + id); };
    if (value.complete === true && verdict === "pass") {
      for (const id of REQUIRED_RENDERED_AUDIT_CHECKS) requirePass(id);
      if (viewport.isMobile === true) requirePass("mobile-touch-targets");
    }
    if (checks.get("horizontal-overflow") === true && isRecord(doc) && Number(doc.scrollWidth) > Number(doc.clientWidth)) errors.push(prefix + " horizontal-overflow contradicts document metrics");
    if (checks.get("key-elements-visible") === true && elements.some((item) => isRecord(item) && (item.visible !== true || !isRecord(item.computedStyle) || item.computedStyle.display === "none" || item.computedStyle.visibility === "hidden" || item.computedStyle.opacity === 0))) errors.push(prefix + " visibility check contradicts element metrics");
    if (checks.get("key-elements-in-viewport") === true && elements.some((item) => isRecord(item) && (!isRecord(item.rect) || Number(item.rect.width) <= 0 || Number(item.rect.height) <= 0 || Number(item.rect.x) < 0 || Number(item.rect.x) + Number(item.rect.width) > Number(viewport.width)))) errors.push(prefix + " viewport check contradicts bounding boxes");
    if (checks.get("key-text-not-clipped") === true && elements.some((item) => isRecord(item) && item.textContent === true && (!isRecord(item.contentMetrics) || Number(item.contentMetrics.scrollWidth) > Number(item.contentMetrics.clientWidth) || Number(item.contentMetrics.scrollHeight) > Number(item.contentMetrics.clientHeight)))) errors.push(prefix + " clipping check contradicts content metrics");
    if (checks.get("interactive-hit-targets") === true && elements.some((item) => isRecord(item) && item.interactive === true && item.hitTargetMatches !== true)) errors.push(prefix + " hit-target check contradicts element metrics");
    if (checks.get("mobile-touch-targets") === true && elements.some((item) => isRecord(item) && item.interactive === true && (!isRecord(item.rect) || Number(item.rect.width) < 44 || Number(item.rect.height) < 44))) errors.push(prefix + " touch-target check contradicts element metrics");
    if (checks.get("no-unintended-overlap") === true && Array.isArray(viewport.overlapPairs)
      && viewport.overlapPairs.some((overlap) => isRecord(overlap) && Number(overlap.overlapArea) > 0 && overlap.allowed !== true)) {
      errors.push(prefix + " overlap check contradicts measured geometry");
    }
  }
  return errors;
}
function validateVisualEvidence(value: unknown, verdict: unknown, screenshots: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["visualEvidence must be an object"];
  const methods = ["screenshot", "rendered_structure", "combined", "not_run"];
  if (!methods.includes(value.method as string)) errors.push("visualEvidence.method is unsupported");
  if (value.pixelCapture !== "captured" && value.pixelCapture !== "not_captured") errors.push("visualEvidence.pixelCapture is invalid");
  if (!["pass", "fail", "blocked", "not_run"].includes(value.pixelReview as string)) errors.push("visualEvidence.pixelReview is invalid");
  if (!Array.isArray(value.notAssessed) || value.notAssessed.some((item) => item !== "pixel_appearance" && item !== "subjective_aesthetics")) errors.push("visualEvidence.notAssessed must list known unassessed dimensions");
  const screenshotCount = Array.isArray(screenshots) ? screenshots.length : 0;
  const hasAudit = value.renderedAudit !== undefined && value.renderedAudit !== null;
  if (value.method === "screenshot") {
    if (value.pixelCapture !== "captured" || screenshotCount === 0) errors.push("screenshot mode requires captured screenshot evidence");
    if (hasAudit) errors.push("screenshot mode must not carry renderedAudit; use combined");
  } else if (value.method === "rendered_structure") {
    if (value.pixelCapture !== "not_captured" || value.pixelReview !== "not_run" || screenshotCount !== 0) errors.push("rendered_structure mode must state that pixels were not captured or reviewed");
    if (!hasAudit) errors.push("rendered_structure mode requires renderedAudit");
    if (verdict === "pass" && (!Array.isArray(value.notAssessed) || !value.notAssessed.includes("pixel_appearance") || !value.notAssessed.includes("subjective_aesthetics"))) errors.push("screenshotless PASS must disclose pixel appearance and subjective aesthetics as not assessed");
  } else if (value.method === "combined") {
    if (value.pixelCapture !== "captured" || screenshotCount === 0 || !hasAudit) errors.push("combined mode requires screenshots and renderedAudit");
  } else if (value.method === "not_run") {
    if (value.pixelCapture !== "not_captured" || value.pixelReview !== "not_run" || screenshotCount !== 0 || hasAudit) errors.push("not_run mode must not claim captured evidence");
    if (verdict !== "blocked") errors.push("not_run visual evidence requires a blocked visual verdict");
  }
  if ((value.method === "screenshot" || value.method === "combined") && verdict === "pass" && value.pixelReview !== "pass") errors.push("pixel visual PASS requires pixelReview pass");
  if (hasAudit) errors.push(...validateRenderedAudit(value.renderedAudit, verdict));
  return errors;
}

/**
 * Validates a browser QA evidence report: shape plus acceptance semantics
 * (verdict derivation, mutation budget, world-id requirements, ledger
 * integrity). Returns error strings, empty when the report is acceptable.
 * Release evidence must not replace the runner-produced report with a
 * hand-written overall pass.
 */
export function validateBrowserQaReport(value: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["must be a JSON object"];
  const record = value;
  const preflightErrors = validateBrowserQaPreflight(record.preflight);
  errors.push(...preflightErrors.map((message) => "preflight." + message));
  if (preflightErrors.length === 0) {
    const preflight = record.preflight as unknown as BrowserQaPreflight;
    const expectedGate = evaluatePreflightGate(preflight);
    const expectedBlocked = preflightBlockedCapabilities(preflight);
    const visualMethod = isRecord(record.visualEvidence)
      ? record.visualEvidence.method as BrowserQaVisualEvidence["method"]
      : "not_run";
    const expectedCovered = preflightCoveredCapabilities(preflight, visualMethod);
    const expectedUncovered = expectedBlocked.filter((capability) => !expectedCovered.includes(capability));
    if (preflight.jobId !== record.jobId) errors.push("preflight.jobId must match report jobId");
    if (record.preflightGate !== expectedGate) errors.push("preflightGate must derive from preflight probes and acknowledgment");
    if (JSON.stringify(record.blockedCapabilities) !== JSON.stringify(expectedBlocked)) errors.push("blockedCapabilities must match preflight");
    if (JSON.stringify(record.coveredCapabilities) !== JSON.stringify(expectedCovered)) errors.push("coveredCapabilities must match the visual instrument actually used");
    if (JSON.stringify(record.uncoveredCapabilities) !== JSON.stringify(expectedUncovered)) errors.push("uncoveredCapabilities must match blocked and uncovered probes");
    if (expectedGate === "stop" && record.mutationCount !== 0) errors.push("preflight stop requires zero mutations");
    if (expectedGate === "stop" && record.overall !== "blocked") errors.push("preflight stop requires an overall blocked result");
    // A capability the preflight reported blocked must never be claimed as
    // collected evidence: the report may not mark a BLOCKED screenshot as PASS.
    const screenshotProbe = preflight.probes.find((probe) => probe.capability === "screenshot");
    if (screenshotProbe?.status === "blocked" && isRecord(record.visualEvidence)) {
      const method = record.visualEvidence.method;
      if (method === "screenshot" || method === "combined") {
        errors.push("screenshot is blocked in preflight: the report must not claim screenshot evidence");
      }
      if (record.visualEvidence.pixelCapture === "captured") {
        errors.push("screenshot is blocked in preflight: pixels must not be reported as captured");
      }
    }
  }

  if (typeof record.jobId !== "string" || record.jobId.trim().length === 0) {
    errors.push("jobId must be a non-empty string");
  }
  if (typeof record.deployedCommit !== "string" || record.deployedCommit.trim().length === 0) {
    errors.push("deployedCommit must be a non-empty string");
  }
  for (const field of ["browserWorldId", "apiWorldId"] as const) {
    const entry = record[field];
    if (entry !== null && (typeof entry !== "string" || entry.trim().length === 0)) {
      errors.push(`${field} must be a non-empty string or null`);
    }
  }

  if (!Array.isArray(record.inputs)) {
    errors.push("inputs must be an array");
  } else {
    const entries = record.inputs as unknown[];
    for (let position = 0; position < entries.length; position += 1) {
      const entry = entries[position];
      if (!isRecord(entry)) {
        errors.push(`inputs[${position}] must be a JSON object`);
        continue;
      }
      if (entry.index !== position) errors.push(`inputs[${position}].index must equal ${position}`);
      if (typeof entry.input !== "string" || entry.input.trim().length === 0) {
        errors.push(`inputs[${position}].input must be a non-empty string`);
      }
      if (entry.httpStatus !== undefined && (!Number.isInteger(entry.httpStatus) || (entry.httpStatus as number) < 100 || (entry.httpStatus as number) > 599)) {
        errors.push(`inputs[${position}].httpStatus must be an HTTP status code`);
      }
      if (entry.responseKind !== undefined && typeof entry.responseKind !== "string") {
        errors.push(`inputs[${position}].responseKind must be a string`);
      }
      for (const timeField of ["worldTimeBefore", "worldTimeAfter"] as const) {
        const time = entry[timeField];
        if (time !== undefined && (!Number.isInteger(time) || (time as number) < 0)) {
          errors.push(`inputs[${position}].${timeField} must be a non-negative integer`);
        }
      }
      if (typeof entry.worldTimeBefore === "number" && typeof entry.worldTimeAfter === "number"
        && (entry.worldTimeAfter as number) < (entry.worldTimeBefore as number)) {
        errors.push(`inputs[${position}].worldTimeAfter must not precede worldTimeBefore`);
      }
    }
  }

  if (!Array.isArray(record.domAssertions)) {
    errors.push("domAssertions must be an array");
  } else {
    for (let position = 0; position < (record.domAssertions as unknown[]).length; position += 1) {
      const entry = (record.domAssertions as unknown[])[position];
      if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim().length === 0) {
        errors.push(`domAssertions[${position}] must carry a non-empty id`);
      } else if (typeof entry.passed !== "boolean") {
        errors.push(`domAssertions[${position}].passed must be a boolean`);
      }
      if (isRecord(entry) && entry.selector !== undefined && typeof entry.selector !== "string") {
        errors.push(`domAssertions[${position}].selector must be a string`);
      }
    }
  }

  if (!Array.isArray(record.consoleMessages)) {
    errors.push("consoleMessages must be an array");
  } else {
    const types = ["error", "warning", "log", "info", "debug"];
    for (let position = 0; position < (record.consoleMessages as unknown[]).length; position += 1) {
      const entry = (record.consoleMessages as unknown[])[position];
      if (!isRecord(entry) || !types.includes(entry.type as string) || typeof entry.text !== "string") {
        errors.push(`consoleMessages[${position}] must carry a known type and text`);
      }
    }
  }

  if (!Array.isArray(record.screenshots) || (record.screenshots as unknown[]).some((path) => typeof path !== "string" || (path as string).trim().length === 0)) {
    errors.push("screenshots must be an array of non-empty paths");
  }
  const visualVerdict = isRecord(record.verdicts) ? record.verdicts.visual : undefined;
  errors.push(...validateVisualEvidence(record.visualEvidence, visualVerdict, record.screenshots));
  if (!Array.isArray(record.blockedCapabilities) || (record.blockedCapabilities as unknown[]).some((capability) => typeof capability !== "string")) {
    errors.push("blockedCapabilities must be an array of strings");
  }
  if (!Array.isArray(record.coveredCapabilities) || (record.coveredCapabilities as unknown[]).some((capability) => typeof capability !== "string")) {
    errors.push("coveredCapabilities must be an array of strings");
  }
  const blockedCapabilityNames = Array.isArray(record.blockedCapabilities) ? record.blockedCapabilities.filter((capability): capability is string => typeof capability === "string") : [];
  const coveredCapabilityNames = Array.isArray(record.coveredCapabilities) ? record.coveredCapabilities.filter((capability): capability is string => typeof capability === "string") : [];
  for (const capability of blockedCapabilityNames) {
    if (!(PREFLIGHT_CAPABILITIES as readonly string[]).includes(capability)) errors.push("unknown blocked capability: " + capability);
  }
  for (const capability of coveredCapabilityNames) {
    if (!blockedCapabilityNames.includes(capability)) errors.push("covered capability must also be listed as blocked: " + capability);
    if (capability !== "screenshot" && capability !== "rendered_audit") errors.push("only alternate visual capabilities may be covered");
  }
  if (coveredCapabilityNames.includes("screenshot") && (!isRecord(record.visualEvidence) || record.visualEvidence.method !== "rendered_structure")) errors.push("screenshot may be covered only by rendered_structure evidence");
  if (coveredCapabilityNames.includes("rendered_audit") && (!isRecord(record.visualEvidence) || record.visualEvidence.method !== "screenshot")) errors.push("rendered_audit may be covered only by screenshot evidence");

  for (const field of ["mutationCount", "clickBudget"] as const) {
    const count = record[field];
    if (!Number.isInteger(count) || (count as number) < 0) errors.push(`${field} must be a non-negative integer`);
  }
  if (Number.isInteger(record.mutationCount) && Number.isInteger(record.clickBudget)
    && (record.mutationCount as number) > (record.clickBudget as number)) {
    errors.push("mutationCount must not exceed the authorized clickBudget");
  }

  if (!isRecord(record.verdicts)) {
    errors.push("verdicts must be a JSON object");
  } else {
    for (const area of QA_AREA_NAMES) {
      const verdict = (record.verdicts as Record<string, unknown>)[area];
      if (verdict !== "pass" && verdict !== "fail" && verdict !== "blocked") {
        errors.push(`verdicts.${area} must be pass, fail or blocked`);
      }
    }
    if (errors.filter((message) => message.startsWith("verdicts.")).length === 0) {
      const expected = summarizeBrowserQaVerdict(record.verdicts as unknown as BrowserQaAreaVerdicts);
      if (record.overall !== expected) errors.push(`overall must derive from the area verdicts (expected ${expected})`);
    }
    // A structural audit is machine evidence, not a human judgement: it must
    // never be reported as a human PASS.
    if (isRecord(record.visualEvidence) && record.visualEvidence.method === "rendered_structure"
      && isRecord(record.verdicts) && record.verdicts.human === "pass") {
      errors.push("a rendered-structure audit must not be reported as a human pass");
    }
  }
  if (record.overall !== "pass" && record.overall !== "fail" && record.overall !== "blocked") {
    errors.push("overall must be pass, fail or blocked");
  }

  // A run that mutated the world must name the world on both sides.
  if (Number.isInteger(record.mutationCount) && (record.mutationCount as number) > 0) {
    if (record.browserWorldId === null) errors.push("a mutating run must name browserWorldId");
    if (record.apiWorldId === null) errors.push("a mutating run must name apiWorldId");
  }
  const unresolvedCapabilities = blockedCapabilityNames.filter((capability) => !coveredCapabilityNames.includes(capability));
  if (unresolvedCapabilities.length > 0 && isRecord(record.verdicts)) {
    const values = QA_AREA_NAMES.map((area) => (record.verdicts as Record<string, unknown>)[area]);
    if (!values.some((verdict) => verdict === "blocked")) {
      errors.push("uncovered blocked capabilities require at least one blocked area verdict");
    }
  }
  return errors;
}
