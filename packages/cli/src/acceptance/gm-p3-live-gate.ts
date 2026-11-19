import type { DomainEvent } from "@skald/event-bus";
import { parseGmProposal } from "@skald/intent-parser";
import {
  ANSWER_GAP_STATEMENT, buildAnswerPlan, verifyAllowedNarration,
  type AllowedNarrativeFacts, type QuestionReadingRound, type QuestionRoundSpec,
} from "@skald/world";

/** Sanitized evidence required before a live P3 acceptance can pass. */
export interface P3LiveModelEvidence {
  readonly generationRequests: number;
  readonly successfulGenerationResponses: number;
  readonly successfulNarrationResponses: number;
  readonly acceptedDirectorDecisions: number;
}

/** Sanitized facts needed to prove one real, read-only Director-backed NPC greeting. */
export interface P3ModelBackedTurnProbeEvidence {
  readonly scratchWorldHttpStatus: number | null;
  readonly scratchServerBaseUrl: string | null;
  readonly commandRequests: number;
  readonly commandHttpStatus: number | null;
  readonly interpretCalls: number;
  readonly interpretCategoryCalls: number;
  readonly commandInterpretCalls: number | null;
  readonly generationRequests: number;
  readonly successfulGenerationResponses: number;
  readonly directorDecisionAccepted: boolean;
  readonly directorOutcome: string | null;
  readonly directorDecisionKind: string | null;
  readonly directorAddresseeKind: string | null;
  readonly directorProvider: string | null;
  readonly directorModel: string | null;
  readonly expectedProvider: string;
  readonly expectedModel: string;
  readonly scenarioId: string | null;
  readonly playerInput: string | null;
  readonly responseKind: string | null;
  readonly responseText: string | null;
  readonly hasInternalLeak: boolean | null;
  readonly worldTimeBefore: number | null;
  readonly worldTimeAfter: number | null;
  readonly eventDelta: number | null;
  readonly budgetBlocks: number;
  readonly reservationViolations: number;
  readonly reportedCostUsd: number;
  readonly reservedCostUsd: number;
}

/**
 * Require a real model-backed NPC greeting over scratch HTTP and prove that
 * the read-only request did not append Events or advance world time.
 */
export function evaluateP3ModelBackedTurnProbe(evidence: P3ModelBackedTurnProbeEvidence): Readonly<Record<string, boolean>> {
  let scratchServerLoopback = false;
  try {
    const serverUrl = evidence.scratchServerBaseUrl ? new URL(evidence.scratchServerBaseUrl) : undefined;
    scratchServerLoopback = serverUrl?.protocol === "http:" && serverUrl.hostname === "127.0.0.1";
  } catch { /* malformed runner URL fails closed */ }
  return Object.freeze({
    scratchWorldCreatedThroughHttp: evidence.scratchWorldHttpStatus === 201,
    scratchServerLoopback,
    oneCommandRequest: evidence.commandRequests === 1 && evidence.commandHttpStatus === 200,
    oneDirectorInterpretCall: evidence.interpretCalls === 1
      && evidence.interpretCategoryCalls === 1 && evidence.commandInterpretCalls === 1,
    oneActualModelGeneration: evidence.generationRequests === 1 && evidence.successfulGenerationResponses === 1,
    decisionAccepted: evidence.directorDecisionAccepted
      && evidence.directorOutcome === "accepted"
      && evidence.directorDecisionKind === "conversation"
      && evidence.directorAddresseeKind === "npc"
      && evidence.directorProvider === evidence.expectedProvider
      && evidence.directorModel === evidence.expectedModel,
    acceptedReadOnlyNpcSpeech: evidence.scenarioId === "npc-greeting"
      && evidence.playerInput === "Привет, смотритель"
      && evidence.responseKind === "speech_reaction"
      && /смотрител[а-яё]* речных ворот/iu.test(evidence.responseText ?? ""),
    responsePresented: typeof evidence.responseText === "string" && evidence.responseText.trim().length > 0,
    noInternalIdentifierLeak: evidence.hasInternalLeak === false,
    noWorldMutation: evidence.eventDelta === 0
      && evidence.worldTimeBefore === 0 && evidence.worldTimeAfter === 0,
    noExtraGenerationOrBudgetBlock: evidence.generationRequests === 1 && evidence.budgetBlocks === 0,
    spendWithinReservation: evidence.reservationViolations === 0
      && Number.isFinite(evidence.reportedCostUsd) && evidence.reportedCostUsd >= 0
      && Number.isFinite(evidence.reservedCostUsd) && evidence.reservedCostUsd >= 0
      && evidence.reportedCostUsd <= evidence.reservedCostUsd + 1e-8,
  });
}

