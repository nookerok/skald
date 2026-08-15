import type { NarrativeSnapshot, NarrativeEntry } from "./narrative.js";
import type { EpistemicClass, EpistemicNarrativeFact, TurnPresentation } from "./presentation/types.js";
import { ModelRouter } from "./llm/router.js";
import type { ChatMessage, ChatResult } from "./llm/types.js";

export interface NarrativeLLMResult {
  readonly text: string;
  readonly usedFallback: boolean;
  readonly fallbackReason: string | null;
  readonly model: string;
  readonly latencyMs: number;
}

/**
 * Structured narration contract (ADR-0033). The LLM may only rephrase the facts
 * it receives; every narration sentence must reference the input fact it derives
 * from and declare the epistemic class it asserts. The guard rejects any claim
 * whose class is stronger than its source fact, so a testimony or interpretation
 * can never be presented as an established fact. Deterministic and pure.
 */
export interface NarrationClaim {
  readonly text: string;
  readonly sourceFactId: string;
  readonly epistemicClass: EpistemicClass;
}

export interface StructuredNarration {
  readonly narration: string;
  readonly claims: readonly NarrationClaim[];
}

export interface GuardFact {
  readonly id: string;
  readonly epistemicClass: EpistemicClass;
}

export type NarrationGuardResult =
  | { readonly ok: true; readonly narration: string }
  | { readonly ok: false; readonly reason: string };

const EPISTEMIC_STRENGTH: Readonly<Record<EpistemicClass, number>> = {
  interpretation: 1,
  inference: 2,
  testimony: 3,
  observed_fact: 4,
  established_fact: 5,
};

export function isEpistemicClass(value: unknown): value is EpistemicClass {
  return typeof value === "string" && value in EPISTEMIC_STRENGTH;
}

export function epistemicStrength(cls: EpistemicClass): number {
  return EPISTEMIC_STRENGTH[cls];
}

/**
 * Absolute-certainty phrasing that asserts a proposition as indisputable,
 * established truth. Used to catch the case where the model labels a claim with
 * a weak epistemic class (testimony, inference, interpretation) but words it as
 * an unquestionable fact — a rumor presented as established truth. Deterministic
 * and pure; deliberately conservative (unmistakable markers only) to avoid
 * flagging ordinary literary intensifiers.
 */
const ABSOLUTE_CERTAINTY_MARKERS: readonly string[] = [
  // English
  "unquestionably", "unquestionable", "undeniably", "undeniable",
  "undoubtedly", "undoubted", "indisputably", "indisputable",
  "without a doubt", "without any doubt", "beyond any doubt", "beyond doubt",
  "there is no doubt", "it is a fact", "it's a fact", "without question",
  "no question that", "certainly true", "definitely true", "proven", "confirmed",
  "known fact", "true beyond", "certainly",
  // Russian
  "несомненно", "бесспорно", "неоспоримо", "вне всяких сомнений",
  "без сомнения", "не вызывает сомнений", "это факт", "доподлинно",
  "непреложно", "стопроцентно", "абсолютно точно", "точно известно",
  "достоверно установлено", "достоверно", "установлено", "точно",
  "подтверждено", "доказано", "известно", "верно", "истина", "факт",
];

/**
 * Returns true when the text asserts a proposition as absolute, indisputable
 * truth (e.g. "This is unquestionably established truth"). Deterministic and
 * pure.
 */
export function hasAbsoluteCertaintyPhrasing(text: string): boolean {
  const t = text.toLowerCase();
  return ABSOLUTE_CERTAINTY_MARKERS.some((marker) => t.includes(marker));
}

/**
 * Effective epistemic strength asserted by a claim: the stronger of its
 * declared class and any absolute-certainty phrasing in its text. A claim that
 * says "unquestionably" asserts established truth no matter what label the model
 * declares. Deterministic and pure.
 */
export function assertedEpistemicStrength(text: string, cls: EpistemicClass): number {
  if (hasAbsoluteCertaintyPhrasing(text)) return EPISTEMIC_STRENGTH.established_fact;
  return EPISTEMIC_STRENGTH[cls];
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function parseStructuredNarration(raw: string): StructuredNarration | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.narration !== "string" || obj.narration.trim() === "") return null;
  if (!Array.isArray(obj.claims)) return null;
  const claims: NarrationClaim[] = [];
  for (const c of obj.claims) {
    if (typeof c !== "object" || c === null) return null;
    const cc = c as Record<string, unknown>;
    if (typeof cc.text !== "string" || cc.text.trim() === "") return null;
    if (typeof cc.sourceFactId !== "string") return null;
    if (!isEpistemicClass(cc.epistemicClass)) return null;
    claims.push({ text: cc.text, sourceFactId: cc.sourceFactId, epistemicClass: cc.epistemicClass });
  }
  return { narration: obj.narration, claims };
}

