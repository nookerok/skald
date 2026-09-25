import type { NarrativeSnapshot, NarrativeEntry } from "./narrative.js";
import type { EpistemicClass, EpistemicNarrativeFact, TurnPresentation } from "./presentation/types.js";
import { sanitizePlayerFacingText } from "./game-shell/player-facing.js";
import { ModelRouter } from "./llm/router.js";
import { toProviderFailure } from "./llm/errors.js";
import type { ChatMessage, ChatResult } from "./llm/types.js";
import type { NarrationOptions, NarrationDiagnosticSink, NarrationErrorCategory, NarrationOutcome, RetryOutcome } from "./narration-diagnostics.js";
import { classifyNarrationError, isTransientNarrationError } from "./narration-diagnostics.js";
import type { NarrativeAdapterContext, NarrativeFact } from "./setup/background-context.js";
import type { AllowedFactAssertion, AllowedNarrativeFacts } from "./allowed-narrative-facts.js";
import { actionFallbackText, isGenericActionFallback } from "./presentation/action-fallback.js";
import { verifyGameNarration } from "./game-director/narration-quality.js";
import type { GameDirectorContext } from "./game-director/index.js";

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
  readonly source?: string;
  readonly usableNow?: boolean;
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
export interface NarrationGuardOptions {
  readonly requireBackgroundLink?: boolean;
  readonly backgroundFactIds?: readonly string[];
  /** Require at least one validated claim, even when the caller has no facts. */
  readonly requireClaims?: boolean;
}

