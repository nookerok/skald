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
  "dom",
  "console",
  "report_dir",
] as const);

export type PreflightCapability = (typeof PREFLIGHT_CAPABILITIES)[number];

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
 * Evaluates the preflight gate (plan_9 §15). `stop` until every required
 * capability passes; `proceed_reduced` only when each blocked capability
 * is covered by an explicit acknowledgment. Pure and total.
 */
export function evaluatePreflightGate(preflight: BrowserQaPreflight): PreflightGateDecision {
  const byCapability = new Map<PreflightCapability, "pass" | "blocked">();
  for (const probe of preflight.probes) {
    if (!byCapability.has(probe.capability)) byCapability.set(probe.capability, probe.status);
  }
  const blocked = PREFLIGHT_CAPABILITIES.filter((capability) => byCapability.get(capability) !== "pass");
  if (blocked.length === 0) return "proceed";
  const acknowledged = new Set(preflight.reducedScope?.missing ?? []);
  const covered = blocked.every((capability) => acknowledged.has(capability));
  return covered && (preflight.reducedScope?.acknowledgedBy.trim() ?? "").length > 0 ? "proceed_reduced" : "stop";
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
  readonly inputs: readonly BrowserQaInputLedgerEntry[];
  readonly domAssertions: readonly BrowserQaDomAssertion[];
  readonly consoleMessages: readonly BrowserQaConsoleMessage[];
  readonly screenshots: readonly string[];
  /** Capabilities the preflight reported blocked (stable capability names). */
  readonly blockedCapabilities: readonly string[];
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
  if (!Array.isArray(record.blockedCapabilities) || (record.blockedCapabilities as unknown[]).some((capability) => typeof capability !== "string")) {
    errors.push("blockedCapabilities must be an array of strings");
  }

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
  }
  if (record.overall !== "pass" && record.overall !== "fail" && record.overall !== "blocked") {
    errors.push("overall must be pass, fail or blocked");
  }

  // A run that mutated the world must name the world on both sides.
  if (Number.isInteger(record.mutationCount) && (record.mutationCount as number) > 0) {
    if (record.browserWorldId === null) errors.push("a mutating run must name browserWorldId");
    if (record.apiWorldId === null) errors.push("a mutating run must name apiWorldId");
  }
  // A blocked capability can never hide behind a passing area verdict.
  const blockedAreas = Array.isArray(record.blockedCapabilities) && (record.blockedCapabilities as unknown[]).length > 0;
  if (blockedAreas && isRecord(record.verdicts)) {
    const values = QA_AREA_NAMES.map((area) => (record.verdicts as Record<string, unknown>)[area]);
    if (!values.some((verdict) => verdict === "blocked")) {
      errors.push("blocked capabilities require at least one blocked area verdict");
    }
  }
  return errors;
}
