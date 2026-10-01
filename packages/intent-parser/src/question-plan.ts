/**
 * Semantic question plan contract (semantic-question-plan T1; ADR-0028 and
 * ADR-0037 amendments 2026-09-27).
 *
 * A free question no longer has to match one registered `queryId` wholesale.
 * The interpretation contract gains a read-side part: the replica is split
 * into bounded `QuestionPart`s over declared subjects with a closed aspect
 * set, and missing data is requested through a closed reading catalog in ONE
 * bounded round. This module defines the untrusted shapes parsed from
 * `TurnProposalV2`, the server-side validated `QuestionPlan`, and the pure
 * parsers. Contextual subject resolution against scene/focus/conversation
 * (and the construction of `QuestionPlan.actionIntent`) belongs to the
 * Master Turn Gateway — this module never reads the world.
 *
 * Invariants:
 * - closed registries only; no free-form aspect, source or status;
 * - limits are part of the contract: at most QUESTION_PLAN_MAX_PARTS parts,
 *   at most READING_MAX_REQUESTS readings in READING_ROUND_LIMIT rounds;
 * - hidden data must be indistinguishable from ordinary absence: a denied
 *   read surfaces as `no_data`, never as a reason that reveals a secret;
 * - temporal membership, provenance and availability are independent
 *   (ADR-0037 amendment): historical data is `available` with past time.
 */

import type { ExecutableIntent } from "./intent-proposal.js";
import { OBSERVER_REF_PATTERN, TURN_MAX_REFERENTS, TURN_MAX_STRING } from "./turn-proposal.js";

/**
 * Local copy of the proposal string guard: `isCleanString` in
 * turn-proposal.ts is module-private, and a local helper keeps the public
 * surface unchanged. Same rule: bounded length, no C0 control characters.
 */
function isCleanString(value: unknown, max: number, allowEmpty: boolean): value is string {
  if (typeof value !== "string") return false;
  if (!allowEmpty && value.length === 0) return false;
  if (value.length > max) return false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) return false;
  }
  return true;
}

/**
 * Closed semantic aspects — the only ways a question may ask to read data.
 * The set limits how data is READ, never how the player may phrase a
 * question (one aspect covers unlimited rephrasings).
 */
export const QUESTION_ASPECTS = [
  "identity_role",
  "appearance",
  "current_activity",
  "observed_reaction",
  "acquaintance_link",
  "background_arrival",
  "known_event",
  "item_properties",
  "conversation_topic",
  "continuation_way",
] as const;

/** One of the closed semantic question aspects. */
export type QuestionAspect = (typeof QUESTION_ASPECTS)[number];

/** Closed time scope of a question part; cause and time are separate axes. */
export const QUESTION_TIME_SCOPES = ["current", "past", "unspecified"] as const;

/** One of the closed time scopes. */
export type QuestionTimeScope = (typeof QUESTION_TIME_SCOPES)[number];

/** Closed purpose of a question part: what the answer must do with the data. */
export const QUESTION_PURPOSES = ["describe", "explain", "recall"] as const;

/** One of the closed question purposes. */
export type QuestionPurpose = (typeof QUESTION_PURPOSES)[number];

/** Closed subject kinds: how a question part points at its subject. */
export const QUESTION_SUBJECT_KINDS = ["entity", "group", "ordinal", "topic", "place", "self"] as const;

/** One of the closed subject kinds. */
export type QuestionSubjectKind = (typeof QUESTION_SUBJECT_KINDS)[number];

/**
 * Closed vocabulary of shown-list identities an `ordinal` subject may
 * reference (semantic-question-plan T5). Each entry names a list the master
 * actually showed in a previous answer and that conversation memory
 * recorded; the server resolves the position against THAT stored list by
 * identity, never against a freshly derived scene order, so the meaning
 * survives reload and scene re-ordering.
 */
export const QUESTION_LIST_REFS = ["scene_people"] as const;

/** One of the closed shown-list identities. */
export type QuestionListRef = (typeof QUESTION_LIST_REFS)[number];

/** Maximum question parts per replica (plan section 5 limit). */
export const QUESTION_PLAN_MAX_PARTS = 4;

/** Maximum reading requests in one round (plan section 5 limit). */
export const READING_MAX_REQUESTS = 3;

/**
 * Reading rounds per replica (plan section 5 limit). Exhausting the round
 * never loops: the answer is built from obtained data with an explicit gap.
 */
export const READING_ROUND_LIMIT = 1;

/**
 * Closed reading catalog (plan section 4). Each source is an adapter over
 * an existing observer-safe read-side builder; the model never chooses a
 * world, observer, event range or table.
 */
export const READING_SOURCES = [
  "scene",
  "person",
  "background_arrival",
  "known_events",
  "relations",
  "items",
  "conversation_topics",
] as const;