/**
 * Deterministic structural guard over the structured narration response. No
 * claim may assert a stronger epistemic class than its source fact, judged by
 * BOTH the declared label and the wording of the claim text itself (a claim
 * phrased as "unquestionably established truth" asserts established truth no
 * matter what label the model declares). The narration text as a whole is held
 * to the same standard: absolute-certainty phrasing anywhere in the narration
 * requires a claim that genuinely asserts established truth. When no facts were
 * provided the model must not assert any epistemic claim at all.
 */
export function verifyEpistemicNarration(response: string, inputFacts: readonly GuardFact[]): NarrationGuardResult {
  const parsed = parseStructuredNarration(response);
  if (!parsed) return { ok: false, reason: "invalid_json" };
  const byId = new Map(inputFacts.map((f) => [f.id, f]));
  if (inputFacts.length === 0) {
    if (parsed.claims.length > 0) return { ok: false, reason: "unexpected_claims" };
    if (hasAbsoluteCertaintyPhrasing(parsed.narration)) {
      return { ok: false, reason: "certainty_overclaim" };
    }
    return { ok: true, narration: parsed.narration };
  }
  if (parsed.claims.length === 0) return { ok: false, reason: "missing_claims" };
  let strongestClaim = 0;
  for (const claim of parsed.claims) {
    const fact = byId.get(claim.sourceFactId);
    if (!fact) return { ok: false, reason: "unknown_source" };
    if (!isEpistemicClass(claim.epistemicClass)) return { ok: false, reason: "invalid_class" };
    const declaredStrength = epistemicStrength(claim.epistemicClass);
    if (declaredStrength > epistemicStrength(fact.epistemicClass)) {
      return { ok: false, reason: "class_upgrade" };
    }
    if (assertedEpistemicStrength(claim.text, claim.epistemicClass) > epistemicStrength(fact.epistemicClass)) {
      return { ok: false, reason: "certainty_overclaim" };
    }
    if (declaredStrength > strongestClaim) strongestClaim = declaredStrength;
  }
  if (hasAbsoluteCertaintyPhrasing(parsed.narration) && strongestClaim < EPISTEMIC_STRENGTH.established_fact) {
    return { ok: false, reason: "certainty_overclaim" };
  }
  return { ok: true, narration: renderSafeNarration(parsed, byId) };
}

function renderSafeNarration(parsed: StructuredNarration, facts: ReadonlyMap<string, GuardFact>): string {
  // The free-form narration field is never authoritative. Once facts exist,
  // render only validated claims; otherwise an unlisted sentence could smuggle
  // a second proposition past the epistemic checks.
  return parsed.claims.map((claim) => {
    const fact = facts.get(claim.sourceFactId);
    if (!fact) return claim.text;
    switch (claim.epistemicClass) {
      case "testimony":
        return "Источник сообщает: «" + claim.text + "»";
      case "inference":
        return "Возможное объяснение: " + claim.text;
      case "interpretation":
        return "Это лишь толкование: " + claim.text;
      default:
        return claim.text;
    }
  }).join(" ");
}

function templateText(entries: readonly NarrativeEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.kind !== "world" && e.kind !== "tick") {
      lines.push(e.text);
    }
  }
  // add world state entries at end
  for (const e of entries) {
    if (e.kind === "world") {
      lines.push(e.text);
    }
  }
  return lines.join("\n");
}

/**
 * §6 Authority Hierarchy: этот адаптер — самый нижний уровень иерархии.
 * Он НЕ имеет доступа к EventBus, Projection (кроме read-only snapshot'а на входе),
 * RuleEngine или кому бы то ни было из infra/игрового кода, способному менять мир.
 * Единственный output — строка текста для игрока. Архитектурная граница,
 * а не system prompt, гарантирует §6. Prompt — дополнительное ограничение.
 */
