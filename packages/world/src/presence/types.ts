/**
 * Observer presence reconstruction — UX-6 read-model contract.
 *
 * Pure read-side types. Nothing here is a Rule, Domain Event or Projection
 * field. All content is derived from the observer-scoped BeliefModel, the
 * player-facing journal and the explicitly allowed player context; hidden
 * world state and internal identifiers never enter the player-facing DTOs.
 * Internal identifiers (patternId, evidenceId, threadKey) live only in the
 * separate diagnostics DTO (`PresenceDiagnosticsDTO`).
 */

import type {
  BeliefModelDTO,
  Confidence,
  PatternId,
  SimTime,
} from "../observation/types.js";

/** Operational world revision (world time + event number). */
export interface WorldRevision {
  readonly worldTime: number;
  readonly eventNumber: number;
}

/** Operational, non-authoritative memory of the last player presence. */
export interface ObserverCheckpoint {
  readonly worldId: string;
  readonly observerId: "player";
  readonly lastPresenceWorldTime: number;
  readonly lastPresenceEventNumber: number;
  /** Deterministic FNV-1a digest of the BeliefModel at the checkpoint. */
  readonly beliefRevision: number;
  /** Wall-clock operational metadata. Never used for drift. */
  readonly updatedAt: string;
}

/**
 * Validity of the stored checkpoint against a deterministic replay of the
 * Event Log prefix. `incompatible` means the digest does not match; presence
 * is then built as if there were no checkpoint.
 */
export type CheckpointState = "missing" | "valid" | "incompatible";

/** Deterministic level of belief drift between checkpoint and now. */
export type BeliefDriftLevel = "none" | "low" | "medium" | "high";

/** Reason kinds that can contribute to belief drift. */
export type BeliefDriftReasonKind =
  | "freshness_decay"
  | "contradiction"
  | "missing_evidence"
  | "new_observation";

/** One player-facing reason for drift. */
export interface BeliefDriftReason {
  readonly kind: BeliefDriftReasonKind;
  readonly text: string;
}

/** Backend-computed difference between remembered and currently observable knowledge. */
export interface BeliefDriftDTO {
  readonly level: BeliefDriftLevel;
  readonly worldTimeDelta: number;
  readonly staleBeliefCount: number;
  readonly contradictedBeliefCount: number;
  readonly unresolvedThreadCount: number;
  readonly newlyObservedChangeCount: number;
  readonly reasons: readonly BeliefDriftReason[];
}

/** A subject whose previous knowledge is no longer fully supported. */
export interface BeliefReference {
  readonly displayName: string;
  readonly interpretation: string;
  readonly lastObserved: SimTime;
  readonly freshness: Confidence;
}

/** An observed difference the player can currently perceive. */
export interface ObservedChange {
  readonly description: string;
  readonly observedAt: SimTime;
}

/** A doubt that needs re-observation; never a command. */
export interface ReobservationSubject {
  readonly displayName: string;
  readonly reason: string;
  readonly lastObserved: SimTime;
}

/** Neutral summary of a known thread without recent entries. */
export interface DormantThreadSummary {
  readonly label: string;
  readonly lastWorldTime: number;
  readonly entryCount: number;
}

/**
 * Explicitly allowed player context. Display-safe subset of the player's own
 * situation, provided by the HTTP boundary; presence builders never read
 * Simulation/Projection for this content.
 */
export interface PlayerContext {
  readonly locationTitle: string;
  readonly locationDescription: string;
}

/** The moment of return: short player-facing statements about the current place. */
export interface PresenceFocus {
  /**
   * Reserved for a future World Clock law. The world has no time-of-day
   * law today, so this is always null and never invented.
   */
  readonly timeDescription: null;
  /** Derived only from observable heat evidence; heat is ambient, not weather. */
  readonly ambientDescription: string | null;
  readonly sensoryCues: readonly string[];
  readonly rememberedContext: readonly string[];
}

/** Full backend-derived presence reconstruction. */
export interface PresenceSnapshot {
  readonly schemaVersion: 1;
  readonly observerId: "player";
  readonly revision: WorldRevision;
  readonly location: { readonly title: string; readonly description: string };
  readonly focus: PresenceFocus;
  readonly drift: BeliefDriftDTO;
  /** Informational only; dormant threads never affect the drift score. */
  readonly dormantThreads: readonly DormantThreadSummary[];
  readonly nearbyChanges: readonly ObservedChange[];
  readonly staleBeliefs: readonly BeliefReference[];
  readonly suggestedReobservations: readonly ReobservationSubject[];
}

