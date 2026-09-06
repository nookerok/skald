import type { Route, RouteCandidate, Category, ProviderId, ProviderProtocol } from "./types.js";

export interface ProviderConf {
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly usageScope: string;
  /** Default chat protocol spoken by this provider. */
  readonly protocol: ProviderProtocol;
}

export interface PolicyConf {
  readonly skaldProvider: string;
  readonly onlyFreeModels: boolean;
  readonly allowFreeRouterFallback: boolean;
}

export interface LLMConfig {
  readonly policy: PolicyConf;
  readonly providers: Record<string, ProviderConf>;
  readonly routes: Record<Category, Route>;
}

/**
 * Ordered OpenCode Zen test preferences. Runtime routing activates only
 * entries present in the live catalogue that pass both authenticated no-world
 * probes. The list is a preference order, not a claim that any model is
 * available.
 *
 * Live recon (2026-09-06, tunnel egress, both wire protocols, production
 * probe budgets): muse-spark answers only on Responses; ling answers on Chat
 * Completions but its upstream flaps (503/garbled). big-pickle and
 * mimo-v2.5-free are persistently 429-gated, deepseek-v4-flash-free is a
 * persistent 400, and both nemotron frees are too slow for route timeouts
 * (16-63s). No better free backup exists right now, so the daily
 * re-discovery keeps probing this pair and promotes whichever passes.
 */
export const OPENCODE_PREFERRED_MODELS: readonly string[] = Object.freeze([
  "muse-spark-1.3-contributor-free",
  "ling-3.0-flash-fin-free",
]);

/**
 * Per-model wire protocol for OpenCode Zen. Zen multiplexes models with
 * different OpenAI-compatible surfaces behind one base URL: most models speak
 * `/chat/completions`, while `muse-spark` requires the Responses API
 * (`/responses` with `input`/`max_output_tokens` and an
 * `output_text`/`output` response). Routing must never guess the protocol
 * from the provider alone.
 */
export const OPENCODE_MODEL_PROTOCOLS: Readonly<Record<string, ProviderProtocol>> = Object.freeze({
  "muse-spark-1.3-contributor-free": "openai_responses",
  "ling-3.0-flash-fin-free": "openai_chat",
});

/**
 * Wire protocol for one OpenCode Zen model id. Unknown ids fall back to the
 * Chat Completions surface so catalogue discovery stays forward-compatible
 * with new Zen models.
 */
export function openCodeProtocolForModel(model: string): ProviderProtocol {
  return OPENCODE_MODEL_PROTOCOLS[model] ?? "openai_chat";
}

/**
 * Provisional Ollama Cloud backup model. Ollama's catalogue separates cloud
 * tags from local tags, so the cloud endpoint needs the `-cloud` tag rather
 * than the local `gemma4:31b`.
 *
 * TODO: confirm the exact cloud tag with a live `POST /api/chat` probe before
 * production rollout and replace this provisional id with the verified one.
 */
export const OLLAMA_CLOUD_BACKUP_MODEL = "gemma4:31b-cloud";

const CATEGORIES: readonly Category[] = ["narrate", "analyze", "interpret"];

function preferredCandidates(): readonly RouteCandidate[] {
  return OPENCODE_PREFERRED_MODELS.map((model) => ({
    provider: "opencode_zen" as const,
    model,
    protocol: openCodeProtocolForModel(model),
    tier: "catalog_candidate" as const,
  }));
}

function route(
  category: Category,
  candidates: readonly RouteCandidate[],
  rest: Omit<Route, "category" | "candidates" | "models">,
): Route {
  return Object.freeze({
    category,
    candidates: Object.freeze([...candidates]),
    models: Object.freeze(candidates.map((candidate) => candidate.model)),
    ...rest,
  });
}

const routes: Record<Category, Route> = {
  narrate: route(
    "narrate",
    preferredCandidates(),
    {
      maxTokens: 600,
      allowFreeRouter: false,
      dataClasses: ["public_docs", "project_context"],
      thinking: null,
    },
  ),
  analyze: route(
    "analyze",
    // Analyze has no live activation contract yet; deterministic callers
    // continue to own this path until a separate probe matrix is specified.
    [],
    {
      maxTokens: 2000,
      allowFreeRouter: false,
      dataClasses: ["public_docs", "project_context"],
      thinking: null,
    },
  ),
  interpret: route(
    "interpret",
    preferredCandidates(),
    {
      maxTokens: 450,
      allowFreeRouter: false,
      dataClasses: ["player_input"],
      thinking: false,
      timeoutMs: 5_000,
    },
  ),
};

