import type { ActionIntentCommand, InteractionCommand, IntentOperation, InteractionVerb, JourneyIntent, ProposalValidation, TargetRequirement } from "./types.js";
import { targetRequirementForInteraction, targetRequirementForOperation } from "./deterministic-interpreter.js";
import {
  INTENT_CAPABILITIES,
  parseInquiryProposal,
  parseIntentProposal,
  type ExecutableIntent,
  type InquiryProposalValidation,
  type IntentProposalV1,
  type IntentProposalValidation,
} from "./intent-proposal.js";
import { isInquiryQueryId } from "./inquiry.js";

const INTERACTION_VERBS = new Set<string>(INTENT_CAPABILITIES.interactionVerbs);
const LEGACY_OPERATIONS = new Set(["approach", "enter", "heat", "cool", "create_mark", "speak", "call", "wait"]);

/** Convert one validated proposal into an existing transient command. */
export function validateIntentProposal(raw: unknown, rawText: string): IntentProposalValidation {
  const proposal = parseIntentProposal(raw);
  if (!proposal) return { status: "invalid", reason: "proposal does not match IntentProposalV1" };

  const additional = proposal.additionalClauses ?? [];
  const unsupported = proposal.unsupportedFragments ?? [];
  const ambiguities = proposal.ambiguities ?? [];
  if (additional.length > 0 || unsupported.length > 0 || ambiguities.length > 0) return clarificationFor(proposal);

  if (proposal.modelConfidence !== undefined && proposal.modelConfidence < 0.7) return clarificationFor(proposal);
  const intent = mapPrimary(proposal, rawText);
  if (!intent) return { status: "invalid", reason: "proposal primary intent is incomplete or unsupported" };
  const structural = validateActionProposal(intent);
  if (!structural.ok) {
    return { status: "clarification", question: structural.clarification, options: [{ optionId: "rephrase", label: "Переформулировать действие" }] };
  }
  return { status: "accepted", intent };
}

/** Validates only the query selector; the answer is built by the world read model. */
export function validateInquiryProposal(raw: unknown): InquiryProposalValidation {
  const proposal = parseInquiryProposal(raw);
  if (!proposal) return { status: "invalid", reason: "proposal does not match InquiryProposalV1" };
  if (!isInquiryQueryId(proposal.queryId)) return { status: "invalid", reason: "unknown inquiry query" };
  if (proposal.ambiguity?.trim()) {
    return {
      status: "clarification",
      question: proposal.ambiguity.trim(),
      options: [{ optionId: "inquiry-rephrase", label: "Уточнить вопрос" }],
    };
  }
  return { status: "accepted", queryId: proposal.queryId };
}

function mapPrimary(proposal: IntentProposalV1, rawText: string): ExecutableIntent | null {
  const primary = proposal.primary;
  const interpretation = { source: "llm" as const, confidence: proposal.modelConfidence ?? 1, ambiguities: [] as readonly string[] };
  if (primary.kind === "journey") {
    if (!primary.destination?.trim()) return null;
    const result: JourneyIntent = {
      type: "JourneyIntent",
      destination: { raw: primary.destination.trim() },
      rawText,
      interpretation,
    };
    if (primary.routeHint?.trim()) return { ...result, routeHint: { raw: primary.routeHint.trim() } };
    return result;
  }

  if (primary.kind === "interaction") {
    if (!primary.verb || !INTERACTION_VERBS.has(primary.verb)) return null;
    const result: InteractionCommand = {
      type: "InteractionCommand",
      verb: primary.verb as InteractionCommand["verb"],
      rawText,
      interpretation,
    };
    if (primary.target?.trim()) return { ...result, target: { raw: primary.target.trim() }, ...(primary.secondaryTarget?.trim() ? { secondaryTarget: { raw: primary.secondaryTarget.trim() } } : {}), ...(primary.instrument?.trim() ? { instrument: { raw: primary.instrument.trim() } } : {}), ...(primary.goal?.trim() ? { goal: primary.goal.trim() } : {}), ...(primary.manner?.trim() ? { manner: primary.manner.trim() } : {}) };
    if (primary.verb === "observe" || primary.verb === "listen") return result;
    return null;
  }

  if (!primary.operation || !LEGACY_OPERATIONS.has(primary.operation)) return null;
  const result: ActionIntentCommand = {
    type: "ActionIntentCommand",
    mode: primary.operation === "wait" ? "wait" : primary.operation === "speak" || primary.operation === "call" ? "communicate" : "interact",
    operation: primary.operation as ActionIntentCommand["operation"],
    rawText,
    interpretation,
  };
  return {
    ...result,
    ...(primary.target?.trim() ? { target: { raw: primary.target.trim() } } : {}),
    ...(primary.instrument?.trim() ? { instrument: { raw: primary.instrument.trim() } } : {}),
    ...(primary.manner?.trim() ? { manner: primary.manner.trim() } : {}),
    ...(primary.goal?.trim() ? { goal: primary.goal.trim() } : {}),
    ...(primary.utterance?.trim() ? { utterance: primary.utterance.trim() } : {}),
  };
}

