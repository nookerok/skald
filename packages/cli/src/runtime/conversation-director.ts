/**
 * Conversation Director (SKALD S0 / P3 bridge).
 *
 * Interprets one player replica into a validated `GmTurnDecision` by asking
 * the model with an observer-safe `GmContext`. The Director itself never
 * executes an operation or writes state: the gateway revalidates and routes
 * accepted proposals through the deterministic engine, or persists a bounded
 * zero-event ConversationTurn for pure speech. Shadow mode remains observational.
 */

import { createHash } from "node:crypto";
import type { ChatMessage, ModelRouter } from "@skald/world";
import {
  GM_CONTRACT_VERSION,
  classifyPlayerInput,
  classifyReplicaClauses,
  parseIntent,
  validateGmTurnDecision,
  type ClarificationOption,
  type GmContext,
  type GmTurnDecision,
  type VisibleActorKey,
} from "@skald/intent-parser";
import { GM_DIRECTOR_SYSTEM_PROMPT, buildGmDecisionPrompt } from "../conversation/gm-prompt.js";
import type { GmContextBundle } from "../conversation/gm-context.js";
import type { MasterTurnGatewayOutcome, MasterTurnSnapshot } from "./master-turn-gateway.js";
import { bindSceneSurface } from "./master-turn-validator.js";

/** Sanitized operational trace of one director call (no prompts, no snapshot). */
export interface GmDirectorTrace {
  readonly turnKey: string;
  readonly contractVersion: number;
  readonly decisionKind?: string | undefined;
  readonly addresseeKind?: string | undefined;
  readonly referencedHandles?: readonly string[] | undefined;
  /** Raw model reply validated BEFORE normalization (no aliases applied). */
  readonly rawSchemaValid: boolean;
  /** Valid AFTER the closed alias normalization. */
  readonly schemaValid: boolean;
  /** A decision was accepted and returned to the caller. */
  readonly decisionAccepted: boolean;
  readonly validationErrors: readonly string[];
  readonly providerLatencyMs: number;
  readonly totalLatencyMs: number;
  /** Provider/model that actually answered this call (attribution evidence). */
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** True when the router served a fallback candidate rather than the primary. */
  readonly usedFallback?: boolean | undefined;
  readonly tier?: string | undefined;
  readonly fallbackReason?: string | undefined;
  /** Closed summary of the invalid reply's top-level keys (never free text). */
  readonly replyShape?: string | undefined;
}

export interface GmDirectorInput {
  readonly input: string;
  readonly context: GmContext;
  /** Allowed actor handles for this scene (server-assigned). */
  readonly handleKeys: readonly VisibleActorKey[];
  readonly router: ModelRouter;
  readonly turnKey: string;
  readonly timeoutMs?: number | undefined;
  /**
   * Optional single-flight registry owned by the caller (never a hidden
   * global): concurrent calls with the SAME turnKey share one provider call.
   * Omit it for no dedup (tests, one-shot scripts).
   */
  readonly flight?: GmDirectorFlight | undefined;
}

/**
 * Single-flight registry: turnKey → the in-flight (or just-settled) director
 * call. Owned by the runtime that serves requests; entries are removed as
 * soon as the promise settles, so the map never caches results — it only
 * collapses concurrency.
 */
export type GmDirectorFlight = Map<string, Promise<GmDirectorResult>>;

/** Creates an empty single-flight registry for one runtime/server. */
export function createGmDirectorFlight(): GmDirectorFlight {
  return new Map();
}

export type GmDirectorResult =
  | { readonly status: "decision"; readonly decision: GmTurnDecision; readonly trace: GmDirectorTrace; readonly shared?: boolean }
  | { readonly status: "fallback"; readonly reason: string; readonly trace: GmDirectorTrace; readonly shared?: boolean };

