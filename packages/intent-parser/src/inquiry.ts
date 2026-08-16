/**
 * Read-only questions addressed to the Game Master.
 *
 * This module only classifies player text. It never reads the world and never
 * decides an outcome. The world package resolves the registered query against
 * an observer-scoped read model.
 */

import type { IntentResult } from "./types.js";

export const INQUIRY_QUERY_IDS = [
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
] as const;

export type InquiryQueryId = (typeof INQUIRY_QUERY_IDS)[number];

export interface InquiryRequest {
  readonly type: "InquiryRequest";
  readonly queryId: InquiryQueryId;
  readonly rawText: string;
  readonly confidence: number;
  readonly source: "deterministic" | "llm";
}

export type PlayerInputKind = "inquiry" | "action" | "speech";

export type PlayerInputClassification =
  | { readonly kind: "inquiry"; readonly inquiry: InquiryRequest }
  | { readonly kind: "inquiry_candidate"; readonly rawText: string }
  | { readonly kind: "action"; readonly intent: IntentResult }
  | { readonly kind: "speech"; readonly intent: IntentResult };

const DIRECT_PREFIX = /^(?:(?:мастер|ведущий)\s*[,;:]?\s*)?(?:(?:скажи|расскажи|подскажи)\s*[,;:]?\s*)?/iu;

const INQUIRY_PATTERNS: readonly [InquiryQueryId, readonly RegExp[]][] = [
  ["current_location", [
    /^где\s+(?:я|я\s+нахожусь|мы)/iu,
    /^в\s+каком\s+месте\s+(?:я|мы)/iu,
  ]],
  ["visible_scene", [
    /^что\s+(?:я\s+)?вижу/iu,
    /^что\s+перед\s+(?:моими|нами)\s+глазами/iu,
    /^что\s+вокруг\s+(?:меня|нас)/iu,
  ]],
  ["auditory_scene", [
    /^что\s+(?:я\s+)?слышу/iu,
    /^что\s+происходит\s+со\s+звуками/iu,
    /^(?:какие|что\s+за)\s+звуки\s+(?:вокруг|рядом)/iu,
  ]],
  ["character_identity", [
    /^кто\s+я/iu,
    /^кем\s+я\s+был/iu,
    /^какая\s+у\s+меня\s+предыстория/iu,
  ]],
  ["known_place_knowledge", [
    /^что\s+я\s+знаю\s+(?:об|о)\s+(?:этом\s+)?месте/iu,
    /^что\s+мне\s+известно\s+об\s+этом\s+месте/iu,
    /^что\s+я\s+знаю\s+здесь/iu,
  ]],
  ["available_routes", [
    /^куда\s+можно\s+(?:пойти|идти|направиться)/iu,
    /^какие\s+(?:дороги|пути|маршруты)\s+(?:мне\s+)?доступны/iu,
    /^куда\s+вед(?:е|ё)т\s+(?:дорога|путь)/iu,
  ]],
  ["recent_events", [
    /^что\s+(?:здесь\s+)?произошло/iu,
    /^что\s+случилось/iu,
    /^что\s+сейчас\s+происходит/iu,
  ]],
  ["inventory", [
    /^что\s+у\s+меня\s+(?:с\s+собой|есть)/iu,
    /^какие\s+у\s+меня\s+вещи/iu,
    /^что\s+я\s+несу/iu,
  ]],
  ["known_contacts", [
    /^с\s+кем\s+я\s+знаком/iu,
    /^кого\s+я\s+знаю\s+(?:здесь|в\s+этом\s+месте)?/iu,
    /^кто\s+может\s+меня\s+знать/iu,
  ]],
  ["map_position", [
    /^почему\s+карта\s+(?:показывает|отображает)\s+(?:это\s+место|меня)/iu,
    /^почему\s+я\s+вижу\s+на\s+карте\s+это\s+место/iu,
    /^где\s+на\s+карте\s+я/iu,
  ]],
];

function normalizeQuestion(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[!?.,;:]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function isExplicitSpeech(text: string): boolean {
  return /^(?:спроси|спросить|скажи|сказать|обратись|обратиться|позови|позвать|окликни|окликнуть)\s+(?:к\s+)?(?:перевозчик|архивист|стражник|местн|торгов|человек|нему|ней|им|ей)/iu.test(text);
}

function directInquiry(input: string): InquiryRequest | null {
  const normalized = normalizeQuestion(input);
  const withoutPrefix = normalized.replace(DIRECT_PREFIX, "").trim();
  if (isExplicitSpeech(normalized)) return null;
  for (const [queryId, patterns] of INQUIRY_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(withoutPrefix))) {
      return Object.freeze({ type: "InquiryRequest", queryId, rawText: input, confidence: 1, source: "deterministic" });
    }
  }
  return null;
}

export function isQuestionLikeInput(input: string): boolean {
  const normalized = normalizeQuestion(input);
  if (isExplicitSpeech(normalized)) return false;
  return /[?]$/u.test(input.trim())
    || /^(?:кто|что|где|куда|почему|зачем|как|какие|какая|какой|сколько)/iu.test(normalized);
}

/** Classifies a player message without reading or changing the world. */
export function classifyPlayerInput(input: string, parseAction: (value: string) => IntentResult): PlayerInputClassification {
  const inquiry = directInquiry(input);
  if (inquiry) return { kind: "inquiry", inquiry };
  if (isQuestionLikeInput(input)) return { kind: "inquiry_candidate", rawText: input };
  const intent = parseAction(input);
  if ((intent.type === "ActionIntentCommand" && (intent.operation === "speak" || intent.operation === "call"))
    || (intent.type === "InteractionCommand" && intent.verb === "give")) {
    return { kind: "speech", intent };
  }
  return { kind: "action", intent };
}

export function isInquiryQueryId(value: unknown): value is InquiryQueryId {
  return typeof value === "string" && (INQUIRY_QUERY_IDS as readonly string[]).includes(value);
}
