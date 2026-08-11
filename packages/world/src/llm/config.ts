import type { Route, Category } from "./types.js";

export interface ProviderConf {
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly usageScope: string;
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

const routes: Record<Category, Route> = {
  narrate: {
    category: "narrate",
    models: ["deepseek-v4-flash-free", "nemotron-3-ultra-free", "gemma4:31b"],
    maxTokens: 600,
    allowFreeRouter: false,
    dataClasses: ["public_docs", "project_context"],
    thinking: null,
  },
  analyze: {
    category: "analyze",
    models: ["nemotron-3-ultra-free", "deepseek-v4-flash-free", "nemotron-3-ultra"],
    maxTokens: 2000,
    allowFreeRouter: false,
    dataClasses: ["public_docs", "project_context"],
    thinking: null,
  },
  interpret: {
    category: "interpret",
    models: ["deepseek-v4-flash-free", "nemotron-3-ultra-free"],
    maxTokens: 450,
    allowFreeRouter: false,
    dataClasses: ["player_input"],
    thinking: false,
    timeoutMs: 5_000,
  },
};

export const LLM_CONFIG: LLMConfig = {
  policy: {
    skaldProvider: "opencode_zen",
    onlyFreeModels: true,
    allowFreeRouterFallback: false,
  },
  providers: {
    opencode_zen: {
      baseUrl: "https://opencode.ai/zen/v1",
      apiKeyEnv: "SKALD_OPENCODE_ZEN_API_KEY",
      usageScope: "remote",
    },
    ollama_cloud: {
      baseUrl: "https://ollama.com",
      apiKeyEnv: "SKALD_OLLAMA_CLOUD_API_KEY",
      usageScope: "remote",
    },
  },
  routes,
};
