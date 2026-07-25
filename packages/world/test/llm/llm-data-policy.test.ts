import { describe, it, expect } from "vitest";
import { scanForSecrets, enforceDataPolicy, classifyPayload } from "../../src/llm/data-policy.js";

describe("scanForSecrets", () => {
  it("finds sk-or-v1- key", () => {
    const found = scanForSecrets("my key is sk-or-v1-abc123def");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toContain("sk-or-v1-");
  });

  it("returns empty for plain text", () => {
    expect(scanForSecrets("plain text without secrets")).toEqual([]);
  });

  it("finds PEM key", () => {
    const found = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----");
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("enforceDataPolicy", () => {
  it("allows plain text", () => {
    const result = enforceDataPolicy("hello world", "project_context", "opencode_zen");
    expect(result.ok).toBe(true);
  });

  it("blocks secrets", () => {
    const result = enforceDataPolicy("my key is sk-or-v1-xxx", "project_context", "opencode_zen");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("secret");
  });
});

describe("classifyPayload", () => {
  it("uses explicit class", () => {
    const result = classifyPayload("hello", "secrets");
    expect(result.class).toBe("secrets");
  });

  it("defaults to project_context", () => {
    const result = classifyPayload("hello");
    expect(result.class).toBe("project_context");
  });

  it("detects secrets", () => {
    const result = classifyPayload("key sk-or-v1-abc");
    expect(result.class).toBe("secrets");
  });
});
