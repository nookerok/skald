import {
  ProviderRequestError,
  isModelScopedFailure,
  isProviderScopedFailure,
  sanitizeProviderCode,
  toProviderFailure,
} from "./errors.js";
import type { ProviderFailureContext } from "./errors.js";
import type { Category, ChatMessage, ProviderId, ProviderProtocol, RouteCandidate } from "./types.js";

export interface HttpResult {
  text: string;
  responseModel: string;
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Upper bound on how much of an error body is read and inspected. */
export const MAX_PROVIDER_ERROR_BODY_CHARS = 2048;

interface ErrorBodyReader {
  read(): Promise<{ done: boolean; value?: unknown }>;
  cancel(reason?: unknown): Promise<unknown>;
  releaseLock(): void;
}

async function readBoundedErrorBody(response: unknown, limit: number): Promise<string | undefined> {
  const readable = response as { body?: { getReader?: () => ErrorBodyReader }; text?: unknown };
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return undefined;
  const getReader = readable.body?.getReader;
  if (typeof getReader === "function") {
    const reader = getReader.call(readable.body);
    const decoder = new TextDecoder();
    let output = "";
    try {
      while (output.length < boundedLimit) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value instanceof Uint8Array) output += decoder.decode(chunk.value, { stream: true });
      }
      output += decoder.decode();
      if (output.length >= boundedLimit) {
        await reader.cancel();
        if (output.length > boundedLimit) output = output.slice(0, boundedLimit);
      }
      return output;
    } catch {
      return undefined;
    } finally {
      reader.releaseLock();
    }
  }
  if (typeof readable.text !== "function") return undefined;
  try {
    const raw = await (readable.text as () => Promise<unknown>)();
    return typeof raw === "string" ? raw.slice(0, boundedLimit) : undefined;
  } catch {
    return undefined;
  }
}

export interface ChatOnceOptions {
  /** Route category the call belongs to; reported in diagnostics. */
  readonly category?: Category | undefined;
  readonly maxTokens: number | undefined;
  readonly provider: ProviderId;
  /** Defaults to the provider's configured protocol. */
  readonly protocol?: ProviderProtocol | undefined;
  readonly timeoutMs?: number | undefined;
  /** Injectable transport for deterministic runtime acceptance tests. */
  readonly fetchImpl?: typeof fetch | undefined;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError");
}

/**
 * Read a bounded slice of an error response and return only a sanitized
 * provider error code. The body itself, the URL, headers and any provider
 * message are dropped. Response mocks without a `text()` method and bodies
 * that are not JSON yield `undefined`.
 */
export async function readProviderErrorCode(
  response: unknown,
  limit: number = MAX_PROVIDER_ERROR_BODY_CHARS,
): Promise<string | undefined> {
  const raw = await readBoundedErrorBody(response, limit);
  if (raw === undefined || raw.length === 0) return undefined;

  // Only the bounded prefix is parsed and nothing of it is retained.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;

  const error = (parsed as { error?: unknown }).error;
  const code = error !== null && typeof error === "object"
    ? (error as { code?: unknown }).code
    : (parsed as { code?: unknown }).code;
  const sanitizedCode = sanitizeProviderCode(code);
  if (sanitizedCode) return sanitizedCode;
  const message = error !== null && typeof error === "object"
    ? (error as { message?: unknown }).message
    : (parsed as { message?: unknown }).message;
  if (typeof message !== "string") return undefined;
  const normalized = message.trim().toLowerCase();
  if (/^model\s+unavailable$/.test(normalized)) return "model_unavailable";
  if (/^model\s+not\s+found$/.test(normalized)) return "model_not_found";
  if (/^model\s+not\s+supported$/.test(normalized)) return "model_not_supported";
  return undefined;
}

/**
 * One provider round-trip. Every failure leaves as a `ProviderRequestError`
 * carrying its phase; raw bodies, status text and keys are never propagated.
 */