export async function narrateLLM(
  snapshot: NarrativeSnapshot,
  router: ModelRouter | null,
  _opts?: { locale?: "ru" | "en" },
): Promise<NarrativeLLMResult> {
  if (!router || !router.apiKey) {
    return {
      text: templateText(snapshot.entries),
      usedFallback: true,
      fallbackReason: "no_api_key",
      model: "",
      latencyMs: 0,
    };
  }

  const systemPrompt = "Skald — симуляция живого мира. Ты — повествователь. Описывай события мира в художественной форме, на русском, 2-3 предложения. Переформулируй строго по переданным фактам — не добавляй новые события, не изменяй мир, не принимай решений, не описывай мысли или намерения игрока. " +
    "Ответь ТОЛЬКО одним JSON-объектом без пояснений: {\"narration\": \"связный текст 2-3 предложения\", \"claims\": [{\"text\": \"одно предложение\", \"sourceFactId\": \"<id из entries>\", \"epistemicClass\": \"observed_fact\"}]}. Каждое предложение привяжи к id факта, из которого оно выведено, и укажи класс не выше класса того факта." + EPISTEMIC_PROMPT;

  // Only primary and notable — no background, no world-state projection entries
  const llmEntries = snapshot.presentation?.primary
    ? [snapshot.presentation.primary, ...snapshot.presentation.notable]
    : [];
  const facts = llmEntries.map((entry, i): { id: string; epistemicClass: EpistemicClass } & EpistemicNarrativeFact => {
    const id = i === 0 ? "primary" : `notable-${i - 1}`;
    return { id, text: entry.text, epistemicClass: entry.epistemicClass, sourceEventIds: entry.sourceEventIds };
  });
  const userContent = JSON.stringify({ entries: facts, worldTime: snapshot.worldTime, playerPosition: snapshot.playerPosition });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  try {
    const result: ChatResult = await router.chat("narrate", messages);
    const guard = verifyEpistemicNarration(result.text, facts);
    if (!guard.ok) {
      return {
        text: templateText(snapshot.entries),
        usedFallback: true,
        fallbackReason: `epistemic_violation:${guard.reason}`,
        model: "",
        latencyMs: 0,
      };
    }
    return {
      text: guard.narration,
      usedFallback: false,
      fallbackReason: null,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  } catch (err) {
    return {
      text: templateText(snapshot.entries),
      usedFallback: true,
      fallbackReason: "chat_error",
      model: "",
      latencyMs: 0,
    };
  }
}

/**
 * Non-authoritative literary narration for one player turn (ADR-0024 voices).
 * The LLM rephrases only the facts already selected by the deterministic
 * Presentation logic (turn `primary` + up to three `notable`s) and the player's
 * own action as a given cause. It never selects facts/importance, never emits
 * Domain Events, never writes Projection, and never decides an outcome — it
 * only produces prose text (alignment with AGENTS §4). Callers persist this as
 * a read-side journal decoration.
 */
export interface TurnNarration {
  readonly text: string;
  readonly model: string;
  readonly usedFallback: boolean;
  readonly fallbackReason: string | null;
  readonly latencyMs: number;
}

const EPISTEMIC_PROMPT = "Сохраняй классы epistemic: established_fact утверждай прямо; observed_fact подавай как увиденное; testimony привязывай к источнику; inference и interpretation оформляй как предположение. Никогда не повышай класс и не превращай testimony, belief или interpretation в установленный факт.";
const DND_SYSTEM_PROMPT =
  "Ты — рассказчик тёмного мира в духе D&D. Опиши этот ход художественно, по-русски, 2-4 предложения, в прошедшем времени, с атмосферой. " +
  "Перескажи только факты ниже и результат действия: ничего не придумывай, не выбирай за игрока, не описывай его мысли или будущие намерения. Твоё описание ничего не меняет в симуляции. " +
  "Ответь ТОЛЬКО одним JSON-объектом без пояснений: {\"narration\": \"связный текст 2-4 предложения\", \"claims\": [{\"text\": \"одно предложение\", \"sourceFactId\": \"<id из turnFacts>\", \"epistemicClass\": \"observed_fact\"}]}. Каждое предложение привяжи к id факта, из которого оно выведено, и укажи класс не выше класса того факта." +
  EPISTEMIC_PROMPT;

function fallbackNarration(presentation: TurnPresentation, reason: string): TurnNarration {
  return {
    text: presentation.primary?.text ?? "Мир продолжал дышать вокруг тебя.",
    model: "",
    usedFallback: true,
    fallbackReason: reason,
    latencyMs: 0,
  };
}

export async function narrateTurnLLM(
  playerAction: string,
  presentation: TurnPresentation,
  router: ModelRouter | null,
): Promise<TurnNarration> {
  if (!router || !router.apiKey) {
    return fallbackNarration(presentation, "no_api_key");
  }

  const facts = [
    { id: "primary", role: "primary", text: presentation.primary?.text ?? null, epistemicClass: presentation.primary?.epistemicClass ?? "observed_fact", sourceEventIds: presentation.primary?.sourceEventIds ?? [] },
    ...presentation.notable.slice(0, 3).map((e, i) => ({ id: `notable-${i}`, role: "notable", text: e.text, epistemicClass: e.epistemicClass, sourceEventIds: e.sourceEventIds })),
  ].filter((f) => f.text !== null);

  const userContent = JSON.stringify({
    playerAction,
    turnFacts: facts.map((f) => ({ id: f.id, role: f.role, text: f.text, epistemicClass: f.epistemicClass, sourceEventIds: f.sourceEventIds })),
    worldTime: presentation.worldTime,
    playerPosition: presentation.playerPosition,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: DND_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  try {
    const result: ChatResult = await router.chat("narrate", messages);
    const guard = verifyEpistemicNarration(result.text, facts);
    if (!guard.ok) {
      return fallbackNarration(presentation, `epistemic_violation:${guard.reason}`);
    }
    return {
      text: guard.narration.trim(),
      model: result.model,
      usedFallback: false,
      fallbackReason: null,
      latencyMs: result.latencyMs,
    };
  } catch (err) {
    return fallbackNarration(presentation, "chat_error");
  }
}