/** One of the closed reading sources. */
export type ReadingSource = (typeof READING_SOURCES)[number];

/**
 * Closed reading outcomes (plan section 4 distinctions):
 * - `available`: subject understood, data exists (historical data stays
 *   here with past temporal membership — time is orthogonal);
 * - `no_data`: subject understood, nothing available — INCLUDING reads
 *   denied by authority, which must look like ordinary absence;
 * - `ambiguous_subject`: the link between the question and a subject is
 *   not settled;
 * - `failed`: the read itself could not be performed.
 */
export const READING_RESULT_STATUSES = ["available", "no_data", "ambiguous_subject", "failed"] as const;

/** One of the closed reading outcomes. */
export type ReadingResultStatus = (typeof READING_RESULT_STATUSES)[number];

/**
 * Machine identifier of a subject or part inside one plan. Closed shape:
 * lowercase ASCII, no spaces — never world data, never an entity id.
 */
export const QUESTION_REF_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** One declared subject of a question ("кто/о ком/о чём"). */
export interface QuestionSubject {
  /** Plan-local identifier referenced by `QuestionPart.subjectRefs`. */
  readonly id: string;
  /** Surface form the replica used (player text, never an internal id). */
  readonly surface: string;
  readonly kind: QuestionSubjectKind;
  /** `entity`/`topic`/`place`: transient scene handle when the replica names one. */
  readonly observerRef?: string;
  /** `group`: transient handles of the members the group links to (never just a label). */
  readonly members?: readonly string[];
  /** `ordinal`: identity of the list the master showed, from {@link QUESTION_LIST_REFS}. */
  readonly listRef?: QuestionListRef;
  /** `ordinal`: 1-based position in that exact list; survives reload by identity, not by scene order. */
  readonly position?: number;
}

/** One bounded part of a question: subject(s) + aspect + time + purpose. */
export interface QuestionPart {
  /** Plan-local identifier referenced by `ReadingRequest.partId`. */
  readonly id: string;
  /** Declared subject ids this part reads (at least one). */
  readonly subjectRefs: readonly string[];
  readonly aspect: QuestionAspect;
  readonly time: QuestionTimeScope;
  readonly purpose: QuestionPurpose;
}

/** Untrusted model-declared read-side part of a TurnProposalV2. */
export interface ProposedQuestionPlan {
  readonly subjects: readonly QuestionSubject[];
  readonly parts: readonly QuestionPart[];
}

/** How a declared subject resolved against the current conversation context. */
export type SubjectResolution = "resolved" | "ambiguous" | "absent";

/**
 * Server-side binding of one declared subject: the declaration plus its
 * contextual resolution. Built by the gateway; never model output.
 */
export interface SubjectBinding {
  readonly subject: QuestionSubject;
  readonly resolution: SubjectResolution;
  /** Confirmed transient handle for this scene, or null when not settled. */
  readonly resolvedRef: string | null;
  /**
   * `group`: per-member transient handles actually resolvable right now —
   * the model-declared handles re-checked against the scene, or the
   * remembered member links of a previously shown group. A gone member is
   * null, never guessed. Absent for non-group subjects.
   */
  readonly resolvedMembers?: readonly (string | null)[] | undefined;
}

/**
 * Validated server-side question plan for one replica. `actionIntent`
 * mirrors the validated primary action (`ValidatedMasterTurnPlan.execution`)
 * and is built together with it so the two cannot disagree; a read-only
 * question carries null. Naming follows `ExecutableIntent`, the action type
 * the existing validator produces.
 */
export interface QuestionPlan {
  readonly subjects: readonly SubjectBinding[];
  readonly parts: readonly QuestionPart[];
  readonly actionIntent: ExecutableIntent | null;
}

/** One model-proposed reading from the closed catalog, tied to one part. */
export interface ReadingRequest {
  readonly partId: string;
  readonly source: ReadingSource;
}

function isRefId(value: unknown): value is string {
  return typeof value === "string" && QUESTION_REF_ID_PATTERN.test(value);
}

function isClosedSet<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function hasOnlySubjectKeys(candidate: Record<string, unknown>): boolean {
  const known = ["id", "surface", "kind", "observerRef", "members", "listRef", "position"];
  return Object.keys(candidate).every((key) => known.includes(key));
}

function hasOnlyPartKeys(candidate: Record<string, unknown>): boolean {
  const known = ["id", "subjectRefs", "aspect", "time", "purpose"];
  return Object.keys(candidate).every((key) => known.includes(key));
}