const INTERNAL_REFERENCE_PATTERN = /(?:\b(?:contact|item|event|world|background|entrypoint|situation|hypothesis|knowledge|testimony):[A-Za-z0-9_.#:-]+|\bboot#[A-Za-z0-9_.#:-]+|\b(?:event|evt)-[A-Za-z0-9_-]+|\b(?:sourceEventIds?|eventId|canonicalRef)\s*[:=])/i;

function isSafeClaimText(text: string): boolean {
  if (INTERNAL_REFERENCE_PATTERN.test(text) || /[\r\n]/.test(text)) return false;
  const sentenceStops = text.match(/[.!?](?=\s|$)/g)?.length ?? 0;
  return sentenceStops <= 1;
}

export function verifyEpistemicNarration(
  response: string,
  inputFacts: readonly GuardFact[],
  options?: NarrationGuardOptions,
): NarrationGuardResult {
  const parsed = parseStructuredNarration(response);
  if (!parsed) return { ok: false, reason: "invalid_json" };
  if (INTERNAL_REFERENCE_PATTERN.test(parsed.narration) || parsed.claims.some((claim) => !isSafeClaimText(claim.text))) {
    return { ok: false, reason: "unsafe_text" };
  }
  const byId = new Map(inputFacts.map((f) => [f.id, f]));
  if (inputFacts.length === 0) {
    if (options?.requireClaims) return { ok: false, reason: "missing_claims" };
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
    if (fact.usableNow === false) return { ok: false, reason: "unusable_source" };
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
  if (options?.requireBackgroundLink) {
    const allowed = new Set(options.backgroundFactIds ?? []);
    if (!parsed.claims.some((claim) => allowed.has(claim.sourceFactId))) {
      return { ok: false, reason: "missing_background_link" };
    }
  }
  return { ok: true, narration: renderSafeNarration(parsed, byId) };
}

function renderSafeNarration(parsed: StructuredNarration, facts: ReadonlyMap<string, GuardFact>): string {
  // The free-form narration field is never authoritative. Once facts exist,
  // render only validated claims; otherwise an unlisted sentence could smuggle
  // a second proposition past the epistemic checks.
  return parsed.claims.map((claim) => {
    const fact = facts.get(claim.sourceFactId);
    if (!fact) return sanitizePlayerFacingText(claim.text);
    switch (claim.epistemicClass) {
      case "testimony":
        return "Источник сообщает: «" + sanitizePlayerFacingText(claim.text) + "»";
      case "inference":
        return "Возможное объяснение: " + sanitizePlayerFacingText(claim.text);
      case "interpretation":
        return "Это лишь толкование: " + sanitizePlayerFacingText(claim.text);
      default:
        return sanitizePlayerFacingText(claim.text);
    }
  }).join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 1000;

function retryCount(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_MAX_RETRIES;
  return Math.min(DEFAULT_MAX_RETRIES, Math.max(0, Math.floor(raw)));
}

/**
 * Emit a diagnostic event through the sink if provided. No-op when sink is
 * undefined, so callers never need to guard.
 */
function emitDiagnostic(sink: NarrationDiagnosticSink | undefined, event: Parameters<NarrationDiagnosticSink>[0]): void {
  try {
    sink?.(event);
  } catch {
    // Diagnostics are best-effort telemetry. A broken logger must never
    // change narration outcome or enter the provider-error retry path.
  }
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
  return lines.join("\n") || "Здесь начинается твой путь — осмотрись и выбери, что проверить дальше.";
}

function contextFacts(context: NarrativeAdapterContext | undefined): {
  backgroundFacts: NarrativeFact[];
  visibleSituation: NarrativeFact[];
  accessibleItems: NarrativeFact[];
  knownContacts: NarrativeFact[];
  testimony: NarrativeFact[];
  hypotheses: NarrativeFact[];
  observedKnowledge: NarrativeFact[];
  unresolvedSituation: NarrativeFact[];
} {
  if (!context) return { backgroundFacts: [], visibleSituation: [], accessibleItems: [], knownContacts: [], testimony: [], hypotheses: [], observedKnowledge: [], unresolvedSituation: [] };
  const backgroundFacts: NarrativeFact[] = [
    { id: "background:name", text: `Твоё имя: ${context.character.name}.`, epistemicClass: "established_fact", source: "background", usableNow: true },
    { id: "background:title", text: context.character.backgroundTitle, epistemicClass: "established_fact", source: "background", usableNow: true },
    { id: "background:role", text: context.character.formerRole, epistemicClass: "established_fact", source: "background", usableNow: true },
    { id: "background:rupture", text: context.character.rupture, epistemicClass: "established_fact", source: "background", usableNow: true },
    { id: "background:obligation", text: context.character.obligation, epistemicClass: "established_fact", source: "background", usableNow: true },
    { id: "arrival:reason", text: context.arrival.reason, epistemicClass: "established_fact", source: "background", usableNow: true },
    { id: "arrival:hook", text: context.arrival.personalHook, epistemicClass: "established_fact", source: "entrypoint", usableNow: true },
  ];
  return {
    backgroundFacts,
    visibleSituation: [...context.visibleSituation.facts, ...context.visibleSituation.sensoryContext],
    accessibleItems: [...context.accessibleItems],
    knownContacts: [...context.contacts],
    testimony: [...context.knowledge.testimony],
    hypotheses: [...context.knowledge.hypotheses],
    observedKnowledge: [...context.knowledge.observed],
    unresolvedSituation: [...context.unresolvedSituation],
  };
}

function promptFacts(facts: readonly NarrativeFact[]): readonly Omit<NarrativeFact, "sourceEventIds">[] {
  return facts.map(({ sourceEventIds: _sourceEventIds, ...fact }) => fact);
}

function promptResponse(response: TurnPresentation["response"]): { readonly kind: string; readonly text: string } | null {
  return response ? { kind: response.kind, text: response.text } : null;
}

/** Only these read-side facts can bridge the opening window. Identity prose
 * (name/title/role/rupture) is background context, but not an arrival bridge. */
function openingBackgroundFactIds(groups: ReturnType<typeof contextFacts>): string[] {
  return [
    "background:obligation",
    "arrival:reason",
    "arrival:hook",
    "situation:opening-problem",
    ...groups.accessibleItems.map((item) => item.id),
    ...groups.knownContacts.map((item) => item.id),
    ...groups.testimony.map((item) => item.id),
  ];
}

function asGuardFacts(groups: ReturnType<typeof contextFacts>, turnFacts: readonly GuardFact[]): GuardFact[] {
  const all: GuardFact[] = [...turnFacts];
  for (const group of Object.values(groups)) {
    for (const item of group) all.push({ id: item.id, epistemicClass: item.epistemicClass, source: item.source, usableNow: item.usableNow });
  }
  return all;
}

function personalizedFallback(presentation: TurnPresentation, playerAction: string, context: NarrativeAdapterContext | undefined): string {
  const primary = presentation.response?.text ?? presentation.primary?.text;
  const fallbackKind = presentation.response?.kind === "action_rejection" ? "rejection" : "outcome";
  const base = sanitizePlayerFacingText(primary && !isGenericActionFallback(primary)
    ? primary
    : actionFallbackText(playerAction, fallbackKind));
  if (!context) return base;
  const additions: string[] = [];
  if (context.openingWindow && !base.includes(context.arrival.reason)) {
    additions.push(`Ты помнишь: ${sanitizePlayerFacingText(context.arrival.reason)}`);
  }
  const item = context.accessibleItems[0];
  if (item && !base.includes(item.text)) additions.push(sanitizePlayerFacingText(item.text));
  const testimony = context.knowledge.testimony[0];
  if (testimony && !base.includes(testimony.text)) additions.push(`Источник сообщает: «${sanitizePlayerFacingText(testimony.text)}»`);
  const visible = context.visibleSituation.sensoryContext[0] ?? context.visibleSituation.facts[0];
  if (visible && !base.includes(visible.text)) additions.push(sanitizePlayerFacingText(visible.text));
  if (additions.length === 0) {
    additions.push(`Ты помнишь: ${sanitizePlayerFacingText(context.arrival.reason)}`);
  }
  return [base, ...additions.slice(0, 2)].join(" ");
}

function personalizedNarrativeText(snapshot: NarrativeSnapshot, context: NarrativeAdapterContext): string {
  const base = sanitizePlayerFacingText(templateText(snapshot.entries));
  const item = context.accessibleItems[0]?.text;
  const testimony = context.knowledge.testimony[0]?.text;
  const addition = context.openingWindow
    ? `Ты помнишь: ${context.arrival.reason}`
    : (item ?? (testimony ? `Источник сообщает: «${testimony}»` : `Ты помнишь: ${context.arrival.reason}`));
  return addition && !base.includes(addition) ? `${base} ${sanitizePlayerFacingText(addition)}` : base;
}

function diagnosticProvider(router: ModelRouter, error: unknown): string {
  const provider = error && typeof error === "object"
    ? (error as { provider?: unknown }).provider
    : undefined;
  return typeof provider === "string" && provider.length > 0 ? provider : router.providerId;
}

function diagnosticField(error: unknown, field: "model" | "configuredModel"): string | undefined {
  const value = error && typeof error === "object"
    ? (error as Record<string, unknown>)[field]
    : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function diagnosticProviderFailure(router: ModelRouter, error: unknown): ReturnType<typeof toProviderFailure> {
  const context = { provider: router.providerId, category: "narrate" as const };
  const direct = toProviderFailure(error, context);
  if (direct) return direct;
  if (error && typeof error === "object") {
    const cause = (error as { cause?: unknown }).cause;
    if (cause) return toProviderFailure(cause, context);
  }
  return null;
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
  opts?: NarrationOptions,
): Promise<NarrativeLLMResult> {
  const sink = opts?.diagnostics;
  const maxAttempts = router && (router as { managesRetries?: boolean }).managesRetries
    ? 1
    : 1 + retryCount(opts?.maxRetries);
  const retryBaseMs = opts?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const priority = opts?.priority ?? "interactive";

  // Fast path: no router / no API key — never retry
  if (!router || !router.apiKey) {
    emitDiagnostic(sink, {
      kind: "llm",
      category: "no_api_key",
      outcome: "deterministic_fallback",
      provider: router?.providerId ?? "",
      durationMs: 0,
      turn: snapshot.worldTime,
      worldTime: snapshot.worldTime,
      attempt: 1,
      priority,
      timeout: 0,
      retryOutcome: "none",
      worldId: opts?.worldId,
      recordedAt: new Date().toISOString(),
      correlationId: opts?.correlationId,
    });
    return {
      text: snapshot.narrativeContext ? personalizedNarrativeText(snapshot, snapshot.narrativeContext) : templateText(snapshot.entries),
      usedFallback: true,
      fallbackReason: "no_api_key",
      model: "",
      latencyMs: 0,
    };
  }

  const systemPrompt = "Skald — симуляция живого мира. Ты — повествователь. Описывай события мира в художественной форме, на русском, 2-3 предложения. Переформулируй строго по переданным фактам — не добавляй новые события, не изменяй мир, не принимай решений, не описывай мысли или намерения игрока. Используй отдельные группы turnFacts, backgroundFacts, visibleSituation, accessibleItems, knownContacts, testimony и hypotheses; не смешивай их эпистемические классы. observedKnowledge — это только то, что знает или помнит игрок, а не доказанная истина мира; не выдавай его как установленный мировой факт. " +
    "Ответь ТОЛЬКО одним JSON-объектом без пояснений: {\"narration\": \"связный текст 2-3 предложения\", \"claims\": [{\"text\": \"одно предложение\", \"sourceFactId\": \"<id из переданных групп>\", \"epistemicClass\": \"observed_fact\"}]}. Каждое предложение привяжи к id факта, из которого оно выведено, и укажи класс не выше класса того факта." + EPISTEMIC_PROMPT;

  // Primary/notable remain the deterministic turn facts; the adapter context
  // is supplied in separate groups so historical/background facts cannot be
  // confused with the current event result.
  const llmEntries = snapshot.presentation?.primary
    ? [snapshot.presentation.primary, ...snapshot.presentation.notable]
    : [];
  const facts = llmEntries.map((entry, i): { id: string; epistemicClass: EpistemicClass } & EpistemicNarrativeFact => {
    const id = i === 0 ? "primary" : `notable-${i - 1}`;
    return { id, text: entry.text, epistemicClass: entry.epistemicClass, sourceEventIds: entry.sourceEventIds };
  });
  if (facts.length === 0) {
    facts.push({
      id: "primary",
      text: snapshot.presentation?.response?.text ?? "В мире пока не видно нового движения — осмотрись и выбери, что проверить дальше.",
      epistemicClass: "observed_fact",
      sourceEventIds: [],
    });
  }
  const groups = contextFacts(snapshot.narrativeContext);
  const guardFacts = asGuardFacts(groups, facts);
  const allowedOpeningFacts = openingBackgroundFactIds(groups);
  const userContent = JSON.stringify({
    response: promptResponse(snapshot.presentation.response),
    entries: facts.map((fact) => ({ id: fact.id, text: fact.text, epistemicClass: fact.epistemicClass })),
    turnFacts: facts.map((fact) => ({ id: fact.id, text: fact.text, epistemicClass: fact.epistemicClass })),
    backgroundFacts: groups.backgroundFacts,
    visibleSituation: promptFacts(groups.visibleSituation),
    accessibleItems: promptFacts(groups.accessibleItems),
    knownContacts: promptFacts(groups.knownContacts),
    testimony: promptFacts(groups.testimony),
    hypotheses: promptFacts(groups.hypotheses),
    observedKnowledge: promptFacts(groups.observedKnowledge),
    unresolvedSituation: promptFacts(groups.unresolvedSituation),
    openingWindow: snapshot.narrativeContext?.openingWindow === true,
    worldTime: snapshot.worldTime,
    playerPosition: snapshot.playerPosition,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  let lastCategory: NarrationErrorCategory = "unknown_provider_error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = performance.now();
    try {
      const result: ChatResult = await router.chat("narrate", messages, {
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(sink ? { diagnostics: sink } : {}),
        ...(opts?.correlationId ? { correlationId: opts.correlationId } : {}),
        worldTime: snapshot.worldTime,
        priority,
      });
      const durationMs = Math.round(performance.now() - start);
      const guard = verifyEpistemicNarration(result.text, guardFacts, {
        requireClaims: true,
        ...(snapshot.narrativeContext?.openingWindow ? { requireBackgroundLink: true, backgroundFactIds: allowedOpeningFacts } : {}),
      });
      if (!guard.ok) {
        const category: NarrationErrorCategory = "schema_rejection";
        emitDiagnostic(sink, {
          kind: "llm",
          category,
          outcome: "deterministic_fallback",
          provider: result.provider,
          durationMs,
          turn: snapshot.worldTime,
          worldTime: snapshot.worldTime,
          attempt,
          priority,
          timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
          retryOutcome: "none",
          worldId: opts?.worldId,
          recordedAt: new Date().toISOString(),
          correlationId: opts?.correlationId,
          model: result.model,
          configuredModel: result.configuredModel,
        });
        // Schema rejection is deterministic — no retry
        return {
          text: snapshot.narrativeContext ? personalizedNarrativeText(snapshot, snapshot.narrativeContext) : templateText(snapshot.entries),
          usedFallback: true,
          fallbackReason: `epistemic_violation:${guard.reason}`,
          model: "",
          latencyMs: 0,
        };
      }
      const retryOutcome: RetryOutcome = attempt > 1 ? "succeeded_on_retry" : "none";
      const configuredProvider = result.configuredProvider ?? router.providerId;
      const outcome: NarrationOutcome = result.usedFallback && result.provider !== configuredProvider
        ? "provider_failover"
        : "success";
      emitDiagnostic(sink, {
        kind: "llm",
        category: "success",
        outcome,
        provider: result.provider,
        durationMs,
        turn: snapshot.worldTime,
        worldTime: snapshot.worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome,
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: result.model,
        configuredModel: result.configuredModel,
      });
      return {
        text: guard.narration,
        usedFallback: false,
        fallbackReason: null,
        model: result.model,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      lastCategory = classifyNarrationError(err, null);
      const failure = diagnosticProviderFailure(router, err);

      const isTransient = isTransientNarrationError(lastCategory);
      const isLastAttempt = attempt >= maxAttempts;
      const retryOutcome: RetryOutcome = isLastAttempt && isTransient ? "exhausted" : "none";
      const outcome: NarrationOutcome = isTransient
        ? (isLastAttempt ? "retry_exhausted" : "retrying")
        : "deterministic_fallback";

      emitDiagnostic(sink, {
        kind: "llm",
        category: lastCategory,
        outcome,
        provider: diagnosticProvider(router, err),
        durationMs,
        turn: snapshot.worldTime,
        worldTime: snapshot.worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome,
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: diagnosticField(err, "model"),
        configuredModel: diagnosticField(err, "configuredModel"),
        ...(failure?.phase ? { phase: failure.phase } : {}),
        ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
        ...(failure?.providerCode ? { providerCode: failure.providerCode } : {}),
        timeoutMs: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
      });

      if (!isTransient || isLastAttempt) {
        return {
          text: snapshot.narrativeContext ? personalizedNarrativeText(snapshot, snapshot.narrativeContext) : templateText(snapshot.entries),
          usedFallback: true,
          fallbackReason: "chat_error",
          model: "",
          latencyMs: 0,
        };
      }

      await sleep(retryBaseMs * Math.pow(2, attempt - 1));
    }
  }

  // Unreachable — satisfies TS exhaustiveness
  return {
    text: snapshot.narrativeContext ? personalizedNarrativeText(snapshot, snapshot.narrativeContext) : templateText(snapshot.entries),
    usedFallback: true,
    fallbackReason: "chat_error",
    model: "",
    latencyMs: 0,
  };
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
const GAME_DIRECTOR_PROMPT =
  " Веди игру как мастер, а не как пересказчик: строй ответ из четырёх частей — реакция на реплику игрока, результат или честная причина невозможности, изменение сцены или значимая деталь, естественное продолжение (вопрос или observer-safe возможность из knownContacts, availableRoutes, accessibleItems). " +
  "Соединяй факты, держи голос мастера, подчёркивай последствия, напоминай о ранее известном. " +
  "Запрещено: завершать путешествие без Event; создавать NPC, предметы и знакомства; открывать скрытые локации; превращать hypothesis в truth; решать успешность действия; заканчивать ответ техническим требованием или пересказом локации вместо результата.";
const DND_SYSTEM_PROMPT =
  "Ты — рассказчик тёмного мира в духе D&D. Опиши этот ход художественно, по-русски, 2-4 предложения, в прошедшем времени, с атмосферой. " +
  "Перескажи только факты ниже и результат действия: ничего не придумывай, не выбирай за игрока, не описывай его мысли или будущие намерения. Твоё описание ничего не меняет в симуляции. response.kind обязателен и неизменяем: action_rejection нельзя превращать в успех. Используй только факты с usableNow=true. observedKnowledge описывает память/знание игрока и не является установленной истиной мира. Не превращай testimony, inference или observedKnowledge в established_fact, не создавай предметы, контакты, причины, письма или события. Не упоминай внутренние идентификаторы. " +
  "Ответь ТОЛЬКО одним JSON-объектом без пояснений: {\"narration\": \"связный текст 2-4 предложения\", \"claims\": [{\"text\": \"одно предложение\", \"sourceFactId\": \"<id из переданных групп>\", \"epistemicClass\": \"observed_fact\"}]}. Каждое предложение привяжи к id факта, из которого оно выведено, и укажи класс не выше класса того факта." +
  EPISTEMIC_PROMPT +
  GAME_DIRECTOR_PROMPT;

/**
 * Observer-safe game director slice for the narration prompt (plan_9 §12).
 * Only bounded prose travels: the last replicas, the scene, the result
 * context, allowed facts and uncertainties, the goal, the backstory hook
 * and the affordances the hero really has. No internal ids, coordinates
 * or hidden state. Pure data shaping.
 */
export function gameDirectorPromptSlice(director: GameDirectorContext): Record<string, unknown> {
  return {
    lastPlayerUtterance: director.lastTurns.filter((turn) => turn.speaker === "player").at(-1)?.text ?? null,
    lastTurns: director.lastTurns.slice(-12).map((turn) => ({ speaker: turn.speaker, text: turn.text })),
    currentScene: {
      locationName: director.currentScene.locationName,
      locationDescription: director.currentScene.locationDescription,
      ...(director.currentScene.situationTitle ? { situationTitle: director.currentScene.situationTitle } : {}),
      ...(director.currentScene.situationDescription ? { situationDescription: director.currentScene.situationDescription } : {}),
    },
    activePlayerGoal: director.activePlayerGoal?.summary ?? null,
    currentDramaticThread: director.currentDramaticThread,
    pendingClarification: director.pendingClarification,
    journeyState: { status: director.journeyState.status, text: director.journeyState.text },
    sceneRhythm: director.sceneRhythm,
    masterBrief: {
      whatJustHappened: director.masterBrief.whatJustHappened,
      whatChanged: director.masterBrief.whatChanged,
      whoReacted: director.masterBrief.whoReacted,
      whatIsUrgent: director.masterBrief.whatIsUrgent,
      whatRemainsUncertain: director.masterBrief.whatRemainsUncertain,
      availableLeads: [...director.masterBrief.availableLeads],
      personalConnection: director.masterBrief.personalConnection,
    },
    knownContacts: director.knownContacts.map((entry) => entry.label),
    availableRoutes: director.availableRoutes.map((entry) => ({ label: entry.label, status: entry.status })),
    accessibleItems: director.accessibleItemsAndAffordances.map((entry) => ({ label: entry.label, affordances: [...entry.affordances] })),
    recentConsequences: director.recentConsequences.map((entry) => entry.detail ? `${entry.label}: ${entry.detail}` : entry.label),
    knownFacts: [...director.knownFacts],
    knownUncertainties: [...director.knownUncertainties],
    unresolvedPersonalHook: director.unresolvedPersonalHook,
    ...(director.characterBackground
      ? {
        characterBackground: {
          name: director.characterBackground.name,
          backgroundTitle: director.characterBackground.backgroundTitle,
          formerRole: director.characterBackground.formerRole,
          rupture: director.characterBackground.rupture,
          obligation: director.characterBackground.obligation,
        },
      }
      : {}),
  };
}

/**
 * Allowed-fact vocabulary for the quality guard: every observer-safe
 * line the model was allowed to rephrase. Pure and total.
 */
export function gameDirectorAllowedFacts(
  director: GameDirectorContext,
  turnTexts: readonly string[],
): readonly string[] {
  const facts: string[] = [...turnTexts];
  facts.push(director.currentScene.locationDescription);
  if (director.currentScene.situationDescription) facts.push(director.currentScene.situationDescription);
  facts.push(...director.visibleSituation);
  facts.push(...director.knownFacts);
  facts.push(...director.knownUncertainties);
  for (const entry of director.knownContacts) facts.push(entry.label);
  for (const entry of director.availableRoutes) facts.push(entry.label);
  for (const entry of director.accessibleItemsAndAffordances) facts.push(entry.label);
  if (director.activePlayerGoal) facts.push(director.activePlayerGoal.summary);
  if (director.currentDramaticThread) facts.push(director.currentDramaticThread.title);
  if (director.unresolvedPersonalHook) facts.push(director.unresolvedPersonalHook);
  const rhythm = director.sceneRhythm;
  for (const line of [rhythm.question, rhythm.pressure, rhythm.opportunity, rhythm.inactionCost, rhythm.changeAfterActions, rhythm.completionCondition]) {
    if (line) facts.push(line);
  }
  for (const approach of rhythm.approaches) facts.push(approach);
  const brief = director.masterBrief;
  for (const line of [brief.whatJustHappened, brief.whatChanged, brief.whoReacted, brief.whatIsUrgent, brief.whatRemainsUncertain, brief.personalConnection]) {
    if (line) facts.push(line);
  }
  facts.push(...brief.availableLeads);
  return Object.freeze(facts.filter((line) => line.trim().length > 0));
}

function fallbackNarration(playerAction: string, presentation: TurnPresentation, reason: string, context?: NarrativeAdapterContext): TurnNarration {  return {
    text: personalizedFallback(presentation, playerAction, context),
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
  opts?: NarrationOptions,
): Promise<TurnNarration> {
  const sink = opts?.diagnostics;
  const maxAttempts = router && (router as { managesRetries?: boolean }).managesRetries
    ? 1
    : 1 + retryCount(opts?.maxRetries);
  const retryBaseMs = opts?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const priority = opts?.priority ?? "interactive";

  if (!router || !router.apiKey) {
    emitDiagnostic(sink, {
      kind: "llm",
      category: "no_api_key",
      outcome: "deterministic_fallback",
      provider: router?.providerId ?? "",
      durationMs: 0,
      turn: presentation.worldTime,
      worldTime: presentation.worldTime,
      attempt: 1,
      priority,
      timeout: 0,
      retryOutcome: "none",
      worldId: opts?.worldId,
      recordedAt: new Date().toISOString(),
      correlationId: opts?.correlationId,
    });
    return fallbackNarration(playerAction, presentation, "no_api_key", opts?.narrativeContext);
  }

  const groups = contextFacts(opts?.narrativeContext);
  const facts = [
    { id: "primary", role: "primary", text: presentation.primary?.text && !isGenericActionFallback(presentation.primary.text)
      ? presentation.primary.text
      : actionFallbackText(playerAction, presentation.response?.kind === "action_rejection" ? "rejection" : "outcome"), epistemicClass: presentation.primary?.epistemicClass ?? "observed_fact", sourceEventIds: presentation.primary?.sourceEventIds ?? [] },
    ...presentation.notable.slice(0, 3).map((e, i) => ({ id: `notable-${i}`, role: "notable", text: e.text, epistemicClass: e.epistemicClass, sourceEventIds: e.sourceEventIds })),
  ];
  const guardFacts = asGuardFacts(groups, facts);
  const backgroundFactIds = openingBackgroundFactIds(groups);
  const director = opts?.gameDirector ?? null;

  const userContent = JSON.stringify({
    playerAction,
    response: promptResponse(presentation.response),
    turnFacts: facts.map((f) => ({ id: f.id, role: f.role, text: f.text, epistemicClass: f.epistemicClass })),
    backgroundFacts: groups.backgroundFacts,
    visibleSituation: promptFacts(groups.visibleSituation),
    accessibleItems: promptFacts(groups.accessibleItems),
    knownContacts: promptFacts(groups.knownContacts),
    testimony: promptFacts(groups.testimony),
    hypotheses: promptFacts(groups.hypotheses),
    observedKnowledge: promptFacts(groups.observedKnowledge),
    unresolvedSituation: promptFacts(groups.unresolvedSituation),
    openingWindow: opts?.narrativeContext?.openingWindow === true,
    worldTime: presentation.worldTime,
    playerPosition: presentation.playerPosition,
    ...(director ? { gameDirector: gameDirectorPromptSlice(director) } : {}),
  });

  const messages: ChatMessage[] = [
    { role: "system", content: DND_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  let lastCategory: NarrationErrorCategory = "unknown_provider_error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = performance.now();
    try {
      const result: ChatResult = await router.chat("narrate", messages, {
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(sink ? { diagnostics: sink } : {}),
        ...(opts?.correlationId ? { correlationId: opts.correlationId } : {}),
        worldTime: presentation.worldTime,
        priority,
      });
      const durationMs = Math.round(performance.now() - start);
      const guard = verifyEpistemicNarration(result.text, guardFacts, {
        requireClaims: true,
        ...(opts?.narrativeContext?.openingWindow ? { requireBackgroundLink: true, backgroundFactIds } : {}),
      });
      if (!guard.ok) {
        const category: NarrationErrorCategory = "schema_rejection";
        emitDiagnostic(sink, {
          kind: "llm",
          category,
          outcome: "deterministic_fallback",
          provider: result.provider,
          durationMs,
          turn: presentation.worldTime,
          worldTime: presentation.worldTime,
          attempt,
          priority,
          timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
          retryOutcome: "none",
          worldId: opts?.worldId,
          recordedAt: new Date().toISOString(),
          correlationId: opts?.correlationId,
          model: result.model,
          configuredModel: result.configuredModel,
        });
        // Schema rejection is deterministic — no retry
        return fallbackNarration(playerAction, presentation, `epistemic_violation:${guard.reason}`, opts?.narrativeContext);
      }
      // Game quality guard (plan_9 §13): only when the caller supplied the
      // director context, so legacy callers keep their exact behavior. On
      // rejection the quality deterministic text wins, never an empty stub.
      if (director) {
        const outcomeText = facts.map((fact) => fact.text).join(" ");
        const quality = verifyGameNarration({
          narration: guard.narration,
          playerAction,
          outcomeText,
          allowedFacts: gameDirectorAllowedFacts(director, facts.map((fact) => fact.text)),
        });
        if (!quality.ok) {
          emitDiagnostic(sink, {
            kind: "llm",
            category: "schema_rejection",
            outcome: "deterministic_fallback",
            provider: result.provider,
            durationMs,
            turn: presentation.worldTime,
            worldTime: presentation.worldTime,
            attempt,
            priority,
            timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
            retryOutcome: "none",
            worldId: opts?.worldId,
            recordedAt: new Date().toISOString(),
            correlationId: opts?.correlationId,
            model: result.model,
            configuredModel: result.configuredModel,
          });
          return fallbackNarration(playerAction, presentation, `game_quality_violation:${quality.reason}`, opts?.narrativeContext);
        }
      }
      const retryOutcome: RetryOutcome = attempt > 1 ? "succeeded_on_retry" : "none";
      const configuredProvider = result.configuredProvider ?? router.providerId;
      const outcome: NarrationOutcome = result.usedFallback && result.provider !== configuredProvider
        ? "provider_failover"
        : "success";
      emitDiagnostic(sink, {
        kind: "llm",
        category: "success",
        outcome,
        provider: result.provider,
        durationMs,
        turn: presentation.worldTime,
        worldTime: presentation.worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome,
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: result.model,
        configuredModel: result.configuredModel,
      });
      return {
        text: guard.narration.trim(),
        model: result.model,
        usedFallback: false,
        fallbackReason: null,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      lastCategory = classifyNarrationError(err, null);
      const failure = diagnosticProviderFailure(router, err);

      const isTransient = isTransientNarrationError(lastCategory);
      const isLastAttempt = attempt >= maxAttempts;
      const retryOutcome: RetryOutcome = isLastAttempt && isTransient ? "exhausted" : "none";
      const outcome: NarrationOutcome = isTransient
        ? (isLastAttempt ? "retry_exhausted" : "retrying")
        : "deterministic_fallback";

      emitDiagnostic(sink, {
        kind: "llm",
        category: lastCategory,
        outcome,
        provider: diagnosticProvider(router, err),
        durationMs,
        turn: presentation.worldTime,
        worldTime: presentation.worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome,
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: diagnosticField(err, "model"),
        configuredModel: diagnosticField(err, "configuredModel"),
        ...(failure?.phase ? { phase: failure.phase } : {}),
        ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
        ...(failure?.providerCode ? { providerCode: failure.providerCode } : {}),
        timeoutMs: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
      });

      if (!isTransient || isLastAttempt) {
        return fallbackNarration(playerAction, presentation, "chat_error", opts?.narrativeContext);
      }

      await sleep(retryBaseMs * Math.pow(2, attempt - 1));
    }
  }

  // Unreachable — satisfies TS exhaustiveness
  return fallbackNarration(playerAction, presentation, "chat_error", opts?.narrativeContext);
}

/**
 * Read-side reply kinds that get a safe literary rephrase of an exact answer
 * (full-master Stage 3, "one voice for every reply kind"). Questions and
 * clarifications keep their deterministic text; only a direct answer is
 * rephrased, and only into the same facts.
 */
export type AnswerNarrationKind = "inquiry_answer" | "meta_answer";

/**
 * Kind-aware system prompt: the fixed "2–4 sentences past tense" action frame
 * does not fit a direct answer, so the answer voice is short, present-tense and
 * strictly a rephrase of the exact text already shown.
 */
function answerSystemPrompt(kind: AnswerNarrationKind): string {
  const lead = kind === "inquiry_answer"
    ? "Игрок задал вопрос миру. Ниже — точный ответ, который уже дан."
    : "Игрок попросил пояснение. Ниже — точный ответ, который уже дан.";
  return lead + " Перефразируй ровно этот ответ голосом мастера: естественно и коротко, 1–3 предложения, настоящее время. " +
    "Сохрани смысл, состав и объём ответа: ничего не добавляй, не додумывай, не создавай предметы, людей, места, причины или события, не решай за игрока и не превращай догадку в факт. " +
    "Не упоминай внутренние идентификаторы и технические детали. " +
    "Ответь ТОЛЬКО одним JSON-объектом без пояснений: {\"narration\": \"связный текст 1-3 предложения\", \"claims\": [{\"text\": \"одно предложение\", \"sourceFactId\": \"answer\", \"epistemicClass\": \"observed_fact\"}]}. " +
    "Каждое предложение привяжи к sourceFactId \"answer\" и не повышай класс факта. " +
    EPISTEMIC_PROMPT;
}

function answerFallback(reason: string): TurnNarration {
  return { text: "", model: "", usedFallback: true, fallbackReason: reason, latencyMs: 0 };
}

/**
 * Safe literary rephrase of one exact read-side answer. Non-authoritative:
 * on any failure it returns `usedFallback`, so the caller keeps the exact
 * deterministic answer instead of prose. The epistemic guard receives the
 * answer as its only fact, so the rephrase cannot assert anything new.
 */
export async function narrateAnswerLLM(
  playerQuestion: string,
  answerText: string,
  kind: AnswerNarrationKind,
  worldTime: number,
  router: ModelRouter | null,
  opts?: NarrationOptions,
): Promise<TurnNarration> {
  const sink = opts?.diagnostics;
  const priority = opts?.priority ?? "interactive";
  const answer = answerText.trim();
  if (!answer) return answerFallback("empty_answer");
  if (!router || !router.apiKey) {
    emitDiagnostic(sink, {
      kind: "llm",
      category: "no_api_key",
      outcome: "deterministic_fallback",
      provider: router?.providerId ?? "",
      durationMs: 0,
      turn: worldTime,
      worldTime,
      attempt: 1,
      priority,
      timeout: 0,
      retryOutcome: "none",
      worldId: opts?.worldId,
      recordedAt: new Date().toISOString(),
      correlationId: opts?.correlationId,
    });
    return answerFallback("no_api_key");
  }

  const maxAttempts = 1 + retryCount(opts?.maxRetries);
  const retryBaseMs = opts?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const guardFacts: GuardFact[] = [{ id: "answer", epistemicClass: "observed_fact", source: "answer", usableNow: true }];
  const messages: ChatMessage[] = [
    { role: "system", content: answerSystemPrompt(kind) },
    { role: "user", content: JSON.stringify({ playerQuestion, answer, kind, worldTime }) },
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = performance.now();
    try {
      const result: ChatResult = await router.chat("narrate", messages, {
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(sink ? { diagnostics: sink } : {}),
        ...(opts?.correlationId ? { correlationId: opts.correlationId } : {}),
        worldTime,
        priority,
      });
      const durationMs = Math.round(performance.now() - start);
      const guard = verifyEpistemicNarration(result.text, guardFacts, { requireClaims: true });
      if (!guard.ok) {
        emitDiagnostic(sink, {
          kind: "llm",
          category: "schema_rejection",
          outcome: "deterministic_fallback",
          provider: result.provider,
          durationMs,
          turn: worldTime,
          worldTime,
          attempt,
          priority,
          timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
          retryOutcome: "none",
          worldId: opts?.worldId,
          recordedAt: new Date().toISOString(),
          correlationId: opts?.correlationId,
          model: result.model,
          configuredModel: result.configuredModel,
        });
        return answerFallback(`epistemic_violation:${guard.reason}`);
      }
      emitDiagnostic(sink, {
        kind: "llm",
        category: "success",
        outcome: "success",
        provider: result.provider,
        durationMs,
        turn: worldTime,
        worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome: attempt > 1 ? "succeeded_on_retry" : "none",
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: result.model,
        configuredModel: result.configuredModel,
      });
      return { text: guard.narration.trim(), model: result.model, usedFallback: false, fallbackReason: null, latencyMs: result.latencyMs };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const category = classifyNarrationError(err, null);
      const failure = diagnosticProviderFailure(router, err);
      const isTransient = isTransientNarrationError(category);
      const isLastAttempt = attempt >= maxAttempts;
      emitDiagnostic(sink, {
        kind: "llm",
        category,
        outcome: isTransient ? (isLastAttempt ? "retry_exhausted" : "retrying") : "deterministic_fallback",
        provider: diagnosticProvider(router, err),
        durationMs,
        turn: worldTime,
        worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome: isLastAttempt && isTransient ? "exhausted" : "none",
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: diagnosticField(err, "model"),
        configuredModel: diagnosticField(err, "configuredModel"),
        ...(failure?.phase ? { phase: failure.phase } : {}),
        ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
        ...(failure?.providerCode ? { providerCode: failure.providerCode } : {}),
      });
      if (!isTransient || isLastAttempt) return answerFallback("chat_error");
      await sleep(retryBaseMs * Math.pow(2, attempt - 1));
    }
  }
  return answerFallback("chat_error");
}

/**
 * Assertion strength: a claim may not assert more than the fact it cites.
 * Mirrors the epistemic ladder (established > observed > told > inferred).
 */
const ALLOWED_ASSERTION_STRENGTH: Record<AllowedFactAssertion, number> = {
  established: 3,
  observed: 2,
  told: 1,
  inferred: 0,
};

/** Result of validating a model answer against the closed allowed set (ADR-0037). */
export interface AllowedNarrationVerification {
  readonly ok: boolean;
  readonly narration: string;
  readonly usedRefs: readonly string[];
  readonly reason: string | null;
}

/** True when `assertion` is a known allowed assertion. */
function isAllowedAssertion(value: unknown): value is AllowedFactAssertion {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ALLOWED_ASSERTION_STRENGTH, value);
}

/** Minimum share a declared claim / narration sentence must share with its counterpart. */
const CONSISTENCY_MIN_OVERLAP = 0.6;

/** Lowercased content words (length >= 3) used by the consistency checks. */
function contentWords(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/u).filter((word) => word.length >= 3);
}

/** Share of `words` present in `haystack`. */
function wordOverlap(words: readonly string[], haystack: ReadonlySet<string>): number {
  if (words.length === 0) return 1;
  let hit = 0;
  for (const word of words) if (haystack.has(word)) hit += 1;
  return hit / words.length;
}

/**
 * Structural validation of one composed answer against `AllowedNarrativeFacts`:
 * every cited ref must exist; a claim may not exceed its fact's assertion;
 * mandatory turn results must be covered; internal references are rejected.
 * Semantic grounding is not provable here — negative tests and the live corpus
 * cover it.
 */
export function verifyAllowedNarration(response: string, allowed: AllowedNarrativeFacts): AllowedNarrationVerification {
  const fail = (reason: string): AllowedNarrationVerification => ({ ok: false, narration: "", usedRefs: [], reason });
  let parsed: { narration?: unknown; claims?: unknown; coveredMandatory?: unknown };
  // The model often wraps the object in a markdown fence or prose. Extract the
  // balanced JSON object first — the same contract the legacy narration path
  // already uses — so a wrapping does not become a schema rejection.
  const json = extractJsonObject(response);
  if (!json) return fail("invalid_json");
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return fail("invalid_json");
  }
  const narration = typeof parsed.narration === "string" ? parsed.narration.trim() : "";
  if (!narration) return fail("empty_narration");
  if (INTERNAL_REFERENCE_PATTERN.test(narration)) return fail("internal_reference");

  const byRef = new Map(allowed.facts.map((fact) => [fact.ref, fact]));
  const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
  if (claims.length === 0) return fail("missing_claims");
  const usedRefs: string[] = [];
  const claimTexts: string[] = [];
  for (const raw of claims) {
    if (typeof raw !== "object" || raw === null) return fail("invalid_claim");
    const claim = raw as { text?: unknown; ref?: unknown; assertion?: unknown };
    if (typeof claim.text !== "string" || claim.text.trim().length === 0) return fail("invalid_claim");
    if (typeof claim.ref !== "string" || !byRef.has(claim.ref)) return fail("unknown_ref");
    if (!isAllowedAssertion(claim.assertion)) return fail("invalid_assertion");
    const fact = byRef.get(claim.ref)!;
    if (ALLOWED_ASSERTION_STRENGTH[claim.assertion] > ALLOWED_ASSERTION_STRENGTH[fact.assertion]) return fail("class_upgrade");
    usedRefs.push(claim.ref);
    claimTexts.push(claim.text);
  }
  // The final text must agree with the declared parts: every claim is present
  // in the narration, and every substantive narration sentence is declared by a
  // claim. This is structural — semantic truth stays with the live corpus.
  const narrationWords = new Set(contentWords(narration));
  const claimWordLists = claimTexts.map((text) => contentWords(text));
  const declaredWords = new Set(claimWordLists.flat());
  for (const words of claimWordLists) {
    if (wordOverlap(words, narrationWords) < CONSISTENCY_MIN_OVERLAP) return fail("claim_not_in_narration");
  }
  for (const sentence of narration.split(/(?<=[.!?…])\s+/u)) {
    const words = contentWords(sentence);
    if (words.length < 4) continue;
    if (wordOverlap(words, declaredWords) < CONSISTENCY_MIN_OVERLAP) return fail("undeclared_content");
  }
  const covered = new Set(Array.isArray(parsed.coveredMandatory) ? parsed.coveredMandatory.filter((entry): entry is string => typeof entry === "string") : []);
  if (allowed.mandatory.some((result) => !covered.has(result))) return fail("missing_mandatory");
  return { ok: true, narration, usedRefs, reason: null };
}

/** System prompt for composed answers: only the closed allowed set may be used. */
function allowedAnswerSystemPrompt(): string {
  return "Ты — мастер этого мира. Тебе дан закрытый набор разрешённых сведений (AllowedNarrativeFacts): " +
    "вопрос, список facts (каждый с turn-local ref), mandatory (обязательные результаты хода), continuations и gaps. " +
    "Выбери подмножество facts и порядок, чтобы ответить на реплику: можно выбирать, группировать и упорядочивать элементы набора. " +
    "Нельзя добавлять сведения, менять их доступность, происхождение или epistemic-класс и превращать предположение в установленный факт. " +
    "Все mandatory результаты обязаны быть отражены. Не упоминай внутренние идентификаторы, Event Log, Canon и provenance. " +
    "Ответь ТОЛЬКО одним JSON-объектом без пояснений и без markdown-заборов: " +
    "{\"narration\": \"связный ответ\", \"claims\": [{\"text\": \"одно предложение\", \"ref\": \"f1\", \"assertion\": \"observed\"}], \"coveredMandatory\": [\"<mandatory entry>\"]}. " +
    "Поле ref обязательно и равно ref одного из allowed.facts (f1, f2, …). Не используй sourceFactId/epistemicClass. " +
    "Если mandatory пуст, coveredMandatory может быть []. " +
    "Каждое содержательное предложение привяжи к ref использованного сведения; assertion не может быть сильнее assertion этого сведения.";
}

/**
 * Composed read-side answer over the closed allowed set (ADR-0037). The prompt
 * receives ONLY `AllowedNarrativeFacts` — never the raw `NarrativeAdapterContext`.
 * On any failure it returns `usedFallback`, so the deterministic answer stands.
 */
export async function narrateAllowedAnswerLLM(
  allowed: AllowedNarrativeFacts,
  worldTime: number,
  router: ModelRouter | null,
  opts?: NarrationOptions,
): Promise<TurnNarration> {
  const sink = opts?.diagnostics;
  const priority = opts?.priority ?? "interactive";
  if (allowed.facts.length === 0) return answerFallback("empty_answer");
  if (!router || !router.apiKey) {
    emitDiagnostic(sink, {
      kind: "llm",
      category: "no_api_key",
      outcome: "deterministic_fallback",
      provider: router?.providerId ?? "",
      durationMs: 0,
      turn: worldTime,
      worldTime,
      attempt: 1,
      priority,
      timeout: 0,
      retryOutcome: "none",
      worldId: opts?.worldId,
      recordedAt: new Date().toISOString(),
      correlationId: opts?.correlationId,
    });
    return answerFallback("no_api_key");
  }

  const maxAttempts = 1 + retryCount(opts?.maxRetries);
  const retryBaseMs = opts?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const messages: ChatMessage[] = [
    { role: "system", content: allowedAnswerSystemPrompt() },
    { role: "user", content: JSON.stringify({ allowed }) },
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = performance.now();
    try {
      const result: ChatResult = await router.chat("narrate", messages, {
        ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(sink ? { diagnostics: sink } : {}),
        ...(opts?.correlationId ? { correlationId: opts.correlationId } : {}),
        worldTime,
        priority,
      });
      const durationMs = Math.round(performance.now() - start);
      const verification = verifyAllowedNarration(result.text, allowed);
      if (!verification.ok) {
        // One repair attempt with the exact schema: the model often echoes an
        // older shape (sourceFactId/epistemicClass) on the first call.
        if (attempt < maxAttempts) {
          messages.push({ role: "assistant", content: result.text });
          messages.push({
            role: "user",
            content: `Ответ отклонён (${verification.reason}). Верни ТОЛЬКО JSON вида {"narration":"...","claims":[{"text":"...","ref":"f1","assertion":"observed"}],"coveredMandatory":[]}. ` +
              "Поле ref обязательно и совпадает с ref одного из allowed.facts; assertion не сильнее assertion этого сведения; каждое mandatory должно быть в coveredMandatory. " +
              "Каждое предложение claims входит в narration, и каждое содержательное предложение narration заявлено в claims — без деталей, которых нет в allowed.facts.",
          });
          continue;
        }
        emitDiagnostic(sink, {
          kind: "llm",
          category: "schema_rejection",
          outcome: "deterministic_fallback",
          provider: result.provider,
          durationMs,
          turn: worldTime,
          worldTime,
          attempt,
          priority,
          timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
          retryOutcome: "none",
          worldId: opts?.worldId,
          recordedAt: new Date().toISOString(),
          correlationId: opts?.correlationId,
          model: result.model,
          configuredModel: result.configuredModel,
          failureCategory: `allowed_violation:${verification.reason}`,
        });
        return answerFallback(`allowed_violation:${verification.reason}`);
      }
      emitDiagnostic(sink, {
        kind: "llm",
        category: "success",
        outcome: "success",
        provider: result.provider,
        durationMs,
        turn: worldTime,
        worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome: attempt > 1 ? "succeeded_on_retry" : "none",
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: result.model,
        configuredModel: result.configuredModel,
      });
      return { text: verification.narration, model: result.model, usedFallback: false, fallbackReason: null, latencyMs: result.latencyMs };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const category = classifyNarrationError(err, null);
      const failure = diagnosticProviderFailure(router, err);
      const isTransient = isTransientNarrationError(category);
      const isLastAttempt = attempt >= maxAttempts;
      emitDiagnostic(sink, {
        kind: "llm",
        category,
        outcome: isTransient ? (isLastAttempt ? "retry_exhausted" : "retrying") : "deterministic_fallback",
        provider: diagnosticProvider(router, err),
        durationMs,
        turn: worldTime,
        worldTime,
        attempt,
        priority,
        timeout: opts?.timeoutMs ?? router.timeoutSeconds * 1000,
        retryOutcome: isLastAttempt && isTransient ? "exhausted" : "none",
        worldId: opts?.worldId,
        recordedAt: new Date().toISOString(),
        correlationId: opts?.correlationId,
        model: diagnosticField(err, "model"),
        configuredModel: diagnosticField(err, "configuredModel"),
        ...(failure?.phase ? { phase: failure.phase } : {}),
        ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
        ...(failure?.providerCode ? { providerCode: failure.providerCode } : {}),
      });
      if (!isTransient || isLastAttempt) return answerFallback("chat_error");
      await sleep(retryBaseMs * Math.pow(2, attempt - 1));
    }
  }
  return answerFallback("chat_error");
}
