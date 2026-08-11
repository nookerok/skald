import type { ProviderId, ChatMessage, Category } from "./types.js";

export interface HttpResult {
  text: string;
  responseModel: string;
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const RETRYABLE_STATUSES = new Set([404, 408, 409, 429, 500, 502, 503, 504]);

export function shouldFallback(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("AbortError") || msg.includes("timeout") || msg.includes("fetch")) return true;
    if (msg.includes("HTTP ")) {
      for (const code of RETRYABLE_STATUSES) {
        if (msg.includes(String(code))) return true;
      }
    }
  }
  return false;
}

export async function chatOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: readonly ChatMessage[],
  opts: { category?: Category; maxTokens: number | undefined; provider: ProviderId; timeoutMs?: number },
): Promise<HttpResult> {
  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);

  try {
    let body: object;
    let url: string;

    if (opts.provider === "ollama_cloud") {
      url = `${baseUrl}/api/chat`;
      body = { model, messages: messages as any, stream: false, options: { num_predict: opts.maxTokens ?? 600 } };
    } else {
      url = `${baseUrl}/chat/completions`;
      body = { model, messages: messages as any, max_tokens: opts.maxTokens ?? 600 };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json() as any;
    const latencyMs = Math.round(performance.now() - start);

    if (opts.provider === "ollama_cloud") {
      const text = json.message?.content ?? "";
      if (!text) throw new Error("empty response");
      return {
        text,
        responseModel: json.model ?? model,
        latencyMs,
        usage: {
          promptTokens: json.prompt_eval_count ?? 0,
          completionTokens: json.eval_count ?? 0,
          totalTokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
        },
      };
    }

    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) throw new Error("empty response");
    return {
      text,
      responseModel: json.model ?? model,
      latencyMs,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
