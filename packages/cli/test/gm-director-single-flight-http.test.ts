/**
 * Single-flight as a PRODUCTION scenario (S0 revise): the real
 * `handleWorldCommand` path with GM_DIRECTOR_SHADOW enabled and a fake router
 * blocked on a barrier, proving ONE provider call and exactly ONE
 * `gm_director` diagnostic for concurrent identical requests — and that two
 * WORLDS reusing the same idempotency key never share a call.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

/** A router whose `interpret` call blocks on a barrier and counts invocations. */
function barrierRouter() {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const chat = vi.fn(async (category: string) => {
    if (category !== "interpret") return { text: "" };
    await barrier;
    return {
      text: JSON.stringify({ schemaVersion: 1, addressee: { kind: "gm" }, kind: "conversation" }),
      provider: "ollama_cloud",
      model: "test-model",
      usedFallback: false,
    };
  });
  return { router: { apiKey: "", chat } as any, chat, release: () => release() };
}

function gmDiagnostics(manager: WorldRuntimeManager): any[] {
  return manager.narrationDiagnostics().filter((event) => (event as any).category === "gm_director") as any[];
}

async function freshManager(
  tag: string,
  worldId: string,
  router: any,
): Promise<{ manager: WorldRuntimeManager; runtime: WorldRuntime; store: ReturnType<typeof createMultiWorldStore> }> {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-sf-${tag}-`)), "events.sqlite"));
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: "Single flight",
    characterName: "Tester",
    characterPresetId: "wanderer",
    worldTemplateId: "living_region",
    characterWound: "none",
    characterPromise: "observe",
    characterPrinciple: "care",
    characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents("living_region"),
  });
  const manager = new WorldRuntimeManager(store, router);
  const runtime = await manager.get(worldId);
  return { manager, runtime, store };
}

/** A router whose `interpret` call blocks on a barrier and then REJECTS. */
function failingBarrierRouter() {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const chat = vi.fn(async (category: string) => {
    if (category !== "interpret") return { text: "" };
    await barrier;
    const error = new Error("upstream down") as Error & { provider: string; model: string };
    error.provider = "ollama_cloud";
    error.model = "gemma4:31b-cloud";
    throw error;
  });
  return { router: { apiKey: "", chat } as any, chat, release: () => release() };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor timed out");
}

describe("gm director single-flight over the real HTTP handler", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("concurrent identical requests in ONE world → one provider call, one gm_director diagnostic", async () => {
    vi.stubEnv("GM_DIRECTOR_SHADOW", "1");
    const { router, chat, release } = barrierRouter();
    const { manager, runtime } = await freshManager("one", "sf-world-1", router);

    // Both requests race; the leader's shadow call is held on the barrier
    // while the follower is processed by the per-world queue.
    // Inquiry (read-only) so the durable layer's duplicate path is the clean
    // 200-replay branch — world-changing duplicates answer 409 by design and
    // are out of scope for the provider single-flight contract.
    const [a, b] = await Promise.all([
      handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "sf-same" }),
      handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "sf-same" }),
    ]);
    const ra = parse(a);
    const rb = parse(b);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    // NOTE: a read-only inquiry duplicate answers WITHOUT a replay flag (both
    // envelopes are the same computed answer, zero events either way). The
    // durable replay semantics are out of scope here — the contract under
    // test is the PROVIDER one below: one call, one diagnostic.

    // The shadow leader reached the provider and is held there; wait for it.
    await waitFor(() => chat.mock.calls.length >= 1);
    // Give a would-be second caller the whole window to show up.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(chat.mock.calls.length).toBe(1);

    release();
    // One logical turn → exactly one gm_director diagnostic.
    await waitFor(() => gmDiagnostics(manager).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(gmDiagnostics(manager)).toHaveLength(1);
    expect(chat.mock.calls.length).toBe(1);
  });

  it("the SAME idempotency key in TWO worlds → two independent provider calls (cross-world isolation)", async () => {
    vi.stubEnv("GM_DIRECTOR_SHADOW", "1");
    const { router, chat, release } = barrierRouter();
    const a = await freshManager("xa", "sf-world-a", router);
    const b = await freshManager("xb", "sf-world-b", router);

    const [ra, rb] = await Promise.all([
      handleWorldCommand(a.runtime, { input: "Подойти к перевозчику", idempotencyKey: "sf-shared-key" }),
      handleWorldCommand(b.runtime, { input: "Подойти к перевозчику", idempotencyKey: "sf-shared-key" }),
    ]);
    expect(parse(ra).ok).toBe(true);
    expect(parse(rb).ok).toBe(true);
    // NEITHER is a replay: idempotency is scoped per world.
    expect(parse(ra).replayed).toBeUndefined();
    expect(parse(rb).replayed).toBeUndefined();

    // Both worlds fire their own shadow interpretation.
    await waitFor(() => chat.mock.calls.length >= 2);
    release();
    await waitFor(() => gmDiagnostics(a.manager).length >= 1 && gmDiagnostics(b.manager).length >= 1);
    expect(gmDiagnostics(a.manager)).toHaveLength(1);
    expect(gmDiagnostics(b.manager)).toHaveLength(1);
    expect(chat.mock.calls.length).toBe(2);
  });

  it("provider ERROR at the handler level → one failed provider call, one gm_director diagnostic", async () => {
    vi.stubEnv("GM_DIRECTOR_SHADOW", "1");
    const { router, chat, release } = failingBarrierRouter();
    const { manager, runtime } = await freshManager("fail", "sf-world-fail", router);

    const [a, b] = await Promise.all([
      handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "sf-fail" }),
      handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "sf-fail" }),
    ]);
    // The deterministic reply path is unaffected by the shadow failure.
    expect(parse(a).ok).toBe(true);
    expect(parse(b).ok).toBe(true);

    await waitFor(() => chat.mock.calls.length >= 1);
    release();
    // ONE failed provider call serves both requests: one diagnostic, outcome
    // fallback with the failing provider attributed.
    await waitFor(() => gmDiagnostics(manager).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(gmDiagnostics(manager)).toHaveLength(1);
    expect(chat.mock.calls.length).toBe(1);
    const [diagnostic] = gmDiagnostics(manager);
    expect(diagnostic.outcome).toBe("fallback");
    expect(diagnostic.provider).toBe("ollama_cloud");
  });
});
