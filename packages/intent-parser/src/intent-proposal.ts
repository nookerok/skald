import type {
  ActionIntentCommand,
  InteractionCommand,
  JourneyIntent,
} from "./types.js";
import type { InquiryQueryId } from "./inquiry.js";

/** A finite capability list supplied to the non-authoritative interpreter. */
export interface IntentCapabilitiesManifest {
  readonly schemaVersion: 1;
  readonly interactionVerbs: readonly [
    "observe",
    "inspect",
    "listen",
    "touch",
    "take",
    "open",
    "apply_force",
    "give",
    "place",
    "use",
  ];
  readonly journeySupported: true;
  readonly onePrimaryIntentOnly: true;
}

export const INTENT_CAPABILITIES: IntentCapabilitiesManifest = Object.freeze({
  schemaVersion: 1,
  interactionVerbs: ["observe", "inspect", "listen", "touch", "take", "open", "apply_force", "give", "place", "use"] as const,
  journeySupported: true,
  onePrimaryIntentOnly: true,
});

/** Query ids an untrusted model may propose for the read-only inquiry path. */
export interface InquiryCapabilitiesManifest {
  readonly schemaVersion: 1;
  readonly queryIds: readonly InquiryQueryId[];
  readonly readOnly: true;
}

export const INQUIRY_CAPABILITIES: InquiryCapabilitiesManifest = Object.freeze({
  schemaVersion: 1,
  queryIds: [
    "current_location",
    "visible_scene",
    "auditory_scene",
    "character_identity",
    "known_place_knowledge",
    "available_routes",
    "recent_events",
    "inventory",
    "known_contacts",
    "map_position",
  ] as const,
  readOnly: true,
});

export interface InquiryProposalV1 {
  readonly schemaVersion: 1;
  readonly kind: "inquiry";
  readonly queryId: string;
  readonly ambiguity?: string;
}

export type InquiryProposalValidation =
  | { readonly status: "accepted"; readonly queryId: InquiryQueryId }
  | { readonly status: "clarification"; readonly question: string; readonly options: readonly { readonly optionId: string; readonly label: string }[] }
  | { readonly status: "invalid"; readonly reason: string };

export interface IntentProposalInput {
  readonly kind: "interaction" | "journey" | "legacy";
  readonly verb?: string;
  readonly operation?: string;
  readonly destination?: string;
  readonly target?: string;
  readonly secondaryTarget?: string;
  readonly instrument?: string;
  readonly routeHint?: string;
  readonly manner?: string;
  readonly goal?: string;
  readonly utterance?: string;
}

export interface IntentProposalClause {
  readonly kind: "interaction" | "journey" | "legacy" | "unknown";
  readonly summary: string;
}

export interface IntentProposalAmbiguity {
  readonly question: string;
  readonly options: readonly string[];
}

/** Untrusted model output. It is never handed to the Command Handler. */
export interface IntentProposalV1 {
  readonly schemaVersion: 1;
  readonly primary: IntentProposalInput;
  readonly additionalClauses?: readonly IntentProposalClause[];
  readonly ambiguities?: readonly IntentProposalAmbiguity[];
  readonly unsupportedFragments?: readonly string[];
  readonly modelConfidence?: number;
}

export type ExecutableIntent = ActionIntentCommand | InteractionCommand | JourneyIntent;

export interface ClarificationOption {
  readonly optionId: string;
  readonly label: string;
}

export type IntentProposalValidation =
  | { readonly status: "accepted"; readonly intent: ExecutableIntent }
  | { readonly status: "clarification"; readonly question: string; readonly options: readonly ClarificationOption[] }
  | { readonly status: "unsupported"; readonly message: string }
  | { readonly status: "invalid"; readonly reason: string };

export function isIntentProposal(value: unknown): value is IntentProposalV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 && isProposalInput(candidate.primary);
}

function isProposalInput(value: unknown): value is IntentProposalInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "interaction" || candidate.kind === "journey" || candidate.kind === "legacy";
}

