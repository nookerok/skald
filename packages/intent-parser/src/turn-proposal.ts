/**
 * Closed TurnProposalV2 contract (ADR-0028 Master Turn revision, plan_6 Stage 2).
 *
 * An untrusted LLM description of one whole player replica: at most one
 * executable primary intent plus read-only supporting clauses. It never
 * reaches the Command Handler directly; static validation lives in
 * turn-proposal-validator.ts and contextual referent revalidation happens
 * server-side with the current world (later stage). Production still runs
 * IntentProposalV1 until the gateway migrates; this module only adds the
 * closed schema next to V1.
 */

import { INTENT_CAPABILITIES } from "./intent-proposal.js";
import { INQUIRY_QUERY_IDS, isInquiryQueryId } from "./inquiry.js";

/** Turn kinds the model may classify a replica into. */
export type TurnProposalKind = "action" | "inquiry" | "speech" | "mixed" | "meta";

/** Closed legacy operation registry for V2 `legacy` actions (mirrors V1). */
export const TURN_LEGACY_OPERATIONS = [
  "approach",
  "enter",
  "heat",
  "cool",
  "create_mark",
  "speak",
  "call",
  "wait",
] as const;

/** One of the closed legacy operations a V2 proposal may name. */
export type TurnLegacyOperation = (typeof TURN_LEGACY_OPERATIONS)[number];

/** Closed interaction verb registry for V2, composed from the V1 manifest. */
export type TurnInteractionVerb = (typeof INTENT_CAPABILITIES.interactionVerbs)[number];

/** Closed meta-operation registry (plan_6 Stage 12): read-only UI help only. */
export const TURN_META_OPERATIONS = [
  "repeat_last_answer",
  "explain_available_actions",
  "open_map_hint",
  "explain_interface",
] as const;

/** One of the closed read-only meta operations. */
export type TurnMetaOperation = (typeof TURN_META_OPERATIONS)[number];

/** Closed spatial-relation registry for inquiry focus (plan_6 Stage 6). */
export const TURN_INQUIRY_RELATIONS = ["behind", "near", "inside", "beyond"] as const;

/** One of the closed read-only spatial relations. */
export type TurnInquiryRelation = (typeof TURN_INQUIRY_RELATIONS)[number];

/** Closed referent-role registry. */
export type TurnReferentRole = "target" | "addressee" | "topic" | "destination" | "instrument";

/** Closed ambiguity-kind registry. */
export type TurnAmbiguityKind = "referent" | "action" | "question" | "destination";

/** Maximum length of any free-text string in a proposal. */
export const TURN_MAX_STRING = 240;

/** Maximum number of supporting clauses per proposal. */
export const TURN_MAX_SUPPORTING = 4;

/** Maximum number of referent candidates per proposal. */
export const TURN_MAX_REFERENTS = 8;

/** Maximum number of ambiguity candidates per proposal. */
export const TURN_MAX_CANDIDATES = 4;

/**
 * Transient observer handle format: `person_1`, `object_2`, `route_1`,
 * `topic_3`. Never an entity, location, event or world id.
 */
export const OBSERVER_REF_PATTERN = /^(person|object|route|topic)_[1-9][0-9]?$/;

/**
 * Fields a non-authoritative model must never return. `hasOnlyKeys` already
 * rejects them as unknown, but the validator reports them explicitly as
 * authority violations.
 */
export const TURN_AUTHORITY_FIELDS: readonly string[] = Object.freeze([
  "success",
  "difficulty",
  "entityId",
  "entity_id",
  "locationId",
  "location_id",
  "worldId",
  "world_id",
  "eventId",
  "event_id",
  "event",
  "events",
  "consequence",
  "consequences",
  "sourceEventIds",
  "coordinates",
  "confidence",
  "modelConfidence",
  "routeId",
]);

/** A transient observer-safe candidate referenced by a proposal. */
export interface ProposedReferent {
  readonly role: TurnReferentRole;
  readonly observerRef?: string;
  readonly surface: string;
}

