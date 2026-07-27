// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("api-client retry", () => {
  let fetchCalls: Array<{ url: string; body: unknown }>;

  beforeEach(() => {
    fetchCalls = [];
    vi.stubGlobal("fetch", vi.fn((url: string, opts: RequestInit) => {
      const body = JSON.parse((opts.body as string) ?? "{}");
      fetchCalls.push({ url, body });
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retryLast sends the same idempotencyKey as the original sendCommand", async () => {
    const { sendCommand, retryLast } = await import("../public/api-client.js");

    await sendCommand("move north");
    expect(fetchCalls).toHaveLength(1);
    const firstKey = fetchCalls[0]!.body.idempotencyKey;
    expect(firstKey).toBeTruthy();

    await retryLast();
    expect(fetchCalls).toHaveLength(2);
    const secondKey = fetchCalls[1]!.body.idempotencyKey;
    // Retry must reuse the same key
    expect(secondKey).toBe(firstKey);
  });

  it("normal sendCommand creates a new key each time", async () => {
    const { sendCommand } = await import("../public/api-client.js");

    await sendCommand("move north");
    await sendCommand("move east");
    const key1 = fetchCalls[0]!.body.idempotencyKey;
    const key2 = fetchCalls[1]!.body.idempotencyKey;
    expect(key1).not.toBe(key2);
  });

  it("creates unique keys on plain HTTP when crypto.randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    const { sendCommand } = await import("../public/api-client.js");

    await sendCommand("move north");
    await sendCommand("move east");

    const key1 = fetchCalls[0]!.body.idempotencyKey as string;
    const key2 = fetchCalls[1]!.body.idempotencyKey as string;
    expect(key1).toMatch(/^web-/);
    expect(key2).toMatch(/^web-/);
    expect(key1).not.toBe(key2);
  });
});
