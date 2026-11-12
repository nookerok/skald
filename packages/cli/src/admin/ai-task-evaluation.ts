/**
 * Operator-triggered task evaluation for one freshly screened OpenCode model.
 *
 * Daily marker probes answer only "can this route return a response". This
 * module evaluates the real Conversation Director and allowed-facts narration
 * path against fixed, versioned tasks. It never changes serving routes,
 * Projection, or the Event Log.
 */

import { createHash } from "node:crypto";
import {
  buildAllowedAnswerMessages,
  buildAllowedNarrativeFacts,
  fetchOpenCodeCatalog,
  narrateAllowedAnswerLLM,
  ProviderRequestError,
  type AllowedNarrativeFacts,
  type OpenCodeCatalogModel,
  type OpenCodeCatalogReport,
  type RouteCandidate,
  type Category,
  type ChatCandidateOptions,
  type ChatMessage,
  type ChatResult,
} from "@skald/world";
import type { MasterConversationContext } from "../conversation/context-builder.js";
import { buildGmContext } from "../conversation/gm-context.js";
import { buildGmDecisionPrompt, GM_DIRECTOR_SYSTEM_PROMPT } from "../conversation/gm-prompt.js";
import { scoreGmCorpus, type GmScoreEntry } from "../conversation/gm-scorecard.js";
import { interpretGmDecision } from "../runtime/conversation-director.js";
import {
  OPENCODE_RUN_DEFAULT_AGENT,
  OPENCODE_RUN_DEFAULT_BINARY,
  OPENCODE_RUN_PROVIDER_ID,
  OpenCodeRunProvider,
  isOpenCodeRunEnabled,
} from "../runtime/opencode-run-provider.js";
import {
  buildGmFixtureScene,
  GM_CORPUS,
  GM_CORPUS_VERSION,
  expectedCandidateHandles,
  expectedNpcHandle,
  expectedSubjectHandle,
  type GmFixture,
} from "../acceptance/gm-corpus.js";
import { corpusConfigErrors } from "../acceptance/scorecard-env.js";
import {
  AI_DISCOVERY_DEFAULT_REGION,
  AI_DISCOVERY_REGION_ENV,
  isOpenCodeModelAvailableInRegion,
  loadDiscoveryServiceEnvironment,
} from "./ai-model-discovery.js";

export const AI_TASK_EVALUATION_SCHEMA = "SKALD_AI_TASK_EVALUATION_V1" as const;
export const AI_TASK_EVALUATION_CORPUS_VERSION = "ai-task-corpus-v1" as const;
export const AI_TASK_EVALUATION_TIMEOUT_MS = 15_000;
export const AI_TASK_EVALUATION_MAX_DURATION_MS = 12 * 60_000;
export const AI_TASK_EVALUATION_MAX_PROVIDER_CALLS = 48;

export type AITaskEvaluationStatus = "complete" | "partial" | "blocked" | "failed";

export interface AITaskEvaluationCase {
  readonly id: string;
  readonly question: string;
  readonly facts: readonly {
    readonly content: string;
    readonly provenance: "observation" | "testimony" | "background" | "hypothesis";
    readonly assertion: "established" | "observed" | "told" | "inferred";
  }[];
  readonly mandatory: readonly string[];
  /** Closed unsupported details used only as a conservative screen. */
  readonly forbiddenPhrases: readonly string[];
}