/** The single executable primary action of an `action` or `mixed` turn. */
export type ProposedAction =
  | {
      readonly kind: "interaction";
      readonly verb: TurnInteractionVerb;
      readonly sourceText: string;
    }
  | {
      readonly kind: "journey";
      readonly destination: ProposedReferent;
      readonly routeHint?: string;
      readonly sourceText: string;
    }
  | {
      readonly kind: "legacy";
      readonly operation: TurnLegacyOperation;
      readonly sourceText: string;
    };

/** The primary inquiry of an `inquiry` turn. */
export interface ProposedInquiry {
  readonly kind: "inquiry";
  readonly queryId: string;
  readonly focus?: ProposedReferent;
  readonly relation?: TurnInquiryRelation;
  readonly sourceText: string;
}

/** The primary speech of a `speech` turn. Addressee/topic travel via the turn-level addressedEntity and supporting clauses. */
export interface ProposedSpeech {
  readonly kind: "speech";
  readonly utterance: string;
  readonly sourceText: string;
}

/** The primary meta request of a `meta` turn: read-only UI help only. */
export interface ProposedMeta {
  readonly kind: "meta";
  readonly operation: TurnMetaOperation;
  readonly sourceText: string;
}

/** The single primary intent of a turn, or null when only ambiguity is reported. */
export type TurnPrimaryIntent = ProposedAction | ProposedInquiry | ProposedSpeech | ProposedMeta | null;

/** A read-only question attached to a `mixed` or `inquiry` turn. */
export interface ProposedQuestion {
  readonly queryId: string;
  readonly focus?: ProposedReferent;
  readonly relation?: TurnInquiryRelation;
}

/** A non-executed supporting clause. `deferred_action` names a noticed second action the server must not run this turn. */
export type SupportingClause =
  | {
      readonly kind: "constraint";
      readonly value: string;
    }
  | {
      readonly kind: "manner";
      readonly value: string;
    }
  | {
      readonly kind: "question";
      readonly queryId: string;
      readonly focus?: ProposedReferent;
    }
  | {
      readonly kind: "speech_topic";
      readonly topic: ProposedReferent;
    }
  | {
      readonly kind: "deferred_action";
      readonly summary: string;
    };

/** A model-reported ambiguity; the server answers with clarification. */
export interface ProposedAmbiguity {
  readonly kind: TurnAmbiguityKind;
  readonly question: string;
  readonly candidates: readonly string[];
}

/** Untrusted model output for one player replica. Never handed to the Command Handler. */
export interface TurnProposalV2 {
  readonly schemaVersion: 2;
  readonly kind: TurnProposalKind;
  readonly primaryIntent: TurnPrimaryIntent;
  readonly supportingClauses: readonly SupportingClause[];
  readonly addressedEntity?: ProposedReferent;
  readonly target?: ProposedReferent;
  readonly goal?: string;
  readonly manner?: string;
  readonly question?: ProposedQuestion;
  readonly referents: readonly ProposedReferent[];
  readonly ambiguity?: ProposedAmbiguity;
}

/**
 * Control characters (C0 except tab, LF and CR — the same set V1 rejects)
 * are never valid inside proposal strings. Compared by code point so the
 * source needs no escape sequences.
 */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) return true;
  }
  return false;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isCleanString(value: unknown, max: number, allowEmpty: boolean): value is string {
  return typeof value === "string"
    && (allowEmpty || value.length > 0)
    && value.length <= max
    && !hasControlChars(value);
}

function isReferentRole(value: unknown): value is TurnReferentRole {
  return value === "target" || value === "addressee" || value === "topic" || value === "destination" || value === "instrument";
}

function isInteractionVerb(value: unknown): value is TurnInteractionVerb {
  return typeof value === "string" && (INTENT_CAPABILITIES.interactionVerbs as readonly string[]).includes(value);
}

