/**
 * Deterministic eventId derivation for MVP-0.
 *
 * AGENTS invariant #3 forbids `Date.now()`, `Math.random()` and "UUID на
 * лету" inside Rules. We therefore derive eventIds deterministically from
 * the causal chain so replaying the same Event Log reproduces identical ids
 * — a requirement of determinism (AGENTS §9.1).
 *
 * Scheme:
 *   - A rule producing events from triggering event E derives:
 *       `${E.eventId}>${producedType}#${index}`
 *   - The Command Handler (infra, NOT a Rule) produces the first event of a
 *     chain (causationId === null) and derives:
 *       `${correlationId}#${producedType}`
 *
 * Both schemes are pure functions of their inputs — no global mutable state,
 * no randomness, no clock. Replay yields identical ids.
 */

export function ruleEventId(
  triggeringEventId: string,
  producedType: string,
  index: number,
): string {
  return `${triggeringEventId}>${producedType}#${index}`;
}

export function commandEventId(correlationId: string, type: string): string {
  return `${correlationId}#${type}`;
}