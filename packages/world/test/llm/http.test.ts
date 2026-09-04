import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PROVIDER_ERROR_BODY_CHARS,
  chatOnce,
  shouldRetrySameCandidate,
  shouldTryNextCandidate,
} from "../../src/llm/http.js";
import { ProviderRequestError, sanitizeProviderCode, toProviderFailure } from "../../src/llm/errors.js";
import type { RouteCandidate } from "../../src/llm/types.js";

const OPEN_CODE: RouteCandidate = {
  provider: "opencode_zen",
  model: "deepseek-v4-flash",
  protocol: "openai_chat",
  tier: "paid_primary",
};
const OPEN_EMERGENCY: RouteCandidate = {
  provider: "opencode_zen",
  model: "deepseek-v4-flash-free",
  protocol: "openai_chat",
  tier: "free_emergency",
};
const OLLAMA_BACKUP: RouteCandidate = {
  provider: "ollama_cloud",
  model: "gemma4:31b-cloud",
  protocol: "ollama_chat",
  tier: "paid_backup",
};

const messages = [{ role: "user" as const, content: "probe" }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider HTTP transport", () => {
  it.each([400, 401, 403, 404, 429, 500, 502, 503, 504])("preserves safe metadata for HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => JSON.stringify({ error: { code: "model_not_found", message: "secret response body" } }),
    }));

    const thrown = await chatOnce("https://provider.invalid/v1", "secret-api-key", OPEN_CODE.model, messages, {
      provider: OPEN_CODE.provider,
      protocol: OPEN_CODE.protocol,
      category: "narrate",
      maxTokens: 8,
      timeoutMs: 100,
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ProviderRequestError);
    const error = thrown as ProviderRequestError;
    expect(error.phase).toBe("response_status");
    expect(error.httpStatus).toBe(status);
    expect(error.providerCode).toBe("model_not_found");
    expect(error.message).not.toContain("secret");
    expect(JSON.stringify(toProviderFailure(error))).not.toContain("secret");
    expect(shouldRetrySameCandidate(error)).toBe([429, 500, 502, 503, 504].includes(status));
  });

  it("bounds provider error-body parsing and rejects unsafe codes", async () => {
    const text = vi.fn().mockResolvedValue("x".repeat(MAX_PROVIDER_ERROR_BODY_CHARS) + JSON.stringify({ error: { code: "hidden" } }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text }));

    const thrown = await chatOnce("https://provider.invalid/v1", "key", OPEN_CODE.model, messages, {
      provider: OPEN_CODE.provider,
      protocol: OPEN_CODE.protocol,
      category: "interpret",
      maxTokens: 8,
    }).catch((error: unknown) => error);

    expect((thrown as ProviderRequestError).providerCode).toBeUndefined();
    expect(text).toHaveBeenCalledOnce();
    expect(sanitizeProviderCode("bad code")).toBeUndefined();
    expect(sanitizeProviderCode("a".repeat(81))).toBeUndefined();
    expect(sanitizeProviderCode("safe.code:1")).toBe("safe.code:1");
  });

  it("classifies malformed JSON and empty content without retrying", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("raw provider body"); } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }] }) }));

    const malformed = await chatOnce("https://provider.invalid/v1", "key", OPEN_CODE.model, messages, {
      provider: OPEN_CODE.provider,
      protocol: OPEN_CODE.protocol,
      category: "interpret",
      maxTokens: 8,
    }).catch((error: unknown) => error) as ProviderRequestError;
    expect(malformed.phase).toBe("response_decode");
    expect(malformed.message).not.toContain("raw provider body");
    expect(shouldRetrySameCandidate(malformed)).toBe(false);

    const empty = await chatOnce("https://provider.invalid/v1", "key", OPEN_CODE.model, messages, {
      provider: OPEN_CODE.provider,
      protocol: OPEN_CODE.protocol,
      category: "interpret",
      maxTokens: 8,
    }).catch((error: unknown) => error) as ProviderRequestError;
    expect(empty.phase).toBe("response_shape");
    expect(empty.message).toContain("empty response");
    expect(shouldRetrySameCandidate(empty)).toBe(false);
  });

  it("classifies abort and network failures as transient transport errors", async () => {
    const abort = new Error("provider URL and key must not escape");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(abort)
      .mockRejectedValueOnce(new Error("ECONNRESET provider secret")));

    const first = await chatOnce("https://provider.invalid/v1", "key", OPEN_CODE.model, messages, {
      provider: OPEN_CODE.provider,
      protocol: OPEN_CODE.protocol,
      category: "narrate",
      maxTokens: 8,
    }).catch((error: unknown) => error) as ProviderRequestError;
    expect(first.phase).toBe("transport");
    expect(first.message).toContain("timeout");
    expect(first.message).not.toContain("provider URL");
    expect(shouldRetrySameCandidate(first)).toBe(true);

    const second = await chatOnce("https://provider.invalid/v1", "key", OPEN_CODE.model, messages, {
      provider: OPEN_CODE.provider,
      protocol: OPEN_CODE.protocol,
      category: "narrate",
      maxTokens: 8,
    }).catch((error: unknown) => error) as ProviderRequestError;
    expect(second.phase).toBe("transport");
    expect(second.message).toBe("network failure (phase=transport)");
    expect(second.message).not.toContain("secret");
  });
});

describe("retry and failover classification", () => {
  it("moves across providers for auth/model errors but skips same-provider candidates", () => {
    const authFailure = new ProviderRequestError({
      provider: OPEN_CODE.provider,
      model: OPEN_CODE.model,
      category: "narrate",
      phase: "response_status",
      httpStatus: 403,
    });
    expect(shouldTryNextCandidate(authFailure, OPEN_EMERGENCY)).toBe(false);
    expect(shouldTryNextCandidate(authFailure, OLLAMA_BACKUP)).toBe(true);

    const model404 = new ProviderRequestError({
      provider: OPEN_CODE.provider,
      model: OPEN_CODE.model,
      category: "narrate",
      phase: "response_status",
      httpStatus: 404,
      providerCode: "model_not_found",
    });
    expect(shouldTryNextCandidate(model404, OPEN_EMERGENCY)).toBe(true);

    const transient = new ProviderRequestError({
      provider: OPEN_CODE.provider,
      model: OPEN_CODE.model,
      category: "narrate",
      phase: "response_status",
      httpStatus: 503,
    });
    expect(shouldRetrySameCandidate(transient)).toBe(true);
    expect(shouldTryNextCandidate(transient, OLLAMA_BACKUP)).toBe(true);
  });
});