/** Best-effort JSON object extraction from a model reply (never throws). */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Closed normalization of a common model alias (S0): some models return
 * `addressee: "gm"` / `"meta"` instead of the object form the contract
 * requires. Mapping the alias here keeps the validator strict while raising the
 * real schema-hit rate; a bare handle string is NOT an alias and stays invalid.
 */
export function normalizeDecisionShape(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const decision = raw as Record<string, unknown>;
  const addressee = decision["addressee"];
  if (typeof addressee !== "string") return raw;
  const token = addressee.trim().toLowerCase();
  if (token === "gm" || token === "мастер" || token === "master") {
    return { ...decision, addressee: { kind: "gm" } };
  }
  if (token === "meta" || token === "система" || token === "system") {
    return { ...decision, addressee: { kind: "meta" } };
  }
  return raw;
}

/**
 * Single-flight entry point: concurrent calls with the same `turnKey` share
 * ONE provider call (the follower receives the leader's result marked
 * `shared: true` so it can skip duplicate diagnostics). Without a `flight`
 * registry this is a direct pass-through.
 */
export async function interpretGmDecision(input: GmDirectorInput): Promise<GmDirectorResult> {
  const flight = input.flight;
  if (!flight) return interpretGmDecisionOnce(input);
  // Defense in depth: scope by the replica TEXT as well as the caller's
  // turnKey, so one shared registry can never serve the same key to two
  // different requests (cross-world or changed-text collisions).
  const flightKey = `${input.turnKey}|${createHash("sha256").update(input.input).digest("hex").slice(0, 16)}`;
  const existing = flight.get(flightKey);
  if (existing) {
    const shared = await existing;
    return { ...shared, shared: true };
  }
  const leader = interpretGmDecisionOnce(input);
  // Track the SETTLED promise (never rejects in practice: provider errors are
  // mapped to fallbacks) and always release the key on settle.
  const tracked = leader.finally(() => { flight.delete(flightKey); });
  flight.set(flightKey, tracked);
  return tracked;
}