export const LLM_CONFIG: LLMConfig = {
  policy: {
    skaldProvider: "opencode_zen",
    // Runtime startup replaces catalog candidates with the authenticated
    // live selection; this flag remains for compatibility policy checks.
    onlyFreeModels: false,
    allowFreeRouterFallback: false,
  },
  providers: {
    opencode_zen: {
      baseUrl: "https://opencode.ai/zen/v1",
      apiKeyEnv: "SKALD_OPENCODE_ZEN_API_KEY",
      usageScope: "remote",
      protocol: "openai_chat",
    },
    ollama_cloud: {
      baseUrl: "https://ollama.com",
      apiKeyEnv: "SKALD_OLLAMA_CLOUD_API_KEY",
      usageScope: "remote",
      protocol: "ollama_chat",
    },
  },
  routes,
};

/** Ordered, provider-aware candidates configured for a route. */
export function routeCandidates(category: Category, config: LLMConfig = LLM_CONFIG): readonly RouteCandidate[] {
  return config.routes[category]?.candidates ?? [];
}

/**
 * Validate the two candidate slots required by production-critical routes.
 * The result contains identifiers only, never credentials or provider output.
 */
export function criticalRouteConfigIssues(config: LLMConfig = LLM_CONFIG): readonly string[] {
  const issues: string[] = [];
  for (const category of ["interpret", "narrate"] as const) {
    const candidates = routeCandidates(category, config);
    const primary = candidates.find((candidate) => candidate.tier === "paid_primary" || candidate.tier === "live_primary") ?? candidates[0];
    const backup = candidates.find((candidate) => candidate.tier === "paid_backup" || candidate.tier === "live_backup") ?? candidates[1];
    if (!primary) issues.push(`${category}:missing_primary`);
    if (!backup) issues.push(`${category}:missing_backup`);
    if (candidates[0]?.tier === "free_emergency") issues.push(`${category}:free_primary`);
  }
  return Object.freeze(issues);
}

/** Candidate for an exact `category + model` pair, when configured. */
export function candidateForModel(category: Category, model: string, config: LLMConfig = LLM_CONFIG): RouteCandidate | undefined {
  return routeCandidates(category, config).find((candidate) => candidate.model === model);
}

/** Provider that owns a configured model; falls back to the default provider. */
export function providerForModel(model: string, config: LLMConfig = LLM_CONFIG): ProviderId {
  for (const category of CATEGORIES) {
    const candidate = candidateForModel(category, model, config);
    if (candidate) return candidate.provider;
  }
  return config.policy.skaldProvider as ProviderId;
}

/** Protocol for a configured model; falls back to its provider default. */
export function protocolForModel(model: string, config: LLMConfig = LLM_CONFIG): ProviderProtocol {
  for (const category of CATEGORIES) {
    const candidate = candidateForModel(category, model, config);
    if (candidate) return candidate.protocol;
  }
  return config.providers[providerForModel(model, config)]?.protocol ?? "openai_chat";
}

/** Provider ids declared in the configuration. */
export function configuredProviders(config: LLMConfig = LLM_CONFIG): readonly ProviderId[] {
  return Object.keys(config.providers) as ProviderId[];
}

/**
 * Provider ids whose API key environment variable holds a non-empty value.
 * Returns ids only — never key values.
 */
export function providersWithKeys(env: NodeJS.ProcessEnv = process.env, config: LLMConfig = LLM_CONFIG): readonly ProviderId[] {
  return configuredProviders(config).filter((provider) => {
    const name = config.providers[provider]?.apiKeyEnv ?? "";
    return name.length > 0 && (env[name] ?? "").length > 0;
  });
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Stable, secret-free fingerprint of provider endpoints and route
 * candidates. Key values are never part of the input, only their env
 * variable names, so two deployments with identical routing and different
 * keys share a fingerprint.
 */
export function llmConfigFingerprint(config: LLMConfig = LLM_CONFIG): string {
  const canonical = {
    policy: {
      skaldProvider: config.policy.skaldProvider,
      onlyFreeModels: config.policy.onlyFreeModels,
      allowFreeRouterFallback: config.policy.allowFreeRouterFallback,
    },
    providers: configuredProviders(config)
      .slice()
      .sort()
      .map((provider) => {
        const conf = config.providers[provider];
        return {
          id: provider,
          baseUrl: conf?.baseUrl ?? "",
          protocol: conf?.protocol ?? "openai_chat",
          apiKeyEnv: conf?.apiKeyEnv ?? "",
        };
      }),
    routes: CATEGORIES.map((category) => ({
      category,
      candidates: routeCandidates(category, config).map((candidate) => ({
        provider: candidate.provider,
        model: candidate.model,
        protocol: candidate.protocol,
        tier: candidate.tier,
      })),
    })),
  };
  return fnv1a(JSON.stringify(canonical));
}