/** Only an explicit per-run operator opt-in may enable a paid primary model. */
export function p3PaidPrimaryPermissionFlag(operatorOptIn: string | undefined): "1" | "0" {
  return operatorOptIn === "1" ? "1" : "0";
}

/** This fixture asks to examine the place itself, not a nearby person or item. */
export const P3_RUINS_INSPECTION_REPLICA = "Я внимательно осматриваю древние развалины и пытаюсь понять, что здесь произошло";
export const P3_RUINS_LOCATION = "old_ruins";

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Compare the actual staged perception chain, not a generic ActionResolved event. */
export function verifyP3RuinsPerception(
  beforeLocation: string | null,
  afterLocation: string | null,
  beforeTime: number,
  afterTime: number,
  authoredDescription: string,
  events: readonly DomainEvent[],
): boolean {
  if (beforeLocation !== P3_RUINS_LOCATION || afterLocation !== P3_RUINS_LOCATION
    || afterTime !== beforeTime + 1 || authoredDescription.trim() === ""
    || events.filter((event) => event.type === "TickPassed").length !== 1) return false;
  const target = events.filter((event) => {
    const payload = plainRecord(event.payload);
    return event.type === "TargetResolved" && payload?.environment === true
      && payload.locationId === P3_RUINS_LOCATION && payload.verb === "observe" && payload.entityId === undefined;
  });
  const validation = events.filter((event) => {
    const payload = plainRecord(event.payload);
    return event.type === "InteractionValidated" && payload?.law === "perception"
      && payload.locationId === P3_RUINS_LOCATION && payload.verb === "observe" && payload.entityId === undefined
      && event.causationId === target[0]?.eventId && event.correlationId === target[0]?.correlationId;
  });
  const results = events.filter((event) => {
    const payload = plainRecord(event.payload);
    return event.type === "ActionResolved" && payload?.result === "observation"
      && payload.description === authoredDescription && payload.actionEventId === validation[0]?.eventId
      && event.causationId === validation[0]?.eventId && event.correlationId === validation[0]?.correlationId;
  });
  return target.length === 1 && validation.length === 1 && results.length === 1
    && !events.some((event) => event.type === "ActionRejected" || event.type === "ActionBlocked");
}