/** Run one director interpretation. Pure side-effect free with respect to the world. */
async function interpretGmDecisionOnce(input: GmDirectorInput): Promise<GmDirectorResult> {
  const started = Date.now();
  // Mutable working copy; frozen into the readonly trace on return.
  const trace: {
    turnKey: string;
    contractVersion: number;
    decisionKind?: string;
    addresseeKind?: string;
    referencedHandles?: string[];
    rawSchemaValid: boolean;
    schemaValid: boolean;
    decisionAccepted: boolean;
    validationErrors: string[];
    providerLatencyMs: number;
    totalLatencyMs: number;
    provider?: string;
    model?: string;
    usedFallback?: boolean;
    tier?: string;
    fallbackReason?: string;
    replyShape?: string;
  } = {
    turnKey: input.turnKey,
    contractVersion: GM_CONTRACT_VERSION,
    rawSchemaValid: false,
    schemaValid: false,
    decisionAccepted: false,
    validationErrors: [],
    providerLatencyMs: 0,
    totalLatencyMs: 0,
  };
  const done = (): GmDirectorTrace => Object.freeze({ ...trace, validationErrors: Object.freeze([...trace.validationErrors]) }) as GmDirectorTrace;
  const fallback = (reason: string): GmDirectorResult => {
    trace.fallbackReason = reason;
    trace.totalLatencyMs = Date.now() - started;
    return { status: "fallback", reason, trace: done() };
  };
  const decided = (decision: GmTurnDecision): GmDirectorResult => {
    trace.totalLatencyMs = Date.now() - started;
    trace.decisionKind = decision.kind;
    trace.addresseeKind = decision.addressee.kind;
    trace.referencedHandles = decision.addressee.kind === "npc" ? [decision.addressee.handle] : [];
    return { status: "decision", decision, trace: done() };
  };

  let replyText = "";
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: GM_DIRECTOR_SYSTEM_PROMPT },
      { role: "user", content: buildGmDecisionPrompt(input.input, input.context) },
    ];
    const before = Date.now();
    const response = await input.router.chat("interpret", messages, {
      dataClass: "player_input",
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      priority: "interactive",
    });
    trace.providerLatencyMs = Date.now() - before;
    // Attribution: which provider/model actually answered (ChatResult fields
    // are sanitized ids, never keys or prompts).
    trace.provider = response.provider;
    trace.model = response.model;
    trace.usedFallback = response.usedFallback;
    if (response.tier !== undefined) trace.tier = response.tier;
    replyText = typeof response.text === "string" ? response.text : "";
  } catch (error) {
    // Provider errors carry sanitized provider/model ids (never keys or
    // bodies); keep them so a failed call still attributes to a candidate.
    const err = error as { provider?: unknown; model?: unknown };
    if (typeof err?.provider === "string") trace.provider = err.provider.slice(0, 40);
    if (typeof err?.model === "string") trace.model = err.model.slice(0, 80);
    return fallback("provider_error");
  }

  const parsed = extractJsonObject(replyText);
  if (!parsed) return fallback("shape:not_json");

  // Raw compliance (no server-side alias applied) vs compliance after the
  // closed normalization; only the normalized form may become a decision.
  const rawValidation = validateGmTurnDecision(parsed, { allowedHandles: input.handleKeys, allowedActorHandles: input.context.actors.map((actor) => actor.handle), allowedFactIds: input.context.knownFacts.map((fact) => fact.factId) });
  trace.rawSchemaValid = rawValidation.ok;

  const normalized = normalizeDecisionShape(parsed);
  const validated = validateGmTurnDecision(normalized, { allowedHandles: input.handleKeys, allowedActorHandles: input.context.actors.map((actor) => actor.handle), allowedFactIds: input.context.knownFacts.map((fact) => fact.factId) });
  trace.schemaValid = validated.ok;
  if (!validated.ok) {
    trace.validationErrors = [...validated.errors];
    trace.replyShape = Object.keys(parsed as Record<string, unknown>).slice(0, 8).join(",");
    return fallback("schema:invalid");
  }
  trace.decisionAccepted = true;
  return decided(validated.decision);
}

/** Shadow-mode flag (S0): the director runs but the legacy path alone executes. */
export function gmDirectorShadowEnabled(): boolean {
  const value = process.env["GM_DIRECTOR_SHADOW"];
  return value === "1" || value === "true" || value === "on";
}

/** Live-conversation flag (P3): the director may translate decisions into gateway outcomes. */
export function gmDirectorLiveEnabled(): boolean {
  const value = process.env["GM_DIRECTOR_LIVE"];
  return value === "1" || value === "true" || value === "on";
}

const REPEAT_REQUEST_PATTERN = /(?:повтори|повторить|скажи\s+заново|скажи\s+еще\s+раз|что\s+ты\s+(?:только\s+что\s+|сейчас\s+)?(?:сказал|говорил|ответил))/iu;
const EXPLICIT_SPEECH_DIRECTIVE = /^(?:спроси|спросить|спрошу|спросишь|спросит|спросим|скажи|сказать|обратись|обратиться|позови|позвать|окликни|окликнуть)\b/iu;

/**
 * Read-only P3 adapter. Structured action/question proposals are bound and
 * validated by the gateway through the existing V2 pipeline, not here.
 * Clarifications expose only scene-allowed candidates; conversation drafts
 * render a closed fact selection or non-factual social acts without a second
 * model call. NPC knowledge/disclosure remains a separate P4/P5 capability.
 */