/** One sentence of the "while you were away" montage. */
export interface PresenceStatement {
  readonly text: string;
  readonly source:
    | "observation_delta"
    | "belief_freshness"
    | "belief_contradiction"
    | "known_thread";
}

/**
 * Observer-safe scene shown before the player acknowledges their first
 * presence in an authored living-region story. It contains presentation
 * facts only; internal ids and simulation identifiers never cross this
 * boundary.
 */
export interface FirstEntryDTO {
  readonly schemaVersion: 1;
  readonly character: { readonly name: string };
  readonly background: { readonly title: string; readonly summary: string };
  readonly startingLocation: { readonly title: string; readonly description: string };
  readonly reasonForArrival: string;
  readonly visibleSituation: string;
  readonly sensoryContext: readonly string[];
  readonly knownContact: { readonly name: string; readonly description: string } | null;
  readonly personalHook: string;
}

/** Consistent aggregate returned to the entry path. */
export interface ObserverSessionDTO {
  readonly schemaVersion: 2;
  readonly revision: WorldRevision;
  readonly checkpointState: CheckpointState;
  readonly checkpoint: ObserverCheckpoint | null;
  readonly beliefModel: BeliefModelDTO;
  readonly drift: BeliefDriftDTO;
  readonly presence: PresenceSnapshot;
  /** Present only while the observer checkpoint is missing for an authored start. */
  readonly firstEntry: FirstEntryDTO | null;
  /** Montage sentences; content authority stays on the backend. */
  readonly statements: readonly PresenceStatement[];
}

/** Lightweight per-world card shown on the Known Worlds screen. */
export interface WorldPresenceSummary {
  readonly schemaVersion: 1;
  readonly worldId: string;
  readonly checkpointState: CheckpointState;
  /** Trustworthy presence time; null unless the checkpoint resolves valid. */
  readonly lastPresenceWorldTime: number | null;
  readonly currentWorldTime: number;
  /** 0 when there is no trustworthy checkpoint to measure against. */
  readonly worldTimeDelta: number;
  readonly driftLevel: BeliefDriftLevel;
  readonly staleBeliefCount: number;
  readonly dormantThreadCount: number;
  /** Threads whose knowledge is not current; 0 without a trustworthy checkpoint. */
  readonly uncertainThreadCount: number;
  /** Threads that changed since the last presence; 0 without a checkpoint. */
  readonly changedThreadCount: number;
  /** Ready player-facing status; the browser never classifies drift itself. */
  readonly presenceStatus: string;
  /** Ready player-facing knowledge doubts; null when nothing needs attention. */
  readonly knowledgeStatus: string | null;
}

// --- Diagnostics DTO (developer surface, never the normal player UI) ---

/** Diagnostics variant of a stale-belief reference with internal IDs. */
export interface DiagnosticsBeliefReference {
  readonly patternId: PatternId;
  readonly displayName: string;
  readonly interpretation: string;
  readonly lastObserved: SimTime;
  readonly freshness: Confidence;
}

/** Diagnostics variant of an observed change with internal IDs. */
export interface DiagnosticsObservedChange {
  readonly targetId: PatternId;
  readonly description: string;
  readonly observedAt: SimTime;
  readonly evidenceId: string;
}

/** Diagnostics variant of a dormant thread with its internal key. */
export interface DiagnosticsDormantThread {
  readonly threadKey: string;
  readonly label: string;
  readonly lastWorldTime: number;
  readonly entryCount: number;
}

/** Diagnostics variant of a montage statement with evidence IDs. */
export interface DiagnosticsStatement {
  readonly text: string;
  readonly source: PresenceStatement["source"];
  readonly evidenceIds: readonly string[];
}

/**
 * Identical reconstruction with internal identifiers included. Intended for
 * an explicitly-opened Diagnostics surface only; the normal renderer must
 * never receive this.
 */
export interface PresenceDiagnosticsDTO {
  readonly schemaVersion: 1;
  readonly revision: WorldRevision;
  readonly checkpointState: CheckpointState;
  readonly staleBeliefs: readonly DiagnosticsBeliefReference[];
  readonly contradictedPatterns: readonly PatternId[];
  readonly nearbyChanges: readonly DiagnosticsObservedChange[];
  readonly dormantThreads: readonly DiagnosticsDormantThread[];
  readonly statements: readonly DiagnosticsStatement[];
}
