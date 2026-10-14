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

function gmRows(manager: WorldRuntimeManager): any[] {
  return manager.narrationDiagnostics().filter((event) => (event as any).category === "gm_director") as any[];
}
/** Rows where the director actually ran (leader). Excludes `shared` joins. */
function gmDecisions(manager: WorldRuntimeManager): any[] {
  return gmRows(manager).filter((row) => row.outcome !== "shared");
}
/**
 * Rows emitted ONLY when a request REACHED the shadow path and joined the
 * leader's in-flight call — the observable proof that single-flight fired
 * (a request that replayed earlier never produces one).
 */
function gmShared(manager: WorldRuntimeManager): any[] {
  return gmRows(manager).filter((row) => row.outcome === "shared");
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

  it("concurrent identical requests → one interpret call, one decision row, one SHARED row (both reached shadow)", async () => {
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
    // One leader decision row…
    await waitFor(() => gmRows(manager).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(gmDecisions(manager)).toHaveLength(1);
    expect(gmDecisions(manager)[0].outcome).toBe("decision");
    // …and ONE `shared` row: the follower REACHED this shadow path and joined
    // the leader's in-flight call. Without it this test could pass merely
    // because the second request replayed at the durable layer.
    expect(gmShared(manager)).toHaveLength(1);
    expect(gmShared(manager)[0].correlationId).toBe(gmDecisions(manager)[0].correlationId);
    // Exactly ONE provider interpret call behind both rows.
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

    // Both worlds fire their own shadow interpretation; neither joins the
    // other (different turnKeys) — no `shared` rows anywhere.
    await waitFor(() => chat.mock.calls.length >= 2);
    release();
    await waitFor(() => gmDecisions(a.manager).length >= 1 && gmDecisions(b.manager).length >= 1);
    expect(gmDecisions(a.manager)).toHaveLength(1);
    expect(gmDecisions(b.manager)).toHaveLength(1);
    expect(gmShared(a.manager)).toHaveLength(0);
    expect(gmShared(b.manager)).toHaveLength(0);
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
    // ONE failed provider call serves both requests: one decision row
    // (outcome=fallback, provider attributed) plus one `shared` row proving
    // the follower reached the shadow path and joined the failing call.
    await waitFor(() => gmRows(manager).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(gmDecisions(manager)).toHaveLength(1);
    expect(gmDecisions(manager)[0].outcome).toBe("fallback");
    expect(gmDecisions(manager)[0].provider).toBe("ollama_cloud");
    expect(gmShared(manager)).toHaveLength(1);
    expect(chat.mock.calls.length).toBe(1);
  });
});