function isLegacyOperation(value: unknown): value is TurnLegacyOperation {
  return typeof value === "string" && (TURN_LEGACY_OPERATIONS as readonly string[]).includes(value);
}

function isMetaOperation(value: unknown): value is TurnMetaOperation {
  return typeof value === "string" && (TURN_META_OPERATIONS as readonly string[]).includes(value);
}

function isInquiryRelation(value: unknown): value is TurnInquiryRelation {
  return typeof value === "string" && (TURN_INQUIRY_RELATIONS as readonly string[]).includes(value);
}

function isAmbiguityKind(value: unknown): value is TurnAmbiguityKind {
  return value === "referent" || value === "action" || value === "question" || value === "destination";
}

function parseReferent(raw: unknown): ProposedReferent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ["role", "observerRef", "surface"])) return null;
  if (!isReferentRole(candidate.role)) return null;
  if (candidate.observerRef !== undefined
    && (typeof candidate.observerRef !== "string" || !OBSERVER_REF_PATTERN.test(candidate.observerRef))) return null;
  if (!isCleanString(candidate.surface, TURN_MAX_STRING, false)) return null;
  return Object.freeze({
    role: candidate.role,
    ...(candidate.observerRef !== undefined ? { observerRef: candidate.observerRef as string } : {}),
    surface: candidate.surface as string,
  });
}

function parseReferentList(raw: unknown, max: number): readonly ProposedReferent[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const items: ProposedReferent[] = [];
  for (const entry of raw) {
    const referent = parseReferent(entry);
    if (!referent) return null;
    items.push(referent);
  }
  return Object.freeze(items);
}

function parseAction(raw: unknown): ProposedAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind === "interaction") {
    if (!hasOnlyKeys(candidate, ["kind", "verb", "sourceText"])) return null;
    if (!isInteractionVerb(candidate.verb)) return null;
    if (!isCleanString(candidate.sourceText, TURN_MAX_STRING, false)) return null;
    return Object.freeze({ kind: "interaction" as const, verb: candidate.verb, sourceText: candidate.sourceText as string });
  }
  if (candidate.kind === "journey") {
    if (!hasOnlyKeys(candidate, ["kind", "destination", "routeHint", "sourceText"])) return null;
    const destination = parseReferent(candidate.destination);
    if (!destination) return null;
    if (candidate.routeHint !== undefined && !isCleanString(candidate.routeHint, TURN_MAX_STRING, false)) return null;
    if (!isCleanString(candidate.sourceText, TURN_MAX_STRING, false)) return null;
    return Object.freeze({
      kind: "journey" as const,
      destination,
      ...(candidate.routeHint !== undefined ? { routeHint: candidate.routeHint as string } : {}),
      sourceText: candidate.sourceText as string,
    });
  }
  if (candidate.kind === "legacy") {
    if (!hasOnlyKeys(candidate, ["kind", "operation", "sourceText"])) return null;
    if (!isLegacyOperation(candidate.operation)) return null;
    if (!isCleanString(candidate.sourceText, TURN_MAX_STRING, false)) return null;
    return Object.freeze({ kind: "legacy" as const, operation: candidate.operation, sourceText: candidate.sourceText as string });
  }
  return null;
}

function parseInquiry(raw: unknown): ProposedInquiry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind !== "inquiry") return null;
  if (!hasOnlyKeys(candidate, ["kind", "queryId", "focus", "relation", "sourceText"])) return null;
  if (!isInquiryQueryId(candidate.queryId)) return null;
  if (candidate.focus !== undefined) {
    if (!parseReferent(candidate.focus)) return null;
  }
  if (candidate.relation !== undefined && !isInquiryRelation(candidate.relation)) return null;
  if (!isCleanString(candidate.sourceText, TURN_MAX_STRING, false)) return null;
  return Object.freeze({
    kind: "inquiry" as const,
    queryId: candidate.queryId as string,
    ...(candidate.focus !== undefined ? { focus: parseReferent(candidate.focus)! } : {}),
    ...(candidate.relation !== undefined ? { relation: candidate.relation as TurnInquiryRelation } : {}),
    sourceText: candidate.sourceText as string,
  });
}

