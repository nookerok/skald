import type { PatternLifecycle, PatternLifecycleState, PatternLifecycleTransition } from "./types.js";

/** The legal lifecycle graph for Pattern Ontology v1.0. */
export const PATTERN_LIFECYCLE_TRANSITIONS: Readonly<Record<PatternLifecycleState, readonly PatternLifecycleState[]>> = Object.freeze({
  latent: Object.freeze(["observed"] as const),
  observed: Object.freeze(["emerging", "weakening", "dissolved"] as const),
  emerging: Object.freeze(["stable", "weakening", "dissolved"] as const),
  stable: Object.freeze(["weakening", "dissolved"] as const),
  weakening: Object.freeze(["stable", "dissolved"] as const),
  dissolved: Object.freeze([] as const),
});

/** Returns whether a lifecycle transition is legal. */
export function canTransitionPatternLifecycle(
  from: PatternLifecycleState,
  to: PatternLifecycleState,
): boolean {
  return PATTERN_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Applies one legal lifecycle transition without mutating the input. */
export function transitionPatternLifecycle(
  lifecycle: PatternLifecycle,
  transition: PatternLifecycleTransition,
): PatternLifecycle {
  if (lifecycle.state !== transition.from || !canTransitionPatternLifecycle(transition.from, transition.to)) {
    throw new Error(`Illegal pattern lifecycle transition: ${lifecycle.state} -> ${transition.to}`);
  }
  return Object.freeze({
    state: transition.to,
    changedAt: transition.at,
    version: lifecycle.version + 1,
  });
}