/** Parse only the shape needed to independently re-read the authored place after execution. */
export function readP3RuinsQuestionSpec(
  decision: unknown,
  locationLabel: string,
  interpretationRevision: QuestionRoundSpec["interpretationRevision"],
): QuestionRoundSpec | null {
  const raw = plainRecord(decision);
  if (raw?.kind !== "mixed") return null;
  const proposal = parseGmProposal(raw.proposal);
  if (proposal?.kind !== "mixed" || proposal.primaryIntent?.kind !== "interaction"
    || proposal.primaryIntent.verb !== "observe" || proposal.target || proposal.addressedEntity
    || proposal.ambiguity || proposal.questionPlan?.subjects.length !== 1
    || proposal.questionPlan.parts.length !== 1 || proposal.readings?.length !== 1) return null;
  const [subject] = proposal.questionPlan.subjects;
  const [part] = proposal.questionPlan.parts;
  const [reading] = proposal.readings;
  if (!subject || !part || !reading) return null;
  const normalize = (value: string) => value.toLowerCase().replace(/ё/gu, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ").trim();
  const surface = normalize(subject.surface);
  const currentPlace = ["здесь", "тут", "сюда", "здесь же", "тут же", "в этом месте", "на этом месте"];
  if (subject.kind !== "place" || subject.observerRef !== undefined
    || (!currentPlace.includes(surface) && (surface === "" || surface !== normalize(locationLabel)))
    || part.subjectRefs.length !== 1 || part.subjectRefs[0] !== subject.id || part.aspect !== "known_event"
    || part.time !== "past" || part.purpose !== "explain"
    || reading.partId !== part.id || reading.source !== "known_events") return null;
  return {
    interpretationRevision,
    readings: [reading],
    questionPlan: { subjects: [{ subject, resolution: "resolved", resolvedRef: null }], parts: [part], actionIntent: null },
  };
}

/**
 * Compare the public result to a deterministic post-action re-read, omitting
 * internal fact IDs. Return the actual answer obligations or fail closed.
 */
export function verifyP3RuinsQuestionReading(expected: QuestionReadingRound | null, actual: unknown): readonly string[] | null {
  const dto = plainRecord(actual);
  const revision = plainRecord(dto?.revision);
  if (!expected || !revision || revision.worldTime !== expected.revision.worldTime
    || revision.eventNumber !== expected.revision.eventNumber
    || !Array.isArray(dto?.results) || dto.results.length !== 1 || expected.results.length !== 1
    || JSON.stringify(dto.coveredParts) !== JSON.stringify(expected.coveredParts)) return null;
  const result = expected.results[0]!;
  const actualResult = plainRecord(dto.results[0]);
  const actualRequest = plainRecord(actualResult?.request);
  if (!actualResult || actualRequest?.partId !== result.request.partId || actualRequest.source !== "known_events"
    || actualResult.status !== result.status || !Array.isArray(actualResult.facts) || !Array.isArray(actualResult.gaps)
    || actualResult.facts.length !== result.facts.length || actualResult.gaps.length !== result.gaps.length) return null;
  const part = expected.questionPlan.parts[0];
  const subject = expected.questionPlan.subjects[0]?.subject;
  if (!part || !subject || part.aspect !== "known_event" || result.request.partId !== part.id || result.request.source !== "known_events") return null;
  if (result.status === "available") {
    if (result.facts.length === 0 || result.gaps.length !== 0 || !expected.coveredParts.includes(part.id)) return null;
  } else if (result.status === "no_data") {
    if (result.facts.length !== 0 || result.gaps.length !== 1 || expected.coveredParts.length !== 0) return null;
    const gap = result.gaps[0]!;
    // With no narrative source the adapter reports a part-level gap. This
    // spec has exactly one verified place subject, so it cannot refer elsewhere.
    if (gap.status !== "no_data" || gap.aspect !== "known_event" || gap.partId !== part.id
      || (gap.subjectId !== undefined && gap.subjectId !== subject.id)) return null;
  } else return null;
  for (const [index, fact] of result.facts.entries()) {
    const shown = plainRecord(actualResult.facts[index]);
    if (!shown || typeof shown.factId !== "string" || !/^fact-\d+$/u.test(shown.factId)
      || fact.subjectId !== subject.id || shown.subjectId !== fact.subjectId
      || shown.text !== fact.text || shown.epistemicClass !== fact.epistemicClass || shown.source !== "known_events"
      || shown.temporal !== fact.temporal || shown.usableNow !== fact.usableNow
      || JSON.stringify(shown.aspects) !== JSON.stringify(fact.aspects)) return null;
  }
  for (const [index, gap] of result.gaps.entries()) {
    const shown = plainRecord(actualResult.gaps[index]);
    if (!shown || shown.partId !== gap.partId || shown.subjectId !== gap.subjectId
      || shown.status !== gap.status || shown.surface !== gap.surface || shown.aspect !== gap.aspect) return null;
  }
  const answer = buildAnswerPlan({ readings: expected });
  return answer.statements.length > 0 && answer.narrowClarification === null ? answer.statements : null;
}

/** One published narration must carry both the authoritative action and history answer. */
export function verifyP3RuinsNarration(
  actionText: string | null,
  questionStatements: readonly string[] | null,
  allowed: AllowedNarrativeFacts | null,
  generationText: string | null,
  shown: P3PlayerVisibleResponse,
  pinnedSameTurnSuccess: boolean,
): boolean {
  if (!actionText || !questionStatements?.length || !allowed || !generationText || !pinnedSameTurnSuccess
    || allowed.question !== P3_RUINS_INSPECTION_REPLICA || !allowed.coverageComplete
    || shown.narrationState !== "ready" || !shown.narrationText
    || shown.visibleText !== shown.narrationText) return false;
  const compact = (value: string) => value.trim().replace(/\s+/gu, " ");
  const normalizedDeterministic = compact(shown.deterministicText);
  for (const raw of [actionText, ...questionStatements]) {
    const required = compact(raw);
    if (!required || !normalizedDeterministic.includes(required) || !allowed.mandatory.includes(required)
      || !allowed.facts.some((fact) => fact.available && fact.content === required)) return false;
  }
  if (questionStatements.includes(ANSWER_GAP_STATEMENT) && !compact(shown.visibleText).includes(ANSWER_GAP_STATEMENT)) return false;
  const verified = verifyAllowedNarration(generationText, allowed, { exactFacts: true });
  return verified.ok && verified.narration === shown.visibleText;
}

/** The response text and source that the current chat renderer would display. */
export interface P3PlayerVisibleResponse {
  readonly deterministicText: string;
  readonly deterministicSource: "conversationTurn" | "presentation.response" | "presentation.primary" | "none";
  readonly narrationText: string | null;
  readonly narrationState: "pending" | "ready" | "unavailable" | "not_requested" | null;
  readonly visibleText: string;
}

/**
 * Extracts the player-visible wording using the same precedence as
 * chat-feed-view.js: a persisted conversation response wins over the
 * presentation response, and a successful non-fallback narration replaces
 * that deterministic wording. masterTurn.deterministicText is deliberately
 * not a display source; accepting it can make an API test pass on text the UI
 * never renders.
 */
export function extractP3PlayerVisibleResponse(value: unknown): Readonly<P3PlayerVisibleResponse> {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const conversationTurn = body.conversationTurn && typeof body.conversationTurn === "object"
    && !Array.isArray(body.conversationTurn) ? body.conversationTurn as Record<string, unknown> : undefined;
  const presentation = body.presentation && typeof body.presentation === "object"
    && !Array.isArray(body.presentation) ? body.presentation as Record<string, unknown> : undefined;
  const presentationResponse = presentation?.response && typeof presentation.response === "object"
    && !Array.isArray(presentation.response) ? presentation.response as Record<string, unknown> : undefined;
  const presentationPrimary = presentation?.primary && typeof presentation.primary === "object"
    && !Array.isArray(presentation.primary) ? presentation.primary as Record<string, unknown> : undefined;
  const nonEmpty = (candidate: unknown): candidate is string => typeof candidate === "string" && candidate.trim().length > 0;

  let deterministicText = "";
  let deterministicSource: P3PlayerVisibleResponse["deterministicSource"] = "none";
  if (nonEmpty(conversationTurn?.responseText)) {
    deterministicText = conversationTurn.responseText;
    deterministicSource = "conversationTurn";
  } else if (!conversationTurn && nonEmpty(presentationResponse?.text)) {
    deterministicText = presentationResponse.text;
    deterministicSource = "presentation.response";
  } else if (nonEmpty(presentationPrimary?.text)) {
    deterministicText = presentationPrimary.text;
    deterministicSource = "presentation.primary";
  }

  const journalTurn = body.journalTurn && typeof body.journalTurn === "object" && !Array.isArray(body.journalTurn)
    ? body.journalTurn as Record<string, unknown> : undefined;
  const masterTurn = body.masterTurn && typeof body.masterTurn === "object" && !Array.isArray(body.masterTurn)
    ? body.masterTurn as Record<string, unknown> : undefined;
  const masterNarration = masterTurn?.narration && typeof masterTurn.narration === "object" && !Array.isArray(masterTurn.narration)
    ? masterTurn.narration as Record<string, unknown> : undefined;
  const conversationInputClass = conversationTurn?.inputClass;
  const conversationCanPair = conversationInputClass === "action"
    || conversationInputClass === "mixed" || conversationInputClass === "speech";
  const sameNarrationHandle = typeof conversationTurn?.narrationHandle === "string"
    && conversationTurn.narrationHandle.length > 0
    && conversationTurn.narrationHandle === journalTurn?.narrationHandle;
  const sameCorrelationAndTime = typeof conversationTurn?.correlationId === "string"
    && conversationTurn.correlationId.length > 0
    && conversationTurn.correlationId === journalTurn?.correlationId
    && conversationTurn.worldTimeAfter === journalTurn?.worldTime;
  const hasDisplayableJournalTurn = Boolean(journalTurn && (!conversationTurn
    || (conversationCanPair && (sameNarrationHandle || sameCorrelationAndTime))));
  const displayableJournalTurn = hasDisplayableJournalTurn ? journalTurn : undefined;
  const rawNarrationState = displayableJournalTurn?.narrationState
    ?? conversationTurn?.narrationState
    ?? masterNarration?.status;
  const narrationState = rawNarrationState === "pending" || rawNarrationState === "ready"
    || rawNarrationState === "unavailable" || rawNarrationState === "not_requested"
    ? rawNarrationState : null;
  const narration = displayableJournalTurn?.narrativeLLM;
  const narrationRecord = narration && typeof narration === "object" && !Array.isArray(narration)
    ? narration as Record<string, unknown> : undefined;
  const narrationText = narrationRecord?.usedFallback !== true && nonEmpty(narrationRecord?.text)
    ? narrationRecord.text : null;

  return Object.freeze({
    deterministicText,
    deterministicSource,
    narrationText,
    narrationState,
    visibleText: narrationText ?? deterministicText,
  });
}

export interface P3LiveRunnerFailureSummary {
  readonly kind: "http_error" | "sqlite_error" | "network_error" | "syntax_error" | "type_error" | "unknown_error";
  readonly name?: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly phase?: string;
  readonly providerCode?: string;
  readonly retryable?: boolean;
}

/**
 * Summarize runner exceptions without retaining model output, prompts, paths,
 * environment values, response bodies or raw exception messages.
 */
export function summarizeP3LiveRunnerFailure(error: unknown): Readonly<P3LiveRunnerFailureSummary> {
  const value = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const name = typeof value["name"] === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value["name"])
    ? value["name"] : undefined;
  const code = typeof value["code"] === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value["code"])
    ? value["code"] : undefined;
  const httpStatus = typeof value["httpStatus"] === "number" && Number.isSafeInteger(value["httpStatus"])
    && value["httpStatus"] >= 100 && value["httpStatus"] <= 599 ? value["httpStatus"] : undefined;
  const phase = typeof value["phase"] === "string"
    && /^(?:configuration|transport|response_status|response_decode|response_shape|schema_validation|model_selection|request|session_cleanup)$/u.test(value["phase"])
    ? value["phase"] : undefined;
  const providerCode = typeof value["providerCode"] === "string"
    && /^[A-Za-z0-9_.:-]{1,80}$/u.test(value["providerCode"]) ? value["providerCode"] : undefined;
  const retryable = typeof value["retryable"] === "boolean" ? value["retryable"] : undefined;
  const kind: P3LiveRunnerFailureSummary["kind"] = httpStatus !== undefined ? "http_error"
    : code?.startsWith("SQLITE_") || code?.startsWith("ERR_SQLITE_") ? "sqlite_error"
      : code !== undefined && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
        ? "network_error"
        : name === "SyntaxError" ? "syntax_error"
          : name === "TypeError" ? "type_error" : "unknown_error";
  return Object.freeze({
    kind,
    ...(name ? { name } : {}),
    ...(code ? { code } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(phase ? { phase } : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
  });
}

/** Fail closed unless OpenCode generated both a Director decision and narration. */
export function evaluateP3LiveModelGate(evidence: P3LiveModelEvidence): Readonly<{
  modelGenerationAttempted: boolean;
  modelGenerationSucceeded: boolean;
  narrationGenerated: boolean;
  directorDecisionAccepted: boolean;
}> {
  const isPositiveCount = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
  return Object.freeze({
    modelGenerationAttempted: isPositiveCount(evidence.generationRequests),
    modelGenerationSucceeded: isPositiveCount(evidence.successfulGenerationResponses),
    narrationGenerated: isPositiveCount(evidence.successfulNarrationResponses),
    directorDecisionAccepted: isPositiveCount(evidence.acceptedDirectorDecisions),
  });
}