function parseSubject(raw: unknown): QuestionSubject | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (!hasOnlySubjectKeys(candidate)) return null;
  if (!isRefId(candidate.id)) return null;
  if (!isCleanString(candidate.surface, TURN_MAX_STRING, false)) return null;
  if (!isClosedSet(candidate.kind, QUESTION_SUBJECT_KINDS)) return null;
  const kind = candidate.kind as QuestionSubjectKind;
  const refAllowed = kind === "entity" || kind === "topic" || kind === "place";
  if (candidate.observerRef !== undefined) {
    if (!refAllowed) return null;
    if (!(typeof candidate.observerRef === "string" && OBSERVER_REF_PATTERN.test(candidate.observerRef))) return null;
  }
  if (candidate.members !== undefined) {
    if (kind !== "group") return null;
    if (!Array.isArray(candidate.members)
      || candidate.members.length === 0
      || candidate.members.length > TURN_MAX_REFERENTS) return null;
    if (candidate.members.some((member) => !(typeof member === "string" && OBSERVER_REF_PATTERN.test(member)))) return null;
  }
  if (kind === "group" && !Array.isArray(candidate.members)) return null;
  const ordinalField = candidate.listRef !== undefined || candidate.position !== undefined;
  if (ordinalField) {
    if (kind !== "ordinal") return null;
    if (!isClosedSet(candidate.listRef, QUESTION_LIST_REFS)) return null;
    if (!Number.isInteger(candidate.position) || (candidate.position as number) < 1) return null;
  }
  if (kind === "ordinal" && !ordinalField) return null;
  if (kind === "self" && (candidate.observerRef !== undefined || candidate.members !== undefined
    || ordinalField)) return null;
  return Object.freeze({
    id: candidate.id as string,
    surface: candidate.surface as string,
    kind,
    ...(candidate.observerRef !== undefined ? { observerRef: candidate.observerRef as string } : {}),
    ...(candidate.members !== undefined ? { members: Object.freeze([...(candidate.members as string[])]) } : {}),
    ...(candidate.listRef !== undefined ? { listRef: candidate.listRef as QuestionListRef } : {}),
    ...(candidate.position !== undefined ? { position: candidate.position as number } : {}),
  });
}

function parsePart(raw: unknown, subjectIds: ReadonlySet<string>): QuestionPart | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (!hasOnlyPartKeys(candidate)) return null;
  if (!isRefId(candidate.id)) return null;
  if (!isClosedSet(candidate.aspect, QUESTION_ASPECTS)) return null;
  if (!isClosedSet(candidate.time, QUESTION_TIME_SCOPES)) return null;
  if (!isClosedSet(candidate.purpose, QUESTION_PURPOSES)) return null;
  if (!Array.isArray(candidate.subjectRefs) || candidate.subjectRefs.length === 0) return null;
  if (candidate.subjectRefs.some((ref) => !isRefId(ref) || !subjectIds.has(ref as string))) return null;
  return Object.freeze({
    id: candidate.id as string,
    subjectRefs: Object.freeze([...(candidate.subjectRefs as string[])]),
    aspect: candidate.aspect as QuestionAspect,
    time: candidate.time as QuestionTimeScope,
    purpose: candidate.purpose as QuestionPurpose,
  });
}

/**
 * Parses untrusted JSON into a frozen ProposedQuestionPlan. Returns null
 * for any shape violation: unknown keys, ids outside the closed ref shape,
 * unknown aspects/times/purposes/kinds, per-kind subject requirements,
 * part/subject cross-reference breaks or limit overflow.
 */
export function parseProposedQuestionPlan(raw: unknown): ProposedQuestionPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== "subjects" && key !== "parts")) return null;
  if (!Array.isArray(candidate.subjects) || candidate.subjects.length === 0) return null;
  if (candidate.subjects.length > TURN_MAX_REFERENTS) return null;
  if (!Array.isArray(candidate.parts) || candidate.parts.length === 0) return null;
  if (candidate.parts.length > QUESTION_PLAN_MAX_PARTS) return null;
  const subjects: QuestionSubject[] = [];
  const subjectIds = new Set<string>();
  for (const entry of candidate.subjects) {
    const subject = parseSubject(entry);
    if (!subject) return null;
    if (subjectIds.has(subject.id)) return null;
    subjectIds.add(subject.id);
    subjects.push(subject);
  }
  const parts: QuestionPart[] = [];
  const partIds = new Set<string>();
  for (const entry of candidate.parts) {
    const part = parsePart(entry, subjectIds);
    if (!part) return null;
    if (partIds.has(part.id)) return null;
    partIds.add(part.id);
    parts.push(part);
  }
  return Object.freeze({
    subjects: Object.freeze(subjects),
    parts: Object.freeze(parts),
  });
}

/**
 * Sanitized structural summary of a model-declared question plan and its
 * readings (T6 R1/R2 diagnostics): counts and closed-vocabulary tokens
 * ONLY. Surfaces, ids, observer refs, member handles and any other free
 * text never leave this function, so the summary is safe for the
 * operational diagnostic log. It answers "model error vs over-strict
 * contract" per rule: a group without members, an ordinal without
 * listRef/position, an unknown aspect/source, limit overflow and dangling
 * part refs each point at the exact violated rule.
 */
