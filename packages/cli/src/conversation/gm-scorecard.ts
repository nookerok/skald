/**
 * Conversation Director shadow scorecard (SKALD S0).
 *
 * A pure, reproducible scorer over ONE fixed corpus. Every dimension uses the
 * FULL corpus size as the denominator (a fallback counts as a miss for addressee,
 * kind and handles), so the percentages are end-to-end and comparable across
 * versions. Clarification candidate handles are checked against the scene
 * allowlist exactly like an npc addressee; an npc expectation that names a
 * specific NPC must hit THAT handle, and the serialized context is checked for
 * forbidden substrings (privacy). Never executes and never scores prose quality.
 */

import type { GmDirectorTrace } from "../runtime/conversation-director.js";
import type { GmTurnDecision } from "@skald/intent-parser";

export interface GmScoreExpectation {
  readonly addresseeKind: "gm" | "npc" | "meta" | "clarification";
  readonly kind: string;
  /** Allowed actor handles for this replica (server-assigned). */
  readonly allowedHandles?: readonly string[];
  /**
   * The ONE handle the npc addressee must target. Present when the expectation
   * names a specific NPC: being in the allowlist is not enough — pointing at a
   * different visible actor of the same class is a miss.
   */
  readonly expectedHandle?: string | undefined;
  /**
   * The subject handle a question-shaped expectation requires
   * (`GmTurnDecision.subjectHandle`) — the topic, which may differ from the
   * addressee. When set, a decision without the right subject fails.
   */
  readonly expectedSubjectHandle?: string | undefined;
}

export interface GmScoreEntry {
  readonly input: string;
  readonly expected: GmScoreExpectation;
  readonly trace: GmDirectorTrace;
  readonly decision?: GmTurnDecision | undefined;
  /** Serialized context sent to the model, when privacy is scored. */
  readonly contextJson?: string | undefined;
  /** Substrings that must not appear in `contextJson` (internal IDs, etc.). */
  readonly forbidden?: readonly string[] | undefined;
}

export interface GmDimensionResult {
  readonly dimension: string;
  readonly total: number;
  readonly passed: number;
  readonly failures: readonly string[];
}

/**
 * Sanitized per-case facts for one corpus entry: what was expected, what the
 * model actually answered, and which provider served it. Handles are the
 * opaque scene handles (never internal ids); nothing here is a prompt, a key
 * or a world snapshot.
 */
export interface GmCaseFact {
  readonly scenario: string;
  readonly expected: {
    readonly addresseeKind: string;
    readonly kind: string;
    /** The ONE handle an npc expectation must target, when specified. */
    readonly expectedHandle?: string | undefined;
    /** The subject handle a question-shaped expectation requires. */
    readonly expectedSubjectHandle?: string | undefined;
    /** Scene allowlist the decision was validated against. */
    readonly allowedHandles?: readonly string[] | undefined;
  };
  readonly actual: {
    readonly addresseeKind?: string | undefined;
    readonly kind?: string | undefined;
    readonly handle?: string | undefined;
    readonly subjectHandle?: string | undefined;
    readonly candidateHandles?: readonly string[] | undefined;
  };
  readonly passes: {
    readonly schema: boolean;
    readonly addressee: boolean;
    readonly kind: boolean;
    readonly handles: boolean;
    readonly subject: boolean;
    readonly privacy: boolean;
  };
  readonly fallbackReason?: string | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly usedFallback?: boolean | undefined;
}

export interface GmScorecard {
  readonly contractVersion: number;
  readonly corpusSize: number;
  readonly schemaValid: number;
  readonly rawSchemaValid: number;
  readonly decisionAccepted: number;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly dimensions: readonly GmDimensionResult[];
  /** Per-case sanitized facts, in corpus order. */
  readonly cases: readonly GmCaseFact[];
}

function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * The addressee a decision must carry for one expectation. The scorer's
 * expectation vocabulary allows the pseudo-kind "clarification" (a
 * clarification is always addressed to the master).
 */
function expectedDecisionAddresseeKind(entry: GmScoreEntry): string {
  return entry.expected.addresseeKind === "clarification" ? "gm" : entry.expected.addresseeKind;
}

function handlesPass(entry: GmScoreEntry, decision: GmTurnDecision): boolean {
  const allowed = entry.expected.allowedHandles ?? [];
  // The EXPECTED structure must be present: answering gm when an npc target
  // was required (or world_question when a clarification was required) fails
  // handles too — otherwise a wrong-shaped decision escapes this dimension.
  if (decision.addressee.kind !== expectedDecisionAddresseeKind(entry)) return false;
  if (decision.kind !== entry.expected.kind) return false;
  if (decision.addressee.kind === "npc") {
    const handle = (decision.addressee as { handle?: string }).handle;
    if (typeof handle !== "string" || !allowed.includes(handle)) return false;
    // A specific NPC is expected: any other visible actor is a miss.
    return entry.expected.expectedHandle === undefined || handle === entry.expected.expectedHandle;
  }
  if (decision.kind === "clarification") {
    const candidates = decision.clarification?.candidateHandles ?? [];
    // A clarification with no candidates, or with an invisible one, fails.
    if (candidates.length === 0) return false;
    return candidates.every((handle) => allowed.includes(handle));
  }
  return true;
}