export function applyGmDirectorDecision(
  decision: GmTurnDecision,
  bundle: GmContextBundle,
  input: string,
  snapshot: MasterTurnSnapshot,
): MasterTurnGatewayOutcome | null {
  const revision = Object.freeze({
    worldTime: snapshot.world.time,
    eventNumber: snapshot.world.eventNumber,
  });
  const clauses = classifyReplicaClauses(input, parseIntent);
  const singleInquiry = clauses.actions.length === 0
    && clauses.unknown.length === 0
    && clauses.inquiries.length === 1
    ? clauses.inquiries[0]!.inquiry
    : null;

  const resolveHandlePerson = (handle: VisibleActorKey | undefined) => {
    if (!handle) return null;
    const observerRef = bundle.handleToObserverRef.get(handle);
    if (!observerRef) return null;
    const person = snapshot.scene.context.knownPeople.find((entry) => entry.observerRef === observerRef);
    if (!person) return null;
    return { observerRef: person.observerRef, label: person.label };
  };

  const asReadOnlyInquiry = (subjectHandle?: VisibleActorKey): MasterTurnGatewayOutcome | null => {
    if (!singleInquiry) return null;
    const subject = subjectHandle ? resolveHandlePerson(subjectHandle) : null;
    if (subjectHandle && !subject) return null;
    if (subjectHandle) {
      const explicitFocus = singleInquiry.focus?.surface;
      if (!explicitFocus) return null;
      const boundFocus = bindSceneSurface(explicitFocus, snapshot.scene.context.knownPeople.map((person) => ({
        observerRef: person.observerRef,
        label: person.label,
        knownAs: person.knownAs,
        addressForms: person.portrait?.addressForms ?? [],
      })));
      if (boundFocus.status !== "unique" || boundFocus.entry.observerRef !== subject?.observerRef) return null;
    }
    return {
      status: "inquiry",
      inquiry: Object.freeze({
        ...singleInquiry,
        rawText: input,
        source: "llm" as const,
        ...(subject
          ? { focus: Object.freeze({ observerRef: subject?.observerRef, surface: subject.label }) }
          : {}),
      }),
    };
  };

  if (decision.kind === "clarification" && decision.clarification) {
    const unsupportedAction = clauses.actions.some(({ intent }) =>
      intent.type !== "ActionIntentCommand" || (intent.operation !== "speak" && intent.operation !== "call"));
    if (unsupportedAction || clauses.inquiries.length > 1) return null;
    const question = decision.clarification.question.trim();
    // Do not forward malformed or internal-looking text into the player UI.
    if (!question || question.length > 360 || /(?:person|object|route|location)_[a-z0-9_-]+|\be[a-f0-9]{12}\b/iu.test(question)) return null;
    const handles = decision.clarification.candidateHandles ?? [];
    if (new Set(handles).size !== handles.length) return null;
    const candidates: { readonly handle: VisibleActorKey; readonly observerRef: string; readonly label: string; readonly description: string }[] = [];
    for (const handle of handles) {
      const person = resolveHandlePerson(handle);
      if (!person) return null;
      const actor = bundle.context.actors.find((entry) => entry.handle === handle);
      candidates.push({
        handle,
        observerRef: person.observerRef,
        label: person.label,
        description: actor?.visibleDescription.trim() ?? "",
      });
    }
    const labelCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const key = candidate.label.trim().toLowerCase().replace(/ё/gu, "е");
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
    const options: ClarificationOption[] = candidates.map((candidate, index) => {
      const key = candidate.label.trim().toLowerCase().replace(/ё/gu, "е");
      const duplicate = (labelCounts.get(key) ?? 0) > 1;
      const sameDescription = candidates.filter((other) => other.label === candidate.label && other.description === candidate.description).length > 1;
      const label = duplicate
        ? candidate.description && !sameDescription
          ? candidate.label + " — " + candidate.description
          : candidate.label + " (вариант " + (index + 1) + ")"
        : candidate.label;
      return Object.freeze({
        optionId: "candidate-" + (index + 1),
        label,
        referentRefs: Object.freeze([candidate.observerRef]),
      });
    });
    options.push(Object.freeze({ optionId: "rephrase", label: "Уточнить намерение" }));
    return { status: "clarification", question, options: Object.freeze(options) };
  }

  if (decision.kind === "world_question") {
    // The legacy inquiry adapter must not turn a free-form "who" question
    // into a place-knowledge dump just because clause classification found
    // that broad registered query. Let the gateway clarify instead.
    if (singleInquiry?.queryId === "known_place_knowledge"
      && /^(?:а\s+)?(?:кто|кого|кому|кем)\b/iu.test(input.trim())) return null;
    return asReadOnlyInquiry(decision.subjectHandle);
  }

  if (decision.kind === "conversation" && decision.response) {
    // A draft cannot erase a deterministically understood question/action.
    // Keep the same whole-replica discipline as the V2 proposal path.
    if (singleInquiry) return asReadOnlyInquiry();
    const classification = classifyPlayerInput(input, parseIntent);
    const explicitSpeechAction = clauses.actions.some(({ intent }) =>
      intent.type === "ActionIntentCommand" && (intent.operation === "speak" || intent.operation === "call"));
    if (explicitSpeechAction && EXPLICIT_SPEECH_DIRECTIVE.test(input.trim())) return null;
    if (classification.kind === "inquiry_candidate") {
      const hasBoundAnswer = decision.response.segments.length > 0
        && decision.response.segments.every((segment) => segment.kind === "fact"
          || (segment.kind === "social" && segment.act === "no_knowledge"));
      if (decision.addressee.kind !== "gm" || !hasBoundAnswer) return null;
    }
    if (clauses.inquiries.length > 0 || clauses.actions.some(({ intent }) =>
      intent.type !== "ActionIntentCommand" || (intent.operation !== "unknown" && intent.operation !== "speak" && intent.operation !== "call"))) return null;
    const speaker = decision.addressee.kind === "npc" ? resolveHandlePerson(decision.addressee.handle) : null;
    if (decision.addressee.kind === "npc" && !speaker) return null;
    const phrases = {
      greeting: "Здравствуй.",
      farewell: "До встречи.",
      thanks: "Спасибо.",
      acknowledge: "Я тебя слышу.",
      ask_topic: "О чём ты хочешь поговорить?",
      no_knowledge: "У меня нет подтверждённых сведений об этом.",
      no_commitment: "Я не могу обещать, что это будет сделано.",
    } as const;
    const parts: string[] = [];
    for (const segment of decision.response.segments) {
      if (segment.kind === "social") parts.push(phrases[segment.act]);
      else {
        if (speaker) return null; // NPC knowledge needs P4/P5 disclosure.
        const fact = bundle.context.knownFacts.find((entry) => entry.factId === segment.factId);
        if (!fact) return null;
        parts.push(fact.text);
      }
    }
    const text = parts.join(" ");
    if (!text || /(?:person|object|route|location)_[a-z0-9_-]+|\be[a-f0-9]{12}\b/iu.test(text)) return null;
    const reference = speaker ? snapshot.scene.references.get(speaker.observerRef) : null;
    if (speaker && !reference) return null;
    return {
      status: "conversation",
      text: speaker ? speaker.label + ": «" + text + "»" : text,
      revision,
      ...(speaker && reference ? { speaker: { observerRef: speaker.observerRef, label: speaker.label, internalId: reference.internalId } } : {}),
    };
  }

  if (decision.kind === "conversation" && (decision.addressee.kind === "gm" || decision.addressee.kind === "meta")) {
    if (REPEAT_REQUEST_PATTERN.test(input.toLowerCase().replace(/ё/gu, "е"))) {
      return {
        status: "plan",
        plan: Object.freeze({
          contextRevision: revision,
          kind: "meta" as const,
          execution: null,
          postActionInquiries: Object.freeze([]),
          metaInquiry: Object.freeze({ type: "MetaRequest" as const, operation: "repeat_last_answer" as const }),
          deferredClauses: Object.freeze([]),
          focus: Object.freeze([]),
          goal: null,
          conversationRelation: null,
        }),
        scene: snapshot.scene,
      };
    }
    return asReadOnlyInquiry();
  }

  return null;
}