export interface RejectedPlanSummary {
  readonly hasPlan: boolean;
  readonly subjectCount: number;
  readonly partCount: number;
  readonly readingCount: number;
  readonly subjectKinds: readonly string[];
  readonly aspects: readonly string[];
  readonly sources: readonly string[];
  readonly groupWithoutMembers: number;
  readonly ordinalWithoutList: number;
  readonly readingsDangling: number;
  readonly subjectsOverLimit: boolean;
  readonly partsOverLimit: boolean;
  readonly readingsOverLimit: boolean;
}

function closedToken(value: unknown, allowed: readonly string[]): string {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : "other";
}

export function summarizeRejectedPlan(planRaw: unknown, readingsRaw: unknown): RejectedPlanSummary {
  const empty: RejectedPlanSummary = {
    hasPlan: false, subjectCount: 0, partCount: 0, readingCount: 0,
    subjectKinds: Object.freeze([]), aspects: Object.freeze([]), sources: Object.freeze([]),
    groupWithoutMembers: 0, ordinalWithoutList: 0, readingsDangling: 0,
    subjectsOverLimit: false, partsOverLimit: false, readingsOverLimit: false,
  };
  if (!planRaw || typeof planRaw !== "object" || Array.isArray(planRaw)) return empty;
  const candidate = planRaw as Record<string, unknown>;
  const subjects = Array.isArray(candidate.subjects) ? candidate.subjects : [];
  const parts = Array.isArray(candidate.parts) ? candidate.parts : [];
  const readings = Array.isArray(readingsRaw) ? (readingsRaw as readonly unknown[]) : [];
  const kinds = new Set<string>();
  let groupWithoutMembers = 0;
  let ordinalWithoutList = 0;
  for (const entry of subjects) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) { kinds.add("other"); continue; }
    const subject = entry as Record<string, unknown>;
    const kind = closedToken(subject.kind, QUESTION_SUBJECT_KINDS);
    kinds.add(kind);
    if (kind === "group" && !Array.isArray(subject.members)) groupWithoutMembers += 1;
    if (kind === "ordinal" && (subject.listRef === undefined || subject.position === undefined)) ordinalWithoutList += 1;
  }
  const partIds = new Set<string>();
  const aspects = new Set<string>();
  for (const entry of parts) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) { aspects.add("other"); continue; }
    const part = entry as Record<string, unknown>;
    if (typeof part.id === "string") partIds.add(part.id);
    aspects.add(closedToken(part.aspect, QUESTION_ASPECTS));
  }
  const sources = new Set<string>();
  let readingsDangling = 0;
  for (const entry of readings) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) { sources.add("other"); continue; }
    const request = entry as Record<string, unknown>;
    sources.add(closedToken(request.source, READING_SOURCES));
    if (typeof request.partId !== "string" || !partIds.has(request.partId)) readingsDangling += 1;
  }
  return Object.freeze({
    hasPlan: true,
    subjectCount: subjects.length,
    partCount: parts.length,
    readingCount: readings.length,
    subjectKinds: Object.freeze([...kinds].sort()),
    aspects: Object.freeze([...aspects].sort()),
    sources: Object.freeze([...sources].sort()),
    groupWithoutMembers,
    ordinalWithoutList,
    readingsDangling,
    subjectsOverLimit: subjects.length > TURN_MAX_REFERENTS,
    partsOverLimit: parts.length > QUESTION_PLAN_MAX_PARTS,
    readingsOverLimit: readings.length > READING_MAX_REQUESTS,
  });
}

/**
 * Parses untrusted JSON into frozen reading requests for ONE plan:
 * closed sources, closed ids, part references that exist in the plan and
 * the READING_MAX_REQUESTS limit. Readings without a declared plan or with
 * unknown part ids are rejected — a reading always answers a part.
 */
export function parseReadingRequests(raw: unknown, plan: ProposedQuestionPlan): readonly ReadingRequest[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > READING_MAX_REQUESTS) return null;
  const partIds = new Set(plan.parts.map((part) => part.id));
  const requests: ReadingRequest[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const candidate = entry as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => key !== "partId" && key !== "source")) return null;
    if (!isRefId(candidate.partId) || !partIds.has(candidate.partId as string)) return null;
    if (!isClosedSet(candidate.source, READING_SOURCES)) return null;
    const key = candidate.partId + " " + candidate.source;
    if (seen.has(key)) return null;
    seen.add(key);
    requests.push(Object.freeze({ partId: candidate.partId as string, source: candidate.source as ReadingSource }));
  }
  return Object.freeze(requests);
}