/** True when the subject expectation is satisfied (no subject expected → pass). */
function subjectPass(entry: GmScoreEntry, decision: GmTurnDecision | undefined): boolean {
  const expected = entry.expected.expectedSubjectHandle;
  if (expected === undefined) return true;
  if (decision === undefined) return false;
  const subject = decision.subjectHandle;
  if (typeof subject !== "string") return false;
  const allowed = entry.expected.allowedHandles;
  if (allowed !== undefined && !allowed.includes(subject)) return false;
  return subject === expected;
}

/** Every string leaf of a decision (question, handle fields, free text). */
function decisionStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") { out.push(value); return out; }
  if (Array.isArray(value)) { for (const item of value) decisionStrings(item, out); return out; }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) decisionStrings(item, out);
  }
  return out;
}

/**
 * True when nothing leaks: the INPUT context carries none of the forbidden
 * substrings AND no string the MODEL produced (clarification question, handle
 * text, steps) contains them either. Fail-closed: forbidden substrings without
 * a context to check are a failure — "no evidence" is never "no leak".
 */
function privacyPass(entry: GmScoreEntry): boolean {
  const forbidden = entry.forbidden ?? [];
  if (forbidden.length === 0) return true;
  if (entry.contextJson === undefined) return false;
  if (forbidden.some((needle) => entry.contextJson!.includes(needle))) return false;
  if (entry.decision !== undefined) {
    const answers = decisionStrings(entry.decision);
    if (forbidden.some((needle) => answers.some((text) => text.includes(needle)))) return false;
  }
  return true;
}

/** Score one entry against its expectation across every dimension. */
export function scoreGmCorpus(entries: readonly GmScoreEntry[]): GmScorecard {
  const total = entries.length;
  const dims: Record<string, { total: number; passed: number; failures: string[] }> = {
    schema: { total, passed: 0, failures: [] },
    decisionAccepted: { total, passed: 0, failures: [] },
    addressee: { total, passed: 0, failures: [] },
    kind: { total, passed: 0, failures: [] },
    handles: { total, passed: 0, failures: [] },
    subject: { total, passed: 0, failures: [] },
    privacy: { total, passed: 0, failures: [] },
  };
  const latencies: number[] = [];
  const cases: GmCaseFact[] = [];

  for (const entry of entries) {
    if (entry.trace.schemaValid) dims.schema.passed += 1;
    else dims.schema.failures.push(entry.input);
    if (entry.trace.totalLatencyMs > 0) latencies.push(entry.trace.totalLatencyMs);

    // Privacy is independent of the decision: a leaked ID fails even on fallback.
    const privacyOk = privacyPass(entry);
    if (privacyOk) dims.privacy.passed += 1;
    else dims.privacy.failures.push(entry.input);

    const decisionValue = entry.decision;
    const addresseeOk = decisionValue !== undefined && decisionValue.addressee.kind === expectedDecisionAddresseeKind(entry);
    const kindOk = decisionValue !== undefined && decisionValue.kind === entry.expected.kind;
    const handlesOk = decisionValue !== undefined && handlesPass(entry, decisionValue);
    // Scored for every entry: a missing subject on an expected topic fails,
    // and an expectation-free entry has nothing to check.
    const subjectOk = subjectPass(entry, decisionValue);
    if (subjectOk) dims.subject.passed += 1;
    else dims.subject.failures.push(entry.input);

    if (decisionValue !== undefined) {
      dims.decisionAccepted.passed += 1;
      if (addresseeOk) dims.addressee.passed += 1;
      else dims.addressee.failures.push(entry.input);
      if (kindOk) dims.kind.passed += 1;
      else dims.kind.failures.push(entry.input);
      if (handlesOk) dims.handles.passed += 1;
      else dims.handles.failures.push(entry.input);
    }

    cases.push(Object.freeze({
      scenario: entry.input,
      expected: {
        addresseeKind: entry.expected.addresseeKind,
        kind: entry.expected.kind,
        expectedHandle: entry.expected.expectedHandle,
        expectedSubjectHandle: entry.expected.expectedSubjectHandle,
        allowedHandles: entry.expected.allowedHandles !== undefined ? Object.freeze([...entry.expected.allowedHandles]) : undefined,
      },
      actual: {
        addresseeKind: decisionValue?.addressee.kind,
        kind: decisionValue?.kind,
        handle: decisionValue?.addressee.kind === "npc" ? decisionValue.addressee.handle : undefined,
        subjectHandle: decisionValue?.subjectHandle,
        candidateHandles: decisionValue?.kind === "clarification" ? decisionValue.clarification?.candidateHandles : undefined,
      },
      passes: { schema: entry.trace.schemaValid, addressee: addresseeOk, kind: kindOk, handles: handlesOk, subject: subjectOk, privacy: privacyOk },
      fallbackReason: entry.trace.fallbackReason,
      provider: entry.trace.provider,
      model: entry.trace.model,
      usedFallback: entry.trace.usedFallback,
    }));
  }

  latencies.sort((a, b) => a - b);
  return {
    contractVersion: entries[0]?.trace.contractVersion ?? 0,
    corpusSize: total,
    schemaValid: dims.schema.passed,
    rawSchemaValid: entries.filter((e) => e.trace.rawSchemaValid).length,
    decisionAccepted: dims.decisionAccepted.passed,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    dimensions: Object.entries(dims).map(([dimension, d]) => ({
      dimension, total: d.total, passed: d.passed, failures: Object.freeze([...d.failures]),
    })),
    cases: Object.freeze(cases),
  };
}