export function parseIntentProposal(raw: unknown): IntentProposalV1 | null {
  if (!isIntentProposal(raw)) return null;
  const candidate = raw as unknown as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ["schemaVersion", "primary", "additionalClauses", "ambiguities", "unsupportedFragments", "modelConfidence"])) return null;
  if (!validateInputStrings(candidate.primary as IntentProposalInput)) return null;
  if (!hasOnlyKeys(candidate.primary as Record<string, unknown>, ["kind", "verb", "operation", "destination", "target", "secondaryTarget", "instrument", "routeHint", "manner", "goal", "utterance"])) return null;
  if (candidate.modelConfidence !== undefined && (typeof candidate.modelConfidence !== "number" || !Number.isFinite(candidate.modelConfidence) || candidate.modelConfidence < 0 || candidate.modelConfidence > 1)) return null;
  if (candidate.additionalClauses !== undefined && !isClauses(candidate.additionalClauses)) return null;
  if (candidate.ambiguities !== undefined && !isAmbiguities(candidate.ambiguities)) return null;
  if (candidate.unsupportedFragments !== undefined && !isStringList(candidate.unsupportedFragments, 4)) return null;
  return Object.freeze({
    schemaVersion: 1,
    primary: Object.freeze({ ...(candidate.primary as IntentProposalInput) }),
    ...(candidate.additionalClauses ? { additionalClauses: Object.freeze([...(candidate.additionalClauses as IntentProposalClause[])]) } : {}),
    ...(candidate.ambiguities ? { ambiguities: Object.freeze([...(candidate.ambiguities as IntentProposalAmbiguity[])]) } : {}),
    ...(candidate.unsupportedFragments ? { unsupportedFragments: Object.freeze([...(candidate.unsupportedFragments as string[])]) } : {}),
    ...(candidate.modelConfidence !== undefined ? { modelConfidence: candidate.modelConfidence as number } : {}),
  });
}

export function isInquiryProposal(value: unknown): value is InquiryProposalV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1
    && candidate.kind === "inquiry"
    && typeof candidate.queryId === "string"
    && candidate.queryId.length <= 80
    && (candidate.ambiguity === undefined || typeof candidate.ambiguity === "string");
}

export function parseInquiryProposal(raw: unknown): InquiryProposalV1 | null {
  if (!isInquiryProposal(raw)) return null;
  const candidate = raw as unknown as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ["schemaVersion", "kind", "queryId", "ambiguity"])) return null;
  if (typeof candidate.ambiguity === "string" && (candidate.ambiguity.length > 240 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(candidate.ambiguity))) return null;
  return Object.freeze({
    schemaVersion: 1,
    kind: "inquiry" as const,
    queryId: candidate.queryId as string,
    ...(typeof candidate.ambiguity === "string" ? { ambiguity: candidate.ambiguity } : {}),
  });
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function validateInputStrings(input: IntentProposalInput): boolean {
  const fields = [input.verb, input.operation, input.destination, input.target, input.secondaryTarget, input.instrument, input.routeHint, input.manner, input.goal, input.utterance];
  return fields.every((value) => value === undefined || (typeof value === "string" && value.length <= 240 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)));
}

function isStringList(value: unknown, max: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && item.length <= 240);
}

function isClauses(value: unknown): value is readonly IntentProposalClause[] {
  return Array.isArray(value) && value.length <= 3 && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const candidate = item as Record<string, unknown>;
    return hasOnlyKeys(candidate, ["kind", "summary"])
      && ["interaction", "journey", "legacy", "unknown"].includes(candidate.kind as string)
      && typeof candidate.summary === "string"
      && candidate.summary.length <= 240;
  });
}

function isAmbiguities(value: unknown): value is readonly IntentProposalAmbiguity[] {
  return Array.isArray(value) && value.length <= 3 && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const candidate = item as Record<string, unknown>;
    return hasOnlyKeys(candidate, ["question", "options"])
      && typeof candidate.question === "string"
      && candidate.question.length <= 240
      && isStringList(candidate.options, 4);
  });
}
