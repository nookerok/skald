import type { ActionIntentCommand, InteractionCommand, JourneyIntent } from "./types.js";
import {
  INTENT_CAPABILITIES,
  parseIntentProposal,
  type ExecutableIntent,
  type IntentProposalV1,
  type IntentProposalValidation,
} from "./intent-proposal.js";

const INTERACTION_VERBS = new Set<string>(INTENT_CAPABILITIES.interactionVerbs);
const LEGACY_OPERATIONS = new Set(["approach", "enter", "heat", "cool", "place", "use", "create_mark", "speak", "call", "wait"]);

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
  return { status: "accepted", intent };
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
    if (primary.target?.trim()) return { ...result, target: { raw: primary.target.trim() }, ...(primary.secondaryTarget?.trim() ? { secondaryTarget: { raw: primary.secondaryTarget.trim() } } : {}), ...(primary.instrument?.trim() ? { instrument: { raw: primary.instrument.trim() } } : {}) };
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
