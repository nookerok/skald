/**
 * Interpretation corpus and evaluator (full-master Stage 1).
 *
 * A closed set of real Russian replicas with the class the master must land
 * on, used by the opt-in live runner to score a provider on VALID AND
 * CORRECTLY INTERPRETED plans — not on catalogue presence or JSON validity.
 * Pure: no world access, no network, no provider. `classifyOutcome` turns a
 * gateway outcome into an observation; `evaluateEntry` scores it.
 */

import type { MasterTurnGatewayOutcome } from "../runtime/master-turn-gateway.js";

/** Player-facing reply classes the corpus can expect. */
export type ReplyClass = "action" | "inquiry" | "speech" | "mixed" | "meta" | "clarification";

/** Executable primary kinds an entry may allow. */
export type PrimaryClass = "action" | "inquiry" | "speech" | "meta";

/** One corpus replica and its expectation. */
export interface CorpusEntry {
  readonly input: string;
  /** Acceptable reply classes; more than one when either is honest. */
  readonly expect: readonly ReplyClass[];
  /** Acceptable primary kinds, when the turn executes something. */
  readonly primary?: readonly PrimaryClass[];
  /** Expected inquiry query id, when the entry is an inquiry. */
  readonly queryId?: string;
  readonly note?: string;
}

/** Sanitized observation of one gateway outcome. */
export interface InterpretationObservation {
  readonly status: string;
  readonly kind: ReplyClass | "unsupported" | "unavailable";
  readonly primary: PrimaryClass | null;
  readonly queryId: string | null;
  readonly genericFallback: boolean;
}

/** Verdict for one corpus entry. */
export interface CorpusEvaluation {
  readonly input: string;
  readonly ok: boolean;
  readonly actual: ReplyClass | "unsupported" | "unavailable";
  readonly reason: string | null;
}

/** Aggregate corpus score. */
export interface CorpusScore {
  readonly total: number;
  readonly correct: number;
  readonly rate: number;
  readonly genericFallback: number;
  readonly failures: readonly CorpusEvaluation[];
}

function primaryOf(intent: { readonly type: string } | null | undefined): PrimaryClass | null {
  if (!intent) return null;
  if (intent.type === "InteractionCommand" || intent.type === "ActionIntentCommand" || intent.type === "JourneyIntent") return "action";
  return null;
}

/** Maps a gateway outcome onto a sanitized observation. Pure and total. */
export function classifyOutcome(outcome: MasterTurnGatewayOutcome): InterpretationObservation {
  switch (outcome.status) {
    case "deterministic":
      return { status: outcome.status, kind: "action", primary: "action", queryId: null, genericFallback: false };
    case "inquiry":
      return { status: outcome.status, kind: "inquiry", primary: "inquiry", queryId: outcome.inquiry.queryId, genericFallback: false };
    case "clarification":
      return {
        status: outcome.status,
        kind: "clarification",
        primary: null,
        queryId: null,
        genericFallback: isGeneric(outcome.question),
      };
    case "plan": {
      const plan = outcome.plan;
      const kind = plan.kind as ReplyClass;
      const primary: PrimaryClass | null = plan.execution
        ? primaryOf(plan.execution.intent as { type: string })
        : kind === "inquiry" ? "inquiry" : kind === "meta" ? "meta" : null;
      return { status: outcome.status, kind, primary, queryId: plan.postActionInquiries[0]?.queryId ?? null, genericFallback: false };
    }
    case "unsupported":
    case "unavailable":
      return { status: outcome.status, kind: outcome.status, primary: null, queryId: null, genericFallback: false };
  }
}

function isGeneric(question: string): boolean {
  const normalized = question.trim().toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ");
  return normalized.startsWith("я не уверен, что правильно понял");
}

/** Scores one observation against one entry. Pure and total. */
export function evaluateEntry(entry: CorpusEntry, observation: InterpretationObservation): CorpusEvaluation {
  const fail = (reason: string): CorpusEvaluation => ({ input: entry.input, ok: false, actual: observation.kind, reason });
  if (observation.genericFallback) return fail("generic_clarification");
  if (!entry.expect.includes(observation.kind as ReplyClass)) {
    return fail(`expected ${entry.expect.join("|")} got ${observation.kind}`);
  }
  if (entry.primary && observation.primary && !entry.primary.includes(observation.primary)) {
    return fail(`primary ${observation.primary} not in ${entry.primary.join("|")}`);
  }
  if (entry.queryId && observation.queryId && entry.queryId !== observation.queryId) {
    return fail(`query ${observation.queryId} != ${entry.queryId}`);
  }
  return { input: entry.input, ok: true, actual: observation.kind, reason: null };
}