function parseSpeech(raw: unknown): ProposedSpeech | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind !== "speech") return null;
  if (!hasOnlyKeys(candidate, ["kind", "utterance", "sourceText"])) return null;
  if (!isCleanString(candidate.utterance, TURN_MAX_STRING, false)) return null;
  if (!isCleanString(candidate.sourceText, TURN_MAX_STRING, false)) return null;
  return Object.freeze({ kind: "speech" as const, utterance: candidate.utterance as string, sourceText: candidate.sourceText as string });
}

function parseMeta(raw: unknown): ProposedMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind !== "meta") return null;
  if (!hasOnlyKeys(candidate, ["kind", "operation", "sourceText"])) return null;
  if (!isMetaOperation(candidate.operation)) return null;
  if (!isCleanString(candidate.sourceText, TURN_MAX_STRING, false)) return null;
  return Object.freeze({ kind: "meta" as const, operation: candidate.operation, sourceText: candidate.sourceText as string });
}

function parsePrimary(raw: unknown): TurnPrimaryIntent | undefined {
  if (raw === null) return null;
  const action = parseAction(raw);
  if (action) return action;
  const inquiry = parseInquiry(raw);
  if (inquiry) return inquiry;
  const speech = parseSpeech(raw);
  if (speech) return speech;
  const meta = parseMeta(raw);
  if (meta) return meta;
  return undefined;
}

function parseQuestion(raw: unknown): ProposedQuestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ["queryId", "focus", "relation"])) return null;
  if (!isInquiryQueryId(candidate.queryId)) return null;
  if (candidate.focus !== undefined) {
    if (!parseReferent(candidate.focus)) return null;
  }
  if (candidate.relation !== undefined && !isInquiryRelation(candidate.relation)) return null;
  return Object.freeze({
    queryId: candidate.queryId as string,
    ...(candidate.focus !== undefined ? { focus: parseReferent(candidate.focus)! } : {}),
    ...(candidate.relation !== undefined ? { relation: candidate.relation as TurnInquiryRelation } : {}),
  });
}

function parseSupportingClause(raw: unknown): SupportingClause | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind === "constraint" || candidate.kind === "manner") {
    if (!hasOnlyKeys(candidate, ["kind", "value"])) return null;
    if (!isCleanString(candidate.value, TURN_MAX_STRING, false)) return null;
    return Object.freeze({ kind: candidate.kind, value: candidate.value as string });
  }
  if (candidate.kind === "question") {
    if (!hasOnlyKeys(candidate, ["kind", "queryId", "focus"])) return null;
    if (!isInquiryQueryId(candidate.queryId)) return null;
    if (candidate.focus !== undefined) {
      const focus = parseReferent(candidate.focus);
      if (!focus) return null;
      return Object.freeze({ kind: "question" as const, queryId: candidate.queryId as string, focus });
    }
    return Object.freeze({ kind: "question" as const, queryId: candidate.queryId as string });
  }
  if (candidate.kind === "speech_topic") {
    if (!hasOnlyKeys(candidate, ["kind", "topic"])) return null;
    const topic = parseReferent(candidate.topic);
    if (!topic) return null;
    return Object.freeze({ kind: "speech_topic" as const, topic });
  }
  if (candidate.kind === "deferred_action") {
    if (!hasOnlyKeys(candidate, ["kind", "summary"])) return null;
    if (!isCleanString(candidate.summary, TURN_MAX_STRING, false)) return null;
    return Object.freeze({ kind: "deferred_action" as const, summary: candidate.summary as string });
  }
  return null;
}

