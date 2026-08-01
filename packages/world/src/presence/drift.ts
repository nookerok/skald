/**
 * Belief drift — deterministic backend computation of how much the player's
 * remembered knowledge diverges from what is observable now.
 *
 * The formula and thresholds are fixed by ADR-0009. Nothing here reads raw
 * world state; inputs are observer-scoped belief models and player-facing
 * thread summaries only.
 */

import type { BeliefModelDTO } from "../observation/types.js";
import type {
  BeliefDriftDTO,
  BeliefDriftLevel,
  BeliefDriftReason,
  ObserverCheckpoint,
  ObservedChange,
  WorldRevision,
} from "./types.js";

/** Freshness at or below this value marks a belief as stale. */
export const STALE_FRESHNESS_THRESHOLD = 1 / 3;
/** Weight of a contradicted belief in the drift score. */
export const CONTRADICTION_WEIGHT = 2;
/** Caps per drift factor, fixed by ADR-0009. */
const STALE_CAP = 8;
const CONTRADICTED_CAP = 8;
const THREADS_CAP = 4;
const CHANGES_CAP = 8;
/** Score thresholds for low / medium / high. Fixed by ADR-0009. */
const LOW_SCORE_MAX = 2;
const MEDIUM_SCORE_MAX = 5;

/** Deterministic FNV-1a 32-bit digest over the stable serialization. */
export function computeBeliefRevision(model: BeliefModelDTO): number {
  let hash = 0x811c9dc5;
  const serialized = JSON.stringify(model);
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function driftLevel(worldTimeDelta: number, hasCheckpoint: boolean, score: number): BeliefDriftLevel {
  if (!hasCheckpoint || worldTimeDelta <= 0 || score <= 0) return "none";
  if (score <= LOW_SCORE_MAX) return "low";
  if (score <= MEDIUM_SCORE_MAX) return "medium";
  return "high";
}

/** Builds the ordered deterministic reason list. */
export function buildDriftReasons(input: {
  staleBeliefCount: number;
  contradictedBeliefCount: number;
  missingEvidenceCount: number;
  newlyObservedChangeCount: number;
}): readonly BeliefDriftReason[] {
  const reasons: BeliefDriftReason[] = [];
  if (input.staleBeliefCount > 0) {
    reasons.push({ kind: "freshness_decay", text: `${input.staleBeliefCount} ${pluralObservation(input.staleBeliefCount)} утратил${input.staleBeliefCount === 1 ? "о" : "и"} свежесть.` });
  }
  if (input.contradictedBeliefCount > 0) {
    reasons.push({ kind: "contradiction", text: `${input.contradictedBeliefCount} ${pluralBelief(input.contradictedBeliefCount)} противореч${input.contradictedBeliefCount === 1 ? "ит" : "ат"} новым свидетельствам.` });
  }
  if (input.missingEvidenceCount > 0) {
    reasons.push({ kind: "missing_evidence", text: "Часть прежних знаний требует повторного подтверждения." });
  }
  if (input.newlyObservedChangeCount > 0) {
    reasons.push({ kind: "new_observation", text: "Обнаружены изменения, которые можно заметить сейчас." });
  }
  return reasons;
}

function pluralObservation(count: number): string {
  return count === 1 ? "наблюдение" : "наблюдения";
}

function pluralBelief(count: number): string {
  return count === 1 ? "убеждение" : "убеждения";
}

/** Computes the drift DTO from reconstructed and current knowledge. */
export function computeBeliefDrift(input: {
  checkpoint: ObserverCheckpoint | null;
  checkpointModel: BeliefModelDTO | null;
  currentModel: BeliefModelDTO;
  currentRevision: WorldRevision;
  staleBeliefCount: number;
  contradictedBeliefCount: number;
  unresolvedThreadCount: number;
  newlyObservedChanges: readonly ObservedChange[];
  missingEvidenceCount: number;
}): BeliefDriftDTO {
  const worldTimeDelta = input.checkpoint
    ? Math.max(0, input.currentRevision.worldTime - input.checkpoint.lastPresenceWorldTime)
    : 0;
  const stale = Math.min(input.staleBeliefCount, STALE_CAP);
  const contradicted = Math.min(input.contradictedBeliefCount * CONTRADICTION_WEIGHT, CONTRADICTED_CAP);
  // Thread lifecycle (open/resolved) does not exist in the journal yet;
  // dormant threads are informational and callers pass 0 here. The factor is
  // kept per ADR-0009 for when an explicit lifecycle lands.
  const threads = Math.min(input.unresolvedThreadCount, THREADS_CAP);
  const changes = Math.min(Math.ceil(input.newlyObservedChanges.length / 2), CHANGES_CAP);
  const score = stale + contradicted + threads + changes;

  return Object.freeze({
    level: driftLevel(worldTimeDelta, input.checkpoint !== null, score),
    worldTimeDelta,
    staleBeliefCount: input.staleBeliefCount,
    contradictedBeliefCount: input.contradictedBeliefCount,
    unresolvedThreadCount: input.unresolvedThreadCount,
    newlyObservedChangeCount: input.newlyObservedChanges.length,
    reasons: Object.freeze(buildDriftReasons({
      staleBeliefCount: input.staleBeliefCount,
      contradictedBeliefCount: input.contradictedBeliefCount,
      missingEvidenceCount: input.missingEvidenceCount,
      newlyObservedChangeCount: input.newlyObservedChanges.length,
    })),
  });
}
