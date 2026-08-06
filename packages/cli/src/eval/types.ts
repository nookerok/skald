/**
 * Eval harness types (packages/cli/src/eval).
 *
 * The eval harness is a deterministic, LLM-runnable conformance surface on top
 * of the canonical simulation core. A Scenario is scripted player intent; every
 * committed event is a canonical Domain Event; assertions and the invariant
 * audit are pure and machine-checkable. The LLM authors scenarios and improves
 * presentation code; it never decides player actions at runtime (AGENTS #4-6).
 */

import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";

/** A single player action or wait, exactly as the CLI/HTTP surface accepts it. */
export type ScenarioStep =
  | { readonly input: string }
  | { readonly wait: number }
  | { readonly assert: { readonly checks: readonly Check[] } };

export type Check =
  | { readonly kind: "eventTypeSeen"; readonly type: string }
  | { readonly kind: "eventTypeSeenSinceLast"; readonly type: string }
  | { readonly kind: "eventTypeAbsent"; readonly type: string }
  | { readonly kind: "worldTime"; readonly value: number }
  | { readonly kind: "playerAt"; readonly x: number; readonly y: number }
  | { readonly kind: "observationAtLeast"; readonly key: string; readonly value: number }
  | { readonly kind: "consequenceActive" }
  | { readonly kind: "situationActive"; readonly situationId: string }
  | { readonly kind: "presentationContains"; readonly text: string }
  | { readonly kind: "beliefCountMin"; readonly value: number }
  | { readonly kind: "observerMapPresent" }
  | { readonly kind: "observerMapHasLocations"; readonly value: number }
  | { readonly kind: "relationValueAtLeast"; readonly from: string; readonly to: string; readonly relationKind: string; readonly value: number };

/** Optional structured metadata for extensible scenario libraries. */
export interface ScenarioMeta {
  readonly domain?: string;
  readonly difficulty?: "sanity" | "feature" | "stress";
  readonly goal?: string;
}

export interface Scenario {
  readonly name: string;
  readonly description?: string;
  /** World template id: legacy | old_tower | crossroads | living_region. */
  readonly worldTemplate: string;
  readonly turns: readonly ScenarioStep[];
  readonly finalChecks?: readonly Check[];
  /** Domain tags for library navigation and per-tag coverage (e.g. weather, belief). */
  readonly tags?: readonly string[];
  readonly meta?: ScenarioMeta;
}

/** The observer-scoped player view after one step (what the browser renders). */
export interface TurnTranscript {
  readonly state: unknown;
  readonly presentation: unknown;
  readonly gameShell: unknown;
  readonly belief: unknown;
  readonly observerMap?: unknown;
}

export interface StepResult {
  readonly step: ScenarioStep;
  readonly committedEvents: readonly string[];
  readonly lastStepEvents: readonly DomainEvent[];
  readonly worldTime: number;
  readonly transcript: TurnTranscript;
  readonly failures: readonly string[];
}

export interface AuditResult {
  readonly purity: boolean;
  readonly worldTimeMonotonic: boolean;
  readonly idempotency: boolean;
  readonly noTruthLeak: boolean;
  readonly presentationHonest: boolean;
  readonly notes: readonly string[];
}

export interface EvalReport {
  readonly name: string;
  readonly worldTemplate: string;
  readonly description?: string;
  readonly steps: readonly StepResult[];
  readonly finalCheckFailures: readonly string[];
  readonly audit: AuditResult;
  readonly pass: boolean;
}

/** Everything a check or auditor needs about the current point in the run. */
export interface CheckContext {
  readonly allEvents: readonly DomainEvent[];
  readonly lastStepEvents: readonly DomainEvent[];
  readonly world: ReadonlyWorld;
  readonly stateJson: string;
  readonly beliefJson: string;
  readonly transcript: TurnTranscript;
  readonly worldTime: number;
}

/** Per-rule firing count and produced event types collected by the harness. */
export interface RuleCoverage {
  readonly fired: ReadonlyMap<string, number>;
  /** Event types each rule actually produced, for the rule dependency graph. */
  readonly produced: ReadonlyMap<string, readonly string[]>;
  readonly total: number;
}

/** One scenario scored for the Simulation Quality Report. */
export interface ScenarioQuality {
  readonly name: string;
  readonly tags: readonly string[];
  readonly worldTemplate: string;
  readonly pass: boolean;
  readonly stepCount: number;
  readonly eventCount: number;
  readonly determinism: boolean;
  readonly purity: boolean;
  readonly noTruthLeak: boolean;
  readonly presentationHonest: boolean;
  readonly idempotency: boolean;
  readonly ruleCoverage: number;
}

export interface RuleCoverageEntry {
  readonly ruleId: string;
  readonly phase: string;
  readonly scenariosFired: number;
  readonly totalFired: number;
}

/** Deterministic aggregate quality report; no timestamps, no randomness. */
export interface QualityReport {
  readonly commit: string;
  readonly scenarioCount: number;
  readonly totalRules: number;
  readonly metrics: {
    readonly scenarioPassRate: number;
    readonly determinismRate: number;
    readonly purityRate: number;
    readonly presentationHonestRate: number;
    readonly noTruthLeakRate: number;
    readonly ruleCoverageRate: number;
  };
  readonly ruleCoverage: readonly RuleCoverageEntry[];
  readonly perScenario: readonly ScenarioQuality[];
}