function parseAmbiguity(raw: unknown): ProposedAmbiguity | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ["kind", "question", "candidates"])) return null;
  if (!isAmbiguityKind(candidate.kind)) return null;
  if (!isCleanString(candidate.question, TURN_MAX_STRING, false)) return null;
  if (!Array.isArray(candidate.candidates)
    || candidate.candidates.length === 0
    || candidate.candidates.length > TURN_MAX_CANDIDATES) return null;
  for (const entry of candidate.candidates) {
    if (!isCleanString(entry, TURN_MAX_STRING, false)) return null;
  }
  return Object.freeze({
    kind: candidate.kind,
    question: candidate.question as string,
    candidates: Object.freeze([...(candidate.candidates as string[])]),
  });
}

/**
 * Parses untrusted JSON into a frozen TurnProposalV2. Returns null for any
 * shape violation: unknown keys, bad enums, oversized or tainted strings,
 * malformed observer refs or broken nesting. Semantic checks (kind/primary
 * consistency, valency, question placement, referent membership) belong to
 * validateTurnProposal.
 */
export function parseTurnProposal(raw: unknown): TurnProposalV2 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== 2) return null;
  if (candidate.kind !== "action" && candidate.kind !== "inquiry" && candidate.kind !== "speech" && candidate.kind !== "mixed" && candidate.kind !== "meta") return null;
  if (!hasOnlyKeys(candidate, ["schemaVersion", "kind", "primaryIntent", "supportingClauses", "addressedEntity", "target", "goal", "manner", "question", "referents", "ambiguity"])) return null;
  if (!("primaryIntent" in candidate) || !("supportingClauses" in candidate) || !("referents" in candidate)) return null;
  const primaryIntent = parsePrimary(candidate.primaryIntent);
  if (primaryIntent === undefined) return null;
  if (!Array.isArray(candidate.supportingClauses) || candidate.supportingClauses.length > TURN_MAX_SUPPORTING) return null;
  const supportingClauses: SupportingClause[] = [];
  for (const entry of candidate.supportingClauses) {
    const clause = parseSupportingClause(entry);
    if (!clause) return null;
    supportingClauses.push(clause);
  }
  const referents = parseReferentList(candidate.referents, TURN_MAX_REFERENTS);
  if (!referents) return null;
  if (candidate.addressedEntity !== undefined) {
    if (!parseReferent(candidate.addressedEntity)) return null;
  }
  if (candidate.target !== undefined) {
    if (!parseReferent(candidate.target)) return null;
  }
  if (candidate.goal !== undefined && !isCleanString(candidate.goal, TURN_MAX_STRING, false)) return null;
  if (candidate.manner !== undefined && !isCleanString(candidate.manner, TURN_MAX_STRING, false)) return null;
  if (candidate.question !== undefined) {
    if (!parseQuestion(candidate.question)) return null;
  }
  if (candidate.ambiguity !== undefined) {
    if (!parseAmbiguity(candidate.ambiguity)) return null;
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    kind: candidate.kind as TurnProposalKind,
    primaryIntent,
    supportingClauses: Object.freeze(supportingClauses),
    ...(candidate.addressedEntity !== undefined ? { addressedEntity: parseReferent(candidate.addressedEntity)! } : {}),
    ...(candidate.target !== undefined ? { target: parseReferent(candidate.target)! } : {}),
    ...(candidate.goal !== undefined ? { goal: candidate.goal as string } : {}),
    ...(candidate.manner !== undefined ? { manner: candidate.manner as string } : {}),
    ...(candidate.question !== undefined ? { question: parseQuestion(candidate.question)! } : {}),
    referents,
    ...(candidate.ambiguity !== undefined ? { ambiguity: parseAmbiguity(candidate.ambiguity)! } : {}),
  });
}

/** Guards the closed inquiry-query registry re-export used by V2 shapes. */
export function isTurnQueryId(value: unknown): value is (typeof INQUIRY_QUERY_IDS)[number] {
  return isInquiryQueryId(value);
}