function clarificationFor(proposal: IntentProposalV1): IntentProposalValidation {
  const explicit = proposal.ambiguities?.[0];
  if (explicit) {
    return {
      status: "clarification",
      question: explicit.question,
      options: explicit.options.map((label, index) => ({ optionId: `option-${index + 1}`, label })),
    };
  }
  const primary = proposal.primary;
  const primaryLabel = primary.kind === "journey"
    ? `начать путь к «${primary.destination ?? "указанному месту"}»`
    : primary.kind === "interaction"
      ? `${primary.verb ?? "выполнить действие"}${primary.target ? ` с «${primary.target}»` : ""}`
      : `выполнить «${primary.operation ?? "действие"}»`;
  return {
    status: "clarification",
    question: `Я понял основное намерение как «${primaryLabel}». Выполнить сначала его?`,
    options: [
      { optionId: "primary", label: `Да: ${primaryLabel}` },
      { optionId: "rephrase", label: "Нет, я переформулирую действие" },
    ],
  };
}

// ── Unified Structural Validator ─────────────────────────────────────

/** Matches punctuation-only strings, which are not usable referents. */
const PUNCTUATION_ONLY = /^[\s\p{P}\p{S}\p{N}]+$/u;

/**
 * A second verb after a conjunction means the parser/LLM proposed more than
 * one executable action. Ordinary coordinated targets such as "река и берег"
 * remain valid because they do not contain a second verb.
 */
const SECOND_ACTION = /\s+(?:и|а|но|потом|затем|сначала)\s+(?:я\s+)?(?:иду|идти|пойти|направ(?:иться|ляюсь)|обхожу|обойти|войти|открыть|закрыть|взять|достать|положить|использовать|осмотреть|осматрива|рассмотр|огляд|посмотр|слуш|прислуш|трон|прикосн|сказать|спросить|позвать)/iu;

/**
 * Shared structural validation for deterministic and LLM proposals.
 *
 * This layer checks only syntax/valency. It never resolves a target against
 * the world and never emits events.
 */
export function validateActionProposal(
  proposal: ActionIntentCommand | InteractionCommand | JourneyIntent,
): ProposalValidation {
  if (proposal.type === "JourneyIntent") {
    const destination = proposal.destination.raw.trim();
    if (!destination || PUNCTUATION_ONLY.test(destination)) {
      return {
        ok: false,
        reason: "missing_target",
        clarification: "Куда ты хочешь направиться? Назови место или направление.",
      };
    }
    if (SECOND_ACTION.test(proposal.rawText)) {
      return {
        ok: false,
        reason: "multiple_actions",
        clarification: "Я услышал несколько действий. Сначала выбери одно направление.",
      };
    }
    return { ok: true, proposal };
  }

  if (proposal.type === "InteractionCommand") {
    const valency = targetRequirementForInteraction(proposal.verb);
    if (valency === undefined) {
      return {
        ok: false,
        reason: "unsupported_structure",
        clarification: "Я не знаю, какое действие ты имеешь в виду. Попробуй переформулировать.",
      };
    }
    return validateTarget(proposal, valency);
  }

  if (proposal.operation === "unknown") {
    return {
      ok: false,
      reason: "unsupported_structure",
      clarification: "Я не знаю, какое действие ты имеешь в виду. Попробуй переформулировать.",
    };
  }

  // Legacy operations without canonical valency remain compatible. When a
  // canonical operation has metadata, apply that same requirement here too.
  const valency = targetRequirementForOperation(proposal.operation);
  if (valency === undefined) return { ok: true, proposal };
  return validateTarget(proposal, valency);
}

function validateTarget(
  proposal: InteractionCommand | ActionIntentCommand,
  valency: TargetRequirement,
): ProposalValidation {
  const target = proposal.target?.raw?.trim();
  const action = proposal.type === "InteractionCommand" ? proposal.verb : proposal.operation;

  if (valency === "forbidden" && target) {
    return {
      ok: false,
      reason: "unexpected_target",
      clarification: "Действие «" + action + "» не требует указания предмета.",
    };
  }

  if (valency === "required" && !target) {
    return {
      ok: false,
      reason: "missing_target",
      clarification: "Что именно ты хочешь " + getInfinitive(action) + "? Укажи предмет.",
    };
  }

  if (target) {
    if (PUNCTUATION_ONLY.test(target)) {
      return {
        ok: false,
        reason: "malformed_target",
        clarification: "Я не понял, на что ты хочешь " + getInfinitive(action) + ". Попробуй назвать предмет.",
      };
    }
    if (target.length <= 1 && !/^[а-яёА-ЯЁa-zA-Z]$/u.test(target)) {
      return {
        ok: false,
        reason: "malformed_target",
        clarification: "Я не понял, на что ты хочешь " + getInfinitive(action) + ". Попробуй назвать предмет.",
      };
    }
  }

  if (SECOND_ACTION.test(proposal.rawText)) {
    return {
      ok: false,
      reason: "multiple_actions",
      clarification: "Я услышал несколько действий. Сначала выбери одно.",
    };
  }

  return { ok: true, proposal };
}

/** Human-readable action labels used only in clarification text. */
function getInfinitive(action: InteractionVerb | IntentOperation): string {
  switch (action) {
    case "observe": return "осмотреться";
    case "inspect": return "изучить";
    case "listen": return "прислушаться";
    case "touch": return "тронуть";
    case "take": return "взять";
    case "open": return "открыть";
    case "close": return "закрыть";
    case "apply_force": return "приложить силу";
    case "give": return "дать";
    case "place": return "положить";
    case "use": return "использовать";
    case "approach": return "подойти";
    case "enter": return "войти";
    default: return "выполнить действие";
  }
}
