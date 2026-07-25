export type ProviderId = "opencode_zen" | "ollama_cloud";
export type Category = "narrate" | "analyze";
export type HealthStatus = "ok" | "degraded" | "rate_limited" | "forbidden" | "network_error" | "server_error" | "unknown";

export interface Route {
  readonly category: Category;
  readonly models: readonly string[];
  readonly maxTokens: number;
  readonly allowFreeRouter: boolean;
  readonly dataClasses: readonly string[];
  readonly thinking: boolean | null;
}

export interface RouterDecision {
  readonly category: Category;
  readonly selectedModel: string;
  readonly candidateModels: readonly string[];
  readonly dataClass: string;
  readonly reason: string;
  readonly healthStatus: HealthStatus | "unknown";
  readonly usedHealthCache: boolean;
  readonly provider: ProviderId;
}

export interface ChatResult {
  readonly model: string;
  readonly configuredModel: string;
  readonly responseModel: string;
  readonly usedFallback: boolean;
  readonly text: string;
  readonly latencyMs: number;
  readonly usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  readonly provider: ProviderId;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface RouterDiagnostic {
  readonly level: "OK" | "WARN" | "ERROR";
  readonly message: string;
}