export async function chatOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: readonly ChatMessage[],
  opts: ChatOnceOptions,
): Promise<HttpResult> {
  const provider = opts.provider;
  const protocol = opts.protocol ?? (provider === "ollama_cloud" ? "ollama_chat" : "openai_chat");
  const category = opts.category ?? "narrate";
  const timeoutMs = opts.timeoutMs ?? 30000;
  const start = performance.now();

  // `narrate` is the historical default for direct transport calls; the
  // router always passes the real category.
  if (!baseUrl) {
    throw new ProviderRequestError({ provider, model, category, phase: "configuration", reason: "provider base URL is not configured" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = protocol === "ollama_chat" ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
    const body = protocol === "ollama_chat"
      ? { model, messages: messages as unknown as Array<{ role: string; content: string }>, stream: false, options: { num_predict: opts.maxTokens ?? 600 } }
      : { model, messages: messages as unknown as Array<{ role: string; content: string }>, max_tokens: opts.maxTokens ?? 600 };

    let response: Response;
    try {
      response = await (opts.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (isAbortError(cause)) {
        throw new ProviderRequestError({
          provider,
          model,
          category,
          phase: "transport",
          reason: `request timeout after ${timeoutMs}ms`,
          cause,
        });
      }
      throw new ProviderRequestError({ provider, model, category, phase: "transport", reason: "network failure", cause });
    }

    if (!response.ok) {
      const providerCode = await readProviderErrorCode(response);
      throw new ProviderRequestError({
        provider,
        model,
        category,
        phase: "response_status",
        httpStatus: response.status,
        ...(providerCode !== undefined ? { providerCode } : {}),
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      throw new ProviderRequestError({ provider, model, category, phase: "response_decode", reason: "malformed JSON response", cause });
    }
    const latencyMs = Math.round(performance.now() - start);

    if (protocol === "ollama_chat") {
      const payload = json as { message?: { content?: unknown }; model?: string; prompt_eval_count?: number; eval_count?: number } | null;
      const text = typeof payload?.message?.content === "string" ? payload.message.content : "";
      if (!text) throw new ProviderRequestError({ provider, model, category, phase: "response_shape", reason: "empty response" });
      return {
        text,
        responseModel: payload?.model ?? model,
        latencyMs,
        usage: {
          promptTokens: payload?.prompt_eval_count ?? 0,
          completionTokens: payload?.eval_count ?? 0,
          totalTokens: (payload?.prompt_eval_count ?? 0) + (payload?.eval_count ?? 0),
        },
      };
    }

    const payload = json as {
      choices?: Array<{ message?: { content?: unknown } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    } | null;
    const text = typeof payload?.choices?.[0]?.message?.content === "string" ? payload.choices[0]!.message!.content! : "";
    if (!text) throw new ProviderRequestError({ provider, model, category, phase: "response_shape", reason: "empty response" });
    return {
      text,
      responseModel: payload?.model ?? model,
      latencyMs,
      usage: {
        promptTokens: payload?.usage?.prompt_tokens ?? 0,
        completionTokens: payload?.usage?.completion_tokens ?? 0,
        totalTokens: payload?.usage?.total_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the identical request may be repeated on the same candidate.
 * Only timeouts, network failures and transient HTTP statuses qualify.
 */
export function shouldRetrySameCandidate(err: unknown, ctx: ProviderFailureContext = {}): boolean {
  const failure = toProviderFailure(err, ctx);
  return failure !== null && failure.retryable;
}

/**
 * Whether the router should move on to `next`. Provider-scoped failures
 * (401/403 and endpoint-level 404) invalidate the credential or endpoint, so
 * only a candidate on a *different* provider is worth trying. Model-scoped
 * 400/known model 404 failures may use the next same-provider candidate.
 * Without `next` provider-scoped failures stop the route; every other failure
 * may advance.
 */
export function shouldTryNextCandidate(
  err: unknown,
  next?: RouteCandidate | null,
  ctx: ProviderFailureContext = {},
): boolean {
  const failure = toProviderFailure(err, ctx);
  if (!failure) return false;
  if (isModelScopedFailure(failure.httpStatus, failure.providerCode)) return true;
  if (isProviderScopedFailure(failure.httpStatus, failure.providerCode)) {
    if (!next) return false;
    return next.provider !== failure.provider;
  }
  return true;
}

/**
 * Legacy single-question helper: whether a failure should advance at all.
 * Kept for compatibility; new code uses `shouldRetrySameCandidate` and
 * `shouldTryNextCandidate`, which separate retry from failover.
 */
export function shouldFallback(err: unknown): boolean {
  return shouldTryNextCandidate(err, null);
}
