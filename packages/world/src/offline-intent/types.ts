/**
 * Offline Intent Queue (UX-6.3) — shared DTO types.
 *
 * The browser stores only a Command envelope: the original text, an
 * idempotency key and the base revision (the world event number the player
 * last saw). It never stores Domain Events, never simulates and never
 * mutates World State. The server re-interprets the envelope and classifies
 * it into exactly one OfflineIntentResolution.
 */

export type OfflineIntentResolution =
  | "accepted"
  | "rejected"
  | "conflict"
  | "already_processed";

export type OfflineRejectReason =
  | "unparsable"
  | "unsupported_offline_intent"
  | "no_such_target"
  | "not_applicable"
  | "invalid_envelope";

export interface OfflineIntentEnvelope {
  readonly input: string;
  readonly idempotencyKey: string;
  readonly baseRevision: number;
}

/**
 * Player-facing classification result. `message` is display-safe text for
 * rejected/conflict outcomes; it is null when the envelope is accepted or
 * already processed. The DTO never carries internal identifiers.
 */
export interface OfflineIntentResolutionDTO {
  readonly resolution: OfflineIntentResolution;
  readonly message: string | null;
  readonly reason: OfflineRejectReason | null;
}