/** Scores a whole corpus run. Pure and total. */
export function scoreCorpus(entries: readonly CorpusEntry[], observations: readonly InterpretationObservation[]): CorpusScore {
  const evaluations = entries.map((entry, index) => evaluateEntry(entry, observations[index] ?? { status: "error", kind: "unavailable", primary: null, queryId: null, genericFallback: false }));
  const correct = evaluations.filter((evaluation) => evaluation.ok).length;
  return {
    total: entries.length,
    correct,
    rate: entries.length === 0 ? 0 : correct / entries.length,
    genericFallback: observations.filter((observation) => observation.genericFallback).length,
    failures: evaluations.filter((evaluation) => !evaluation.ok),
  };
}

/**
 * The corpus. Every entry is a real player replica; expectations are the
 * honest classes, not a scripted command mapping. Entries with several
 * accepted classes are genuinely ambiguous.
 */
export const INTERPRETATION_CORPUS: readonly CorpusEntry[] = [
  // --- questions ---------------------------------------------------------
  { input: "где я?", expect: ["inquiry"], primary: ["inquiry"], queryId: "current_location" },
  { input: "что я вижу?", expect: ["inquiry"], primary: ["inquiry"], queryId: "visible_scene" },
  { input: "что вокруг меня?", expect: ["inquiry"], primary: ["inquiry"], queryId: "visible_scene" },
  { input: "что впереди?", expect: ["inquiry"], primary: ["inquiry"], queryId: "visible_scene" },
  { input: "что я слышу?", expect: ["inquiry"], primary: ["inquiry"], queryId: "auditory_scene" },
  { input: "какие звуки рядом?", expect: ["inquiry"], primary: ["inquiry"], queryId: "auditory_scene" },
  { input: "кто я?", expect: ["inquiry"], primary: ["inquiry"], queryId: "character_identity" },
  { input: "куда можно пойти?", expect: ["inquiry"], primary: ["inquiry"], queryId: "available_routes" },
  { input: "куда отсюда можно направиться?", expect: ["inquiry"], primary: ["inquiry"], queryId: "available_routes" },
  { input: "какие пути мне доступны?", expect: ["inquiry"], primary: ["inquiry"], queryId: "available_routes" },
  { input: "что произошло?", expect: ["inquiry"], primary: ["inquiry"], queryId: "recent_events" },
  { input: "что случилось?", expect: ["inquiry"], primary: ["inquiry"], queryId: "recent_events" },
  { input: "что у меня с собой?", expect: ["inquiry"], primary: ["inquiry"], queryId: "inventory" },
  { input: "что я несу?", expect: ["inquiry"], primary: ["inquiry"], queryId: "inventory" },
  { input: "с кем я знаком?", expect: ["inquiry"], primary: ["inquiry"], queryId: "known_contacts" },
  { input: "кого я знаю здесь?", expect: ["inquiry"], primary: ["inquiry"], queryId: "known_contacts" },
  { input: "кто рядом?", expect: ["inquiry"], primary: ["inquiry"], queryId: "who_is_nearby" },
  { input: "кто здесь?", expect: ["inquiry"], primary: ["inquiry"], queryId: "who_is_nearby" },
  { input: "есть ли кто-нибудь рядом?", expect: ["inquiry"], primary: ["inquiry"], queryId: "who_is_nearby" },
  { input: "что подсказывает вода?", expect: ["inquiry"], primary: ["inquiry"], queryId: "environmental_indication" },
  { input: "о чём говорит течение?", expect: ["inquiry"], primary: ["inquiry"], queryId: "environmental_indication" },
  { input: "почему карта показывает это место?", expect: ["inquiry"], primary: ["inquiry"], queryId: "map_position" },
  { input: "где на карте я?", expect: ["inquiry"], primary: ["inquiry"], queryId: "map_position" },
  { input: "что я знаю об этом месте", expect: ["inquiry"], primary: ["inquiry"], queryId: "known_place_knowledge" },
  { input: "хочу узнать, кто рядом", expect: ["inquiry"], primary: ["inquiry"], queryId: "who_is_nearby" },

  // --- simple actions ----------------------------------------------------
  { input: "осматриваюсь", expect: ["action"], primary: ["action"] },
  { input: "я осматриваюсь", expect: ["action"], primary: ["action"] },
  { input: "осмотреться", expect: ["action"], primary: ["action"] },
  { input: "прислушаться", expect: ["action"], primary: ["action"] },
  { input: "прислушаться к воде", expect: ["action"], primary: ["action"] },
  { input: "подхожу к ограде", expect: ["action"], primary: ["action"] },
  { input: "подойти к ограде", expect: ["action"], primary: ["action"] },
  { input: "подхожу к переправе", expect: ["action"], primary: ["action"] },
  { input: "осмотреть переправу", expect: ["action"], primary: ["action"] },
  { input: "осматриваю верхние камни", expect: ["action"], primary: ["action"] },
  { input: "осмотреть каменную кладку", expect: ["action"], primary: ["action"] },
  { input: "ждать", expect: ["action"], primary: ["action"] },
  { input: "иду к Речному Стражу", expect: ["action"], primary: ["action"] },
  { input: "идти по лесной дороге к Речному Стражу", expect: ["action"], primary: ["action"] },
  { input: "войти в город", expect: ["action"], primary: ["action"] },
  { input: "открыть дверь", expect: ["action"], primary: ["action"] },
  { input: "взять факел", expect: ["action"], primary: ["action"] },
  { input: "остановиться", expect: ["action"], primary: ["action"] },

  // --- speech to an NPC --------------------------------------------------
  { input: "обратиться к перевозчику", expect: ["speech"], primary: ["speech"] },
  { input: "заговорить с перевозчиком", expect: ["speech"], primary: ["speech"] },
  { input: "поздороваться", expect: ["speech", "clarification"], primary: ["speech"] },
  { input: "позвать перевозчика", expect: ["speech"], primary: ["speech"] },
  { input: "спросить перевозчика о реке", expect: ["speech", "mixed"], primary: ["speech"] },
  { input: "сказать перевозчику, что я видел знак", expect: ["speech"], primary: ["speech"] },
  { input: "окликнуть стража", expect: ["speech", "clarification"], primary: ["speech"] },

  // --- compound / mixed --------------------------------------------------
  { input: "осматриваю двор, что я вижу?", expect: ["mixed", "action"], primary: ["action"] },
  { input: "осматриваюсь и слушаю воду", expect: ["mixed", "action", "clarification"], primary: ["action"] },
  { input: "подхожу к ограде и осматриваю двор, что я вижу?", expect: ["mixed", "clarification"], primary: ["action"] },
  { input: "осмотреть переправу и спросить, куда идти", expect: ["mixed", "clarification"], primary: ["action"] },
  { input: "слушаю перевозчика, потом перехожу мост", expect: ["mixed", "clarification"], primary: ["action"] },
  { input: "сначала осмотрюсь, потом пойду дальше", expect: ["mixed", "clarification"], primary: ["action"] },
  { input: "осмотреться и что я слышу?", expect: ["mixed", "action"], primary: ["action"] },
  { input: "иду к реке и осматриваюсь", expect: ["mixed", "action", "clarification"], primary: ["action"] },

  // --- pronouns / continuations -----------------------------------------
  { input: "подхожу к нему", expect: ["action", "clarification"], primary: ["action"] },
  { input: "осмотрю её внимательнее", expect: ["action", "clarification"], primary: ["action"] },
  { input: "а что за ней?", expect: ["inquiry", "clarification"], primary: ["inquiry"] },
  { input: "спрошу об этом", expect: ["speech", "clarification"], primary: ["speech"] },
  { input: "продолжаю путь", expect: ["action", "clarification"], primary: ["action"] },
  { input: "иду дальше", expect: ["action", "clarification"], primary: ["action"] },
  { input: "двигаюсь к городу", expect: ["action", "clarification"], primary: ["action"] },
  { input: "вхожу в город", expect: ["action", "clarification"], primary: ["action"] },
  { input: "ищу безопасный проход дальше", expect: ["action", "clarification"], primary: ["action"] },
  { input: "не останавливаюсь", expect: ["action", "clarification"], primary: ["action"] },

  // --- topic changes / meta ---------------------------------------------
  { input: "а где здесь можно отдохнуть?", expect: ["inquiry", "clarification"], primary: ["inquiry"] },
  { input: "забудь прошлое, расскажи о реке", expect: ["speech", "inquiry", "clarification"] },
  { input: "что я умею?", expect: ["meta", "inquiry", "clarification"], primary: ["meta", "inquiry"] },
  { input: "какие действия доступны?", expect: ["meta", "clarification"], primary: ["meta"] },
  { input: "открой карту", expect: ["meta", "clarification"], primary: ["meta"] },
  { input: "повтори последний ответ", expect: ["meta", "clarification"], primary: ["meta"] },

  // --- colloquial / messy -----------------------------------------------
  { input: "ну и куда теперь?", expect: ["inquiry", "clarification"], primary: ["inquiry"] },
  { input: "чё тут вообще происходит?", expect: ["inquiry", "clarification"], primary: ["inquiry"] },
  { input: "а можно как-нибудь перебраться?", expect: ["inquiry", "clarification"], primary: ["inquiry"] },
  { input: "мне бы воды", expect: ["action", "clarification"], primary: ["action"] },
  { input: "стой, я передумал", expect: ["action", "clarification"], primary: ["action"] },
  { input: "иду-иду, не торопи", expect: ["action", "clarification"], primary: ["action"] },
  { input: "глянь, что там за поворотом", expect: ["action", "clarification"], primary: ["action"] },
  { input: "поболтаем?", expect: ["speech", "clarification"], primary: ["speech"] },

  // --- deliberately ambiguous / garbage ---------------------------------
  { input: "сделай что-нибудь полезное", expect: ["clarification"], note: "no concrete intent" },
  { input: "это", expect: ["clarification"], note: "no referent" },
  { input: "абракадабра", expect: ["clarification"], note: "garbage" },
  { input: "квк квк", expect: ["clarification"], note: "garbage" },
  { input: "и то и это одновременно", expect: ["clarification"], note: "conflicting" },
];