export const AI_TASK_NARRATION_CORPUS: readonly AITaskEvaluationCase[] = Object.freeze([
  {
    id: "landing-boat",
    question: "Что видно у переправы?",
    facts: [
      { content: "У переправы стоит деревянная лодка.", provenance: "observation", assertion: "observed" },
      { content: "Перевозчик держит лодку у настила.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["У переправы стоит деревянная лодка."],
    forbiddenPhrases: ["перевозит героя", "отплывает", "улыбается"],
  },
  {
    id: "gate-journal",
    question: "Чем занят смотритель?",
    facts: [
      { content: "Смотритель ведёт журнал проходов у ворот.", provenance: "observation", assertion: "observed" },
      { content: "У его пояса висит связка ключей.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Смотритель ведёт журнал проходов у ворот."],
    forbiddenPhrases: ["впускает", "отказывает", "узнаёт героя"],
  },
  {
    id: "closed-door-key",
    question: "Что находится у двери?",
    facts: [
      { content: "Дверь за стойкой закрыта.", provenance: "observation", assertion: "observed" },
      { content: "На стойке лежит серебряный ключ.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Дверь за стойкой закрыта."],
    forbiddenPhrases: ["ключ подходит", "дверь открывается", "герой берёт ключ"],
  },
  {
    id: "wet-road",
    question: "В каком состоянии дорога?",
    facts: [
      { content: "Дорога у северных ворот покрыта грязью.", provenance: "observation", assertion: "observed" },
      { content: "На дороге видны свежие следы телеги.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Дорога у северных ворот покрыта грязью."],
    forbiddenPhrases: ["следы ведут", "телега направилась", "кто-то уехал"],
  },
  {
    id: "unlit-lantern",
    question: "Что с фонарём?",
    facts: [
      { content: "Фонарь у стены погас.", provenance: "observation", assertion: "observed" },
      { content: "Рядом с фонарём лежит обрывок фитиля.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Фонарь у стены погас."],
    forbiddenPhrases: ["его погасили", "кто-то зажёг", "в комнате темно"],
  },
  {
    id: "river-level",
    question: "Как выглядит река?",
    facts: [
      { content: "Вода поднялась до нижней кромки настила.", provenance: "observation", assertion: "observed" },
      { content: "Течение у берега быстрое.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Вода поднялась до нижней кромки настила."],
    forbiddenPhrases: ["вот-вот затопит", "река разлилась", "плотину прорвало"],
  },
  {
    id: "empty-stall",
    question: "Что осталось на прилавке?",
    facts: [
      { content: "Прилавок пуст.", provenance: "observation", assertion: "observed" },
      { content: "На дереве заметны круглые следы от чашек.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Прилавок пуст."],
    forbiddenPhrases: ["купец ушёл", "чашки забрали", "торговля закончилась"],
  },
  {
    id: "rope-at-pier",
    question: "Что у края причала?",
    facts: [
      { content: "У края причала привязана толстая верёвка.", provenance: "observation", assertion: "observed" },
      { content: "Свободный конец верёвки лежит на досках.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["У края причала привязана толстая верёвка."],
    forbiddenPhrases: ["верёвка оборвалась", "лодка уплыла", "кто-то привязал лодку"],
  },
  {
    id: "footprints-by-gate",
    question: "Что заметно у ворот?",
    facts: [
      { content: "У ворот в пыли видны два ряда следов.", provenance: "observation", assertion: "observed" },
      { content: "Следы обрываются у каменной стены.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Следы обрываются у каменной стены."],
    forbiddenPhrases: ["следы исчезают из-за магии", "человек перелез", "следы принадлежат"],
  },
  {
    id: "rain-and-window",
    question: "Что происходит у окна?",
    facts: [
      { content: "Дождь стучит по закрытым ставням.", provenance: "observation", assertion: "observed" },
      { content: "На подоконнике лежит сухая тряпка.", provenance: "observation", assertion: "observed" },
    ],
    mandatory: ["Дождь стучит по закрытым ставням."],
    forbiddenPhrases: ["кто-то закрыл ставни", "тряпкой вытерли", "внутри тепло"],
  },
]);

export interface AITaskEvaluationReport {
  readonly schema: typeof AI_TASK_EVALUATION_SCHEMA;
  readonly status: AITaskEvaluationStatus;
  readonly machineVerdict: "pass" | "fail" | "incomplete" | "blocked";
  /** Human review is mandatory: structural grounding is not semantic proof. */
  readonly humanReview: "required";
  readonly failureCode?: "environment_invalid" | "native_transport_disabled" | "credential_missing" | "candidate_not_free" | "region_restricted" | "catalog_failed" | "corpus_invalid" | "run_time_budget" | "provider_call_budget" | "runner_error";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly actualCommit: string | null;
  readonly evidence: {
    readonly discoveryRunId: string;
    readonly discoveryReportSha256: string;
    readonly decisionId: string;
    readonly candidateId: string;
    readonly region: string;
    readonly catalogDigest: string;
    readonly corpusVersion: typeof AI_TASK_EVALUATION_CORPUS_VERSION;
    readonly corpusDigest: string;
    readonly directorPromptSha256: string;
    readonly narrationPromptSha256: string;
  };
  readonly policy: {
    readonly maxConcurrency: 1;
    readonly maxProviderCalls: number;
    readonly providerCallCount: number;
    readonly timeoutMs: number;
    readonly maxDurationMs: number;
    readonly transport: "opencode_cli";
  };
  readonly director: {
    readonly corpusVersion: string;
    readonly corpusSize: number;
    readonly passed: boolean;
    readonly score: ReturnType<typeof scoreGmCorpus> | null;
  };
  readonly narration: {
    readonly corpusVersion: typeof AI_TASK_EVALUATION_CORPUS_VERSION;
    readonly corpusSize: number;
    readonly passed: number;
    readonly cases: readonly {
      readonly id: string;
      readonly passed: boolean;
      readonly allowedFactsGuard: "pass" | "fail";
      readonly russianForm: "pass" | "fail";
      readonly unsupportedTerms: "pass" | "fail";
      readonly modelMatch: boolean;
      readonly providerCalls: number;
      readonly latencyMs: number;
      /** Only retained after the production allowed-facts verifier accepts it. */
      readonly verifiedPreview?: string;
      readonly fallbackCode?: string;
    }[];
  };
}

export interface AITaskEvaluationInput {
  readonly decisionId: string;
  readonly discoveryRunId: string;
  readonly discoveryReportSha256: string;
  readonly candidateId: string;
  readonly actualCommit: string | null;
  readonly region?: string;
}

export interface AITaskEvaluationOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly catalog?: OpenCodeCatalogReport;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly timeoutMs?: number;
  readonly maxDurationMs?: number;
}

const RUSSIAN_SENTENCE_MAX = 4;
const VERIFIED_PREVIEW_MAX_CHARS = 600;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function conversationOf(fixture: GmFixture): MasterConversationContext {
  return {
    schemaVersion: 1,
    recentTurns: fixture.recentTurns,
    recentFocus: [],
    pendingClarification: null,
    lastTurns: fixture.recentTurns.map((turn) => ({ speaker: turn.speaker, text: turn.text, turnSeq: turn.turnSeq })),
    currentScene: null,
    recentlyMentionedEntities: [],
  } as unknown as MasterConversationContext;
}

function gmExpectation(fixture: GmFixture, allowedHandles: readonly string[]): GmScoreEntry["expected"] {
  const expectedKind = fixture.expected.kind as GmScoreEntry["expected"]["kind"];
  const expectedAddressee = fixture.expected.addresseeKind === "npc" ? "npc"
    : expectedKind === "clarification" ? "gm" : fixture.expected.addresseeKind as "gm" | "meta";
  return {
    addresseeKind: expectedAddressee,
    kind: expectedKind,
    allowedHandles,
    expectedHandle: expectedNpcHandle(fixture),
    expectedSubjectHandle: expectedSubjectHandle(fixture),
    expectedQueryId: fixture.expected.queryId,
    expectedCandidateHandles: expectedCandidateHandles(fixture),
  };
}

function prepareDirectorCorpus(): readonly {
  readonly fixture: GmFixture;
  readonly context: ReturnType<typeof buildGmContext>["context"];
  readonly allowedHandles: readonly string[];
  readonly contextJson: string;
  readonly userPrompt: string;
}[] {
  return Object.freeze(GM_CORPUS.map((fixture) => {
    const bundle = buildGmContext({ scene: buildGmFixtureScene(fixture), conversation: conversationOf(fixture) });
    const allowedHandles = Object.freeze([...bundle.handleToObserverRef.keys()]);
    return Object.freeze({
      fixture,
      context: bundle.context,
      allowedHandles,
      contextJson: JSON.stringify(bundle.context),
      userPrompt: buildGmDecisionPrompt(fixture.input, bundle.context),
    });
  }));
}

function allowedFactsFor(entry: AITaskEvaluationCase): AllowedNarrativeFacts {
  return buildAllowedNarrativeFacts({
    question: entry.question,
    extraFacts: entry.facts,
    mandatory: entry.mandatory,
  });
}

function promptDigests(): { readonly director: string; readonly narration: string; readonly corpus: string } {
  const director = prepareDirectorCorpus();
  const narration = AI_TASK_NARRATION_CORPUS.map((entry) => {
    const allowed = allowedFactsFor(entry);
    return { id: entry.id, messages: buildAllowedAnswerMessages(allowed) };
  });
  const directorPromptSha256 = sha256(GM_DIRECTOR_SYSTEM_PROMPT);
  const narrationPromptSha256 = sha256(narration.map((entry) => JSON.stringify(entry.messages)).join("\n"));
  const corpusDigest = sha256(JSON.stringify({
    version: AI_TASK_EVALUATION_CORPUS_VERSION,
    gmCorpusVersion: GM_CORPUS_VERSION,
    gmCorpus: GM_CORPUS,
    directorSystemPrompt: GM_DIRECTOR_SYSTEM_PROMPT,
    directorPrompts: director.map((entry) => ({ id: entry.fixture.id, prompt: entry.userPrompt })),
    narrationCorpus: AI_TASK_NARRATION_CORPUS,
    narrationMessages: narration,
  }));
  return { director: directorPromptSha256, narration: narrationPromptSha256, corpus: corpusDigest };
}

function catalogCandidate(catalog: OpenCodeCatalogReport, candidateId: string): OpenCodeCatalogModel | null {
  return catalog.status === "ok"
    ? catalog.models?.find((model) => model.id === candidateId) ?? null
    : null;
}

function eligibleNow(model: OpenCodeCatalogModel | null): model is OpenCodeCatalogModel {
  return model !== null
    && model.type === "chat"
    && model.inputModalities.includes("text")
    && model.outputModalities.includes("text")
    && model.apiFamilies.includes("chat-completions")
    && model.zeroPriceTextChat === true
    && model.textInputPrice === 0
    && model.textOutputPrice === 0
    && !model.hasConditionalTextPricing
    && model.clientRestriction === "opencode_cli";
}

class CountingOpenCodeRunProvider extends OpenCodeRunProvider {
  private calls = 0;

  get providerCallCount(): number {
    return this.calls;
  }

  override async chatCandidate(
    category: Category,
    candidate: RouteCandidate,
    messages: readonly ChatMessage[],
    opts?: ChatCandidateOptions,
  ): Promise<ChatResult> {
    if (candidate.provider !== OPENCODE_RUN_PROVIDER_ID) {
      throw new ProviderRequestError({
        provider: OPENCODE_RUN_PROVIDER_ID,
        model: candidate.model,
        category,
        phase: "configuration",
        reason: "task evaluation route escaped native transport",
        retryable: false,
      });
    }
    if (this.calls >= AI_TASK_EVALUATION_MAX_PROVIDER_CALLS) {
      throw new ProviderRequestError({
        provider: OPENCODE_RUN_PROVIDER_ID,
        model: candidate.model,
        category,
        phase: "configuration",
        reason: "task evaluation provider-call budget exceeded",
        retryable: false,
      });
    }
    this.calls += 1;
    return super.chatCandidate(category, candidate, messages, opts);
  }
}

function createPinnedRouter(candidateId: string, env: NodeJS.ProcessEnv): CountingOpenCodeRunProvider {
  const model = "opencode/" + candidateId;
  const candidate: RouteCandidate = Object.freeze({
    provider: OPENCODE_RUN_PROVIDER_ID,
    model,
    protocol: "opencode_run",
    tier: "catalog_candidate",
  });
  return new CountingOpenCodeRunProvider({
    providerId: OPENCODE_RUN_PROVIDER_ID,
    // Native CLI authentication is supplied through the sanitized child env;
    // this non-secret sentinel only satisfies the narration wrapper's
    // "router configured" check and is never sent to a provider.
    apiKey: "native-cli",
    availableProviders: [OPENCODE_RUN_PROVIDER_ID],
    routeCandidates: { interpret: [candidate], narrate: [candidate] },
    timeoutMs: AI_TASK_EVALUATION_TIMEOUT_MS,
    opencodeRun: {
      binary: env.SKALD_OPENCODE_BIN ?? OPENCODE_RUN_DEFAULT_BINARY,
      agent: env.SKALD_OPENCODE_RUN_AGENT ?? OPENCODE_RUN_DEFAULT_AGENT,
      model,
      agentManifestPath: env.SKALD_OPENCODE_AGENT_MANIFEST,
      isolateHome: true,
      cleanupSession: true,
      env,
    },
  });
}

function russianFormPass(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  const russian = text.match(/[а-яё]/giu) ?? [];
  const sentences = text.trim().split(/(?<=[.!?…])\s+/u).filter(Boolean);
  return letters.length >= 20
    && russian.length / letters.length >= 0.6
    && sentences.length >= 1
    && sentences.length <= RUSSIAN_SENTENCE_MAX
    && text.length <= VERIFIED_PREVIEW_MAX_CHARS;
}

function unsupportedTermsPass(text: string, forbidden: readonly string[]): boolean {
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е");
  if (/(?:person|object|route|location)_[a-z0-9_-]+|\b(?:targetRef|locationId|internalId|observerRef)\b/iu.test(text)) return false;
  return forbidden.every((term) => !normalized.includes(term.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е")));
}

function emptyDirectorScore(): ReturnType<typeof scoreGmCorpus> {
  return scoreGmCorpus([]);
}

function baseReport(input: AITaskEvaluationInput, now: () => Date, startedAt: string, failureCode: AITaskEvaluationReport["failureCode"], catalogDigest = ""): AITaskEvaluationReport {
  const digests = promptDigests();
  const finishedAt = now().toISOString();
  return {
    schema: AI_TASK_EVALUATION_SCHEMA,
    status: failureCode === "run_time_budget" || failureCode === "provider_call_budget" ? "partial" : "blocked",
    machineVerdict: failureCode === "run_time_budget" || failureCode === "provider_call_budget" ? "incomplete" : "blocked",
    humanReview: "required",
    ...(failureCode ? { failureCode } : {}),
    startedAt,
    finishedAt,
    actualCommit: input.actualCommit,
    evidence: {
      discoveryRunId: input.discoveryRunId,
      discoveryReportSha256: input.discoveryReportSha256,
      decisionId: input.decisionId,
      candidateId: input.candidateId,
      region: input.region ?? AI_DISCOVERY_DEFAULT_REGION,
      catalogDigest,
      corpusVersion: AI_TASK_EVALUATION_CORPUS_VERSION,
      corpusDigest: digests.corpus,
      directorPromptSha256: digests.director,
      narrationPromptSha256: digests.narration,
    },
    policy: {
      maxConcurrency: 1,
      maxProviderCalls: AI_TASK_EVALUATION_MAX_PROVIDER_CALLS,
      providerCallCount: 0,
      timeoutMs: AI_TASK_EVALUATION_TIMEOUT_MS,
      maxDurationMs: AI_TASK_EVALUATION_MAX_DURATION_MS,
      transport: "opencode_cli",
    },
    director: {
      corpusVersion: GM_CORPUS_VERSION,
      corpusSize: GM_CORPUS.length,
      passed: false,
      score: emptyDirectorScore(),
    },
    narration: {
      corpusVersion: AI_TASK_EVALUATION_CORPUS_VERSION,
      corpusSize: AI_TASK_NARRATION_CORPUS.length,
      passed: 0,
      cases: [],
    },
  };
}

/**
 * Evaluate one previously nominated candidate against current public pricing,
 * the fixed Director corpus, and ten closed-facts Russian narration packs.
 * It is deliberately operator-triggered, sequential, and never changes a
 * serving route. The report is machine evidence only; human prose review stays
 * required before a candidate is considered task-valid.
 */
export async function evaluateOpenCodeTaskCandidate(
  input: AITaskEvaluationInput,
  options: AITaskEvaluationOptions = {},
): Promise<AITaskEvaluationReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const env = { ...(options.env ?? process.env) };
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const timeoutMs = Math.max(1_000, Math.min(30_000, Math.floor(options.timeoutMs ?? AI_TASK_EVALUATION_TIMEOUT_MS)));
  const maxDurationMs = Math.max(10_000, Math.min(15 * 60_000, Math.floor(options.maxDurationMs ?? AI_TASK_EVALUATION_MAX_DURATION_MS)));
  const deadline = monotonicNow() + maxDurationMs;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/u.test(input.candidateId)) {
    return baseReport(input, now, startedAt, "candidate_not_free");
  }
  if (!loadDiscoveryServiceEnvironment(env).ok) {
    const fallbackRegion = input.region ?? (env[AI_DISCOVERY_REGION_ENV] ?? AI_DISCOVERY_DEFAULT_REGION).trim().toUpperCase();
    return baseReport({ ...input, region: fallbackRegion }, now, startedAt, "environment_invalid");
  }
  const region = /^[A-Za-z]{2}$/u.test((env[AI_DISCOVERY_REGION_ENV] ?? AI_DISCOVERY_DEFAULT_REGION).trim())
    ? (env[AI_DISCOVERY_REGION_ENV] ?? AI_DISCOVERY_DEFAULT_REGION).trim().toUpperCase()
    : AI_DISCOVERY_DEFAULT_REGION;
  const evaluationInput = { ...input, region };
  if (!isOpenCodeRunEnabled(env)) return baseReport(evaluationInput, now, startedAt, "native_transport_disabled");
  if (!(env.OPENCODE_API_KEY || env.SKALD_OPENCODE_ZEN_API_KEY)) return baseReport(evaluationInput, now, startedAt, "credential_missing");
  if (corpusConfigErrors(GM_CORPUS).length > 0) return baseReport(evaluationInput, now, startedAt, "corpus_invalid");

  let catalog: OpenCodeCatalogReport;
  try {
    catalog = options.catalog ?? await fetchOpenCodeCatalog({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  } catch {
    return baseReport(evaluationInput, now, startedAt, "catalog_failed");
  }
  const modelMetadata = catalogCandidate(catalog, input.candidateId);
  if (catalog.status !== "ok" || !catalog.catalogDigest) return baseReport(evaluationInput, now, startedAt, "catalog_failed");
  if (!isOpenCodeModelAvailableInRegion(input.candidateId, region)) {
    return baseReport(evaluationInput, now, startedAt, "region_restricted", catalog.catalogDigest);
  }
  if (!eligibleNow(modelMetadata)) return baseReport(evaluationInput, now, startedAt, "candidate_not_free", catalog.catalogDigest);

  const router = createPinnedRouter(input.candidateId, env);
  const preparedDirector = prepareDirectorCorpus();
  const directorEntries: GmScoreEntry[] = [];
  for (const item of preparedDirector) {
    if (monotonicNow() >= deadline) {
      const report = baseReport(evaluationInput, now, startedAt, "run_time_budget", catalog.catalogDigest);
      return {
        ...report,
        evidence: { ...report.evidence, corpusDigest: promptDigests().corpus },
        policy: { ...report.policy, timeoutMs, maxDurationMs, providerCallCount: router.providerCallCount },
        director: { ...report.director, score: scoreGmCorpus(directorEntries) },
      };
    }
    const result = await interpretGmDecision({
      input: item.fixture.input,
      context: item.context,
      handleKeys: item.allowedHandles,
      router,
      turnKey: "task-eval-" + item.fixture.id,
      timeoutMs: Math.min(timeoutMs, Math.max(1_000, Math.floor(deadline - monotonicNow()))),
    });
    directorEntries.push({
      input: item.fixture.id,
      expected: gmExpectation(item.fixture, item.allowedHandles),
      contextJson: item.contextJson,
      forbidden: item.fixture.forbidden,
      trace: result.trace,
      ...(result.status === "decision" ? { decision: result.decision } : {}),
    });
  }
  const directorScore = scoreGmCorpus(directorEntries);
  const directorAttributionPass = directorScore.cases.every((entry) =>
    entry.provider === OPENCODE_RUN_PROVIDER_ID
    && entry.model === "opencode/" + input.candidateId
    && entry.usedFallback !== true,
  );
  const directorPass = directorAttributionPass
    && directorScore.rawSchemaValid === GM_CORPUS.length
    && directorScore.decisionAccepted === GM_CORPUS.length
    && directorScore.dimensions.every((dimension) => dimension.passed === dimension.total);

  const narrationResults: AITaskEvaluationReport["narration"]["cases"][number][] = [];
  for (const task of AI_TASK_NARRATION_CORPUS) {
    if (monotonicNow() >= deadline) {
      const report = baseReport(evaluationInput, now, startedAt, "run_time_budget", catalog.catalogDigest);
      return {
        ...report,
        policy: { ...report.policy, timeoutMs, maxDurationMs, providerCallCount: router.providerCallCount },
        director: { corpusVersion: GM_CORPUS_VERSION, corpusSize: GM_CORPUS.length, passed: directorPass, score: directorScore },
        narration: {
          corpusVersion: AI_TASK_EVALUATION_CORPUS_VERSION,
          corpusSize: AI_TASK_NARRATION_CORPUS.length,
          passed: narrationResults.filter((entry) => entry.passed).length,
          cases: narrationResults,
        },
      };
    }
    const allowed = allowedFactsFor(task);
    const beforeCalls = router.providerCallCount;
    const result = await narrateAllowedAnswerLLM(allowed, 0, router, {
      timeoutMs: Math.min(timeoutMs, Math.max(1_000, Math.floor(deadline - monotonicNow()))),
      maxRetries: 0,
      priority: "batch",
      correlationId: "task-eval-" + task.id,
    });
    const afterCalls = router.providerCallCount;
    const structurallyVerified = !result.usedFallback && result.model === "opencode/" + input.candidateId;
    const russianPass = structurallyVerified && russianFormPass(result.text);
    const unsupportedPass = structurallyVerified && unsupportedTermsPass(result.text, task.forbiddenPhrases);
    const passed = structurallyVerified && russianPass && unsupportedPass;
    narrationResults.push(Object.freeze({
      id: task.id,
      passed,
      allowedFactsGuard: structurallyVerified ? "pass" : "fail",
      russianForm: russianPass ? "pass" : "fail",
      unsupportedTerms: unsupportedPass ? "pass" : "fail",
      modelMatch: result.model === "opencode/" + input.candidateId,
      providerCalls: afterCalls - beforeCalls,
      latencyMs: result.latencyMs,
      ...(structurallyVerified ? { verifiedPreview: result.text.slice(0, VERIFIED_PREVIEW_MAX_CHARS) } : {}),
      ...(result.fallbackReason ? { fallbackCode: result.fallbackReason.slice(0, 80) } : {}),
    }));
  }

  const narrationPassed = narrationResults.filter((entry) => entry.passed).length;
  const machinePass = directorPass && narrationPassed === AI_TASK_NARRATION_CORPUS.length;
  const finishedAt = now().toISOString();
  const digests = promptDigests();
  return {
    schema: AI_TASK_EVALUATION_SCHEMA,
    status: "complete",
    machineVerdict: machinePass ? "pass" : "fail",
    humanReview: "required",
    startedAt,
    finishedAt,
    actualCommit: input.actualCommit,
    evidence: {
      discoveryRunId: input.discoveryRunId,
      discoveryReportSha256: input.discoveryReportSha256,
      decisionId: input.decisionId,
      candidateId: input.candidateId,
      region,
      catalogDigest: catalog.catalogDigest,
      corpusVersion: AI_TASK_EVALUATION_CORPUS_VERSION,
      corpusDigest: digests.corpus,
      directorPromptSha256: digests.director,
      narrationPromptSha256: digests.narration,
    },
    policy: {
      maxConcurrency: 1,
      maxProviderCalls: AI_TASK_EVALUATION_MAX_PROVIDER_CALLS,
      providerCallCount: router.providerCallCount,
      timeoutMs,
      maxDurationMs,
      transport: "opencode_cli",
    },
    director: {
      corpusVersion: GM_CORPUS_VERSION,
      corpusSize: GM_CORPUS.length,
      passed: directorPass,
      score: directorScore,
    },
    narration: {
      corpusVersion: AI_TASK_EVALUATION_CORPUS_VERSION,
      corpusSize: AI_TASK_NARRATION_CORPUS.length,
      passed: narrationPassed,
      cases: narrationResults,
    },
  };
}
