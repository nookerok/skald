import { LLM_CONFIG } from "./config.js";
import { loadHealth } from "./health.js";
import { classifyPayload, enforceDataPolicy } from "./data-policy.js";
import { chatOnce, shouldFallback } from "./http.js";
import type { ProviderId, Category, ChatMessage, ChatResult, RouterDecision, RouterDiagnostic } from "./types.js";

const MODEL_PROVIDER: Record<string, ProviderId> = {
  "deepseek-v4-flash-free": "opencode_zen",
  "nemotron-3-ultra-free": "opencode_zen",
  "nemotron-3-ultra": "opencode_zen",
  "gemma4:31b": "ollama_cloud",
};

function providerForModel(model: string): ProviderId {
  return MODEL_PROVIDER[model] ?? "opencode_zen";
}

export class ModelRouter {
  readonly providerId: ProviderId;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly healthCachePath: string;
  readonly timeoutSeconds: number;
  readonly availableProviders: readonly ProviderId[];

  constructor(opts?: { apiKey?: string; baseUrl?: string; timeoutMs?: number; healthCachePath?: string; providerId?: ProviderId; availableProviders?: readonly ProviderId[] }) {
    this.providerId = opts?.providerId ?? (LLM_CONFIG.policy.skaldProvider as ProviderId);
    const provConf = LLM_CONFIG.providers[this.providerId];
    this.baseUrl = (opts?.baseUrl || provConf?.baseUrl || "").replace(/\/+$/, "");
    this.apiKey = opts?.apiKey ?? process.env[provConf?.apiKeyEnv ?? ""] ?? "";
    this.healthCachePath = opts?.healthCachePath ?? "packages/cli/llm-health.json";
    this.timeoutSeconds = (opts?.timeoutMs ?? 30000) / 1000;
    this.availableProviders = Object.freeze([...new Set(opts?.availableProviders ?? [this.providerId])]);
  }

  diagnostics(): RouterDiagnostic[] {
    const diag: RouterDiagnostic[] = [];
    if (!this.apiKey) {
      diag.push({ level: "WARN", message: "API key is empty — LLM disabled, template fallback will be used" });
    } else {
      diag.push({ level: "OK", message: "API key present" });
    }
    diag.push({ level: "OK", message: `base URL: ${this.baseUrl}` });
    for (const [cat, route] of Object.entries(LLM_CONFIG.routes)) {
      diag.push({ level: "OK", message: `${cat}: models=${route.models.join(", ")}` });
    }
    return diag;
  }

  async chatOnce(model: string, messages: readonly ChatMessage[], opts: { provider?: ProviderId; maxTokens?: number; timeoutMs?: number }): Promise<{ text: string; responseModel: string; latencyMs: number; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const provider = opts.provider ?? providerForModel(model);
    const provConf = LLM_CONFIG.providers[provider];
    const baseUrl = provConf?.baseUrl ?? this.baseUrl;
    const apiKey = provider === this.providerId ? this.apiKey : (process.env[provConf?.apiKeyEnv ?? ""] ?? "");
    const maxTokens = opts.maxTokens;
    return chatOnce(baseUrl, apiKey, model, messages, { provider, maxTokens, ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
  }

  private _candidateModels(category: Category): readonly string[] {
    return (LLM_CONFIG.routes[category]?.models ?? []).filter((model) => this.availableProviders.includes(providerForModel(model)));
  }

  private _modelHealth(model: string): string {
    const health = loadHealth(this.healthCachePath);
    return health[model]?.status ?? "unknown";
  }

  decideModel(category: Category, messages: readonly ChatMessage[], dataClass?: string): RouterDecision {
    const route = LLM_CONFIG.routes[category];
    if (!route) throw new Error(`Unknown category: ${category}`);

    const msgText = messages.map((m) => m.content).join(" ");
    const cls = classifyPayload(msgText, dataClass);
    const policy = enforceDataPolicy(msgText, cls.class, this.providerId);
    if (!policy.ok) throw new Error(`Data policy blocked: ${policy.reason}`);

    const candidates = this._candidateModels(category);
    if (candidates.length === 0) throw new Error(`No models configured for category: ${category}`);

    // Pass 1: first healthy
    for (const model of candidates) {
      const h = this._modelHealth(model);
      if (h === "ok") {
        return {
          category,
          selectedModel: model,
          candidateModels: candidates,
          dataClass: cls.class,
          reason: "first healthy model",
          healthStatus: "ok",
          usedHealthCache: true,
          provider: providerForModel(model),
        };
      }
    }

    // Pass 2: first non-fatal
    for (const model of candidates) {
      const h = this._modelHealth(model);
      if (!["forbidden", "network_error", "rate_limited"].includes(h)) {
        return {
          category,
          selectedModel: model,
          candidateModels: candidates,
          dataClass: cls.class,
          reason: "first non-fatal candidate",
          healthStatus: h as any,
          usedHealthCache: true,
          provider: providerForModel(model),
        };
      }
    }

    throw new Error(`No healthy models available for category: ${category}`);
  }

  async chat(category: Category, messages: readonly ChatMessage[], opts?: { dataClass?: string }): Promise<ChatResult> {
    const route = LLM_CONFIG.routes[category];
    if (!route) throw new Error(`Unknown category: ${category}`);

    const decision = this.decideModel(category, messages, opts?.dataClass);
    const candidates = this._candidateModels(category);

    let lastError: Error | null = null;

    const tryOrder = [decision.selectedModel];
    for (const c of candidates) {
      if (!tryOrder.includes(c)) tryOrder.push(c);
    }

    for (const model of tryOrder) {
      try {
        const provider = providerForModel(model);
        const result = await this.chatOnce(model, messages, { provider, maxTokens: route.maxTokens, ...(route.timeoutMs !== undefined ? { timeoutMs: route.timeoutMs } : {}) });
        return {
          model,
          configuredModel: decision.selectedModel,
          responseModel: result.responseModel,
          usedFallback: model !== decision.selectedModel,
          text: result.text,
          latencyMs: result.latencyMs,
          usage: result.usage,
          provider,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!shouldFallback(lastError)) throw lastError;
      }
    }

    throw lastError ?? new Error("All models failed for category: " + category);
  }
}
