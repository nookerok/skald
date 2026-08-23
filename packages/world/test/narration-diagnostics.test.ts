import { describe, it, expect } from "vitest";
import {
  classifyNarrationError,
  isTransientNarrationError,
} from "../src/narration-diagnostics.js";

describe("classifyNarrationError", () => {
  it("returns no_api_key when fallbackReason is no_api_key", () => {
    expect(classifyNarrationError(null, "no_api_key")).toBe("no_api_key");
  });

  it("returns schema_rejection for epistemic_violation fallback reasons", () => {
    expect(classifyNarrationError(null, "epistemic_violation:class_upgrade")).toBe("schema_rejection");
    expect(classifyNarrationError(null, "epistemic_violation:invalid_json")).toBe("schema_rejection");
    expect(classifyNarrationError(null, "epistemic_violation:unknown_source")).toBe("schema_rejection");
    expect(classifyNarrationError(null, "epistemic_violation:certainty_overclaim")).toBe("schema_rejection");
  });

  it("returns timeout for AbortError", () => {
    const err = new Error("AbortError: The operation was aborted");
    expect(classifyNarrationError(err, null)).toBe("timeout");
  });

  it("returns timeout for timeout messages", () => {
    const err = new Error("request timeout after 30000ms");
    expect(classifyNarrationError(err, null)).toBe("timeout");
  });

  it("returns network for fetch errors", () => {
    const err = new Error("fetch failed");
    expect(classifyNarrationError(err, null)).toBe("network");
  });

  it("returns network for network errors", () => {
    const err = new Error("network error");
    expect(classifyNarrationError(err, null)).toBe("network");
  });

  it("returns provider_429 for HTTP 429", () => {
    const err = new Error("HTTP 429: Too Many Requests");
    expect(classifyNarrationError(err, null)).toBe("provider_429");
  });

  it("returns provider_5xx for HTTP 500", () => {
    const err = new Error("HTTP 500: Internal Server Error");
    expect(classifyNarrationError(err, null)).toBe("provider_5xx");
  });

  it("returns provider_5xx for HTTP 502", () => {
    const err = new Error("HTTP 502: Bad Gateway");
    expect(classifyNarrationError(err, null)).toBe("provider_5xx");
  });

  it("returns provider_5xx for HTTP 503", () => {
    const err = new Error("HTTP 503: Service Unavailable");
    expect(classifyNarrationError(err, null)).toBe("provider_5xx");
  });

  it("returns provider_5xx for HTTP 504", () => {
    const err = new Error("HTTP 504: Gateway Timeout");
    expect(classifyNarrationError(err, null)).toBe("provider_5xx");
  });

  it("returns empty_response for empty response errors", () => {
    const err = new Error("empty response");
    expect(classifyNarrationError(err, null)).toBe("empty_response");
  });

  it("returns unknown_provider_error for unrecognized errors", () => {
    const err = new Error("something weird happened");
    expect(classifyNarrationError(err, null)).toBe("unknown_provider_error");
  });

  it("returns unknown_provider_error for non-Error values", () => {
    expect(classifyNarrationError("string error", null)).toBe("unknown_provider_error");
    expect(classifyNarrationError(42, null)).toBe("unknown_provider_error");
    expect(classifyNarrationError(null, null)).toBe("unknown_provider_error");
  });

  it("fallbackReason takes precedence over err when both are provided", () => {
    const err = new Error("fetch failed");
    expect(classifyNarrationError(err, "no_api_key")).toBe("no_api_key");
  });
});

describe("isTransientNarrationError", () => {
  it("returns true for timeout", () => {
    expect(isTransientNarrationError("timeout")).toBe(true);
  });

  it("returns true for network", () => {
    expect(isTransientNarrationError("network")).toBe(true);
  });

  it("returns true for provider_429", () => {
    expect(isTransientNarrationError("provider_429")).toBe(true);
  });

  it("returns true for provider_5xx", () => {
    expect(isTransientNarrationError("provider_5xx")).toBe(true);
  });

  it("returns false for no_api_key", () => {
    expect(isTransientNarrationError("no_api_key")).toBe(false);
  });

  it("returns false for schema_rejection", () => {
    expect(isTransientNarrationError("schema_rejection")).toBe(false);
  });

  it("returns false for empty_response", () => {
    expect(isTransientNarrationError("empty_response")).toBe(false);
  });

  it("returns false for unknown_provider_error", () => {
    expect(isTransientNarrationError("unknown_provider_error")).toBe(false);
  });

  it("returns false for persistence_error", () => {
    expect(isTransientNarrationError("persistence_error")).toBe(false);
  });

  it("returns false for queue_eviction", () => {
    expect(isTransientNarrationError("queue_eviction")).toBe(false);
  });

  it("returns false for runner_failure", () => {
    expect(isTransientNarrationError("runner_failure")).toBe(false);
  });
});
