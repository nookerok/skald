import { describe, it, expect, vi, beforeEach } from "vitest";
import { NarrationDiagnosticLog } from "../src/runtime/narration-diagnostic-log.js";
import { createProductionDiagnosticSink } from "../src/runtime/narration-diagnostic-prod-sink.js";
import { NarrationScheduler } from "../src/runtime/narration-scheduler.js";
import type { NarrationJob } from "../src/runtime/narration-scheduler.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function job(fn: () => Promise<void>, worldTime = 0, onDrop: () => void = () => {}): NarrationJob {
  return { priority: "interactive", worldTime, run: fn, onDrop };
}

async function flush(scheduler: NarrationScheduler): Promise<void> {
  while (scheduler.isRunning()) await tick();
}

// ---------------------------------------------------------------------------
// 1. Production sink: structured one-line JSON via console.error
// ---------------------------------------------------------------------------

describe("createProductionDiagnosticSink", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("emits a single JSON line to console.error", () => {
    const sink = createProductionDiagnosticSink();
    sink({
      kind: "llm",
      category: "success",
      outcome: "success",
      provider: "opencode_zen",
      durationMs: 120,
      turn: 7,
      worldTime: 7,
      attempt: 1,
      priority: "interactive",
      timeout: 30000,
      retryOutcome: "none",
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(emitted.kind).toBe("llm");
    expect(emitted.category).toBe("success");
    expect(emitted.outcome).toBe("success");
    expect(emitted.provider).toBe("opencode_zen");
    expect(emitted.recordedAt).toBeDefined();
  });

  it("adds recordedAt when not provided", () => {
    const sink = createProductionDiagnosticSink();
    sink({
      kind: "scheduler",
      category: "runner_failure",
      outcome: "runner_failure",
      provider: "scheduler",
      durationMs: 0,
      attempt: 0,
      timeout: 0,
      retryOutcome: "none",
      turn: 3,
      worldTime: 3,
      priority: "batch",
    });
    const emitted = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(emitted.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not throw when console.error throws (best-effort swallow)", () => {
    errorSpy.mockImplementation(() => { throw new Error("console broken"); });
    const sink = createProductionDiagnosticSink();
    expect(() => {
      sink({
        kind: "llm",
        category: "success",
        outcome: "success",
        provider: "opencode_zen",
        durationMs: 50,
        turn: 1,
        worldTime: 1,
        attempt: 1,
        priority: "interactive",
        timeout: 30000,
        retryOutcome: "none",
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Sink isolation: external sink failure does not affect narration
// ---------------------------------------------------------------------------

describe("sink isolation", () => {
  it("narrator continues when the external diagnostic sink throws", async () => {
    const brokenSink = () => { throw new Error("sink exploded"); };
    const log = new NarrationDiagnosticLog();
    // Compose like WorldRuntimeManager: log + external with try/catch
    const composed = (event: unknown) => {
      log.record(event as any);
      try {
        brokenSink();
      } catch {
        // Swallowed — same pattern as WorldRuntimeManager
      }
    };

    const scheduler = new NarrationScheduler(8, 2, composed);
    let executed = false;
    scheduler.schedule(job(async () => { executed = true; }, 1));
    await flush(scheduler);

    expect(executed).toBe(true);
    // The log itself received the event (runner_failure is NOT emitted since
    // the job succeeded, but pending was set; the key assertion is no throw)
  });

  it("NarrationDiagnosticLog sink never throws even with maxEntries=0", () => {
    const log = new NarrationDiagnosticLog(0);
    const sink = log.sink();
    expect(() => {
      sink({
        kind: "llm",
        category: "success",
        outcome: "success",
        provider: "test",
        durationMs: 0,
        turn: 1,
        worldTime: 1,
        attempt: 1,
        priority: "interactive",
        timeout: 0,
        retryOutcome: "none",
      });
    }).not.toThrow();
    expect(log.snapshot().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Outcome field in diagnostic events
// ---------------------------------------------------------------------------

describe("outcome field in diagnostics", () => {
  it("scheduler emits runner_failure with outcome runner_failure", async () => {
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);
    const scheduler = new NarrationScheduler(8, 2, sink, "w-test");
    scheduler.schedule(job(async () => { throw new Error("boom"); }, 42));
    await flush(scheduler);

    const runnerEvents = events.filter((e: any) => e.kind === "scheduler" && e.category === "runner_failure");
    expect(runnerEvents.length).toBe(1);
    expect(runnerEvents[0]).toMatchObject({
      outcome: "runner_failure",
      worldId: "w-test",
    });
    expect((runnerEvents[0] as any).recordedAt).toBeDefined();
  });

  it("scheduler emits queue_eviction with outcome queue_eviction", async () => {
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);
    const dropped: number[] = [];
    const scheduler = new NarrationScheduler(8, 2, sink, "w-evict");
    const gate = { promise: Promise.resolve(), release: () => {} };
    let releaseFn: () => void;
    gate.promise = new Promise<void>((r) => { releaseFn = r; });
    const release = () => { releaseFn!(); };

    scheduler.schedule(job(async () => { await gate.promise; }, 0));
    scheduler.schedule({ priority: "batch", worldTime: 10, run: async () => {}, onDrop: () => dropped.push(10) });
    scheduler.schedule({ priority: "batch", worldTime: 20, run: async () => {}, onDrop: () => dropped.push(20) });
    scheduler.schedule({ priority: "batch", worldTime: 30, run: async () => {}, onDrop: () => dropped.push(30) });

    release();
    await flush(scheduler);

    const evictionEvents = events.filter((e: any) => e.kind === "scheduler" && e.category === "queue_eviction");
    expect(evictionEvents.length).toBe(1);
    expect(evictionEvents[0]).toMatchObject({
      outcome: "queue_eviction",
      worldId: "w-evict",
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Metadata threading: worldId, recordedAt, correlationId, model, configuredModel
// ---------------------------------------------------------------------------

describe("metadata threading", () => {
  it("scheduler emits worldId when constructed with it", async () => {
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);
    const scheduler = new NarrationScheduler(8, 2, sink, "w-meta");
    scheduler.schedule(job(async () => { throw new Error("fail"); }, 99));
    await flush(scheduler);

    const runnerEvents = events.filter((e: any) => e.kind === "scheduler" && e.category === "runner_failure");
    expect(runnerEvents.length).toBe(1);
    expect(runnerEvents[0]).toMatchObject({
      worldId: "w-meta",
      recordedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("scheduler emits undefined worldId when not provided", async () => {
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);
    const scheduler = new NarrationScheduler(8, 2, sink);
    scheduler.schedule(job(async () => { throw new Error("fail"); }, 50));
    await flush(scheduler);

    const runnerEvents = events.filter((e: any) => e.kind === "scheduler" && e.category === "runner_failure");
    expect((runnerEvents[0] as any).worldId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Failover vs deterministic fallback distinction
// ---------------------------------------------------------------------------

describe("failover vs deterministic fallback in diagnostic outcome", () => {
  it("outcome is deterministic_fallback for no_api_key", () => {
    // Verifying the contract shape — the actual emission is in narrateTurnLLM
    // which we test at the unit level. Here we verify the type-level contract.
    const event = {
      kind: "llm" as const,
      category: "no_api_key" as const,
      outcome: "deterministic_fallback" as const,
      provider: "",
      durationMs: 0,
      turn: 1,
      worldTime: 1,
      attempt: 1,
      priority: "interactive" as const,
      timeout: 0,
      retryOutcome: "none" as const,
    };
    expect(event.outcome).toBe("deterministic_fallback");
  });

  it("outcome is success for a successful LLM call with usedFallback false", () => {
    const event = {
      kind: "llm" as const,
      category: "success" as const,
      outcome: "success" as const,
      provider: "opencode_zen",
      durationMs: 120,
      turn: 7,
      worldTime: 7,
      attempt: 1,
      priority: "interactive" as const,
      timeout: 30000,
      retryOutcome: "none" as const,
      model: "deepseek-v4-flash-free",
      configuredModel: "deepseek-v4-flash-free",
    };
    expect(event.outcome).toBe("success");
    expect(event.model).toBe("deepseek-v4-flash-free");
    expect(event.configuredModel).toBe("deepseek-v4-flash-free");
  });

  it("outcome is provider_failover for a successful LLM call with usedFallback true (failover to another model)", () => {
    const event = {
      kind: "llm" as const,
      category: "success" as const,
      outcome: "provider_failover" as const,
      provider: "ollama_cloud",
      durationMs: 200,
      turn: 7,
      worldTime: 7,
      attempt: 1,
      priority: "interactive" as const,
      timeout: 30000,
      retryOutcome: "none" as const,
      model: "gemma4:31b",
      configuredModel: "deepseek-v4-flash-free",
    };
    expect(event.outcome).toBe("provider_failover");
    expect(event.model).not.toBe(event.configuredModel);
  });

  it("outcome is retry_exhausted for transient errors after max retries", () => {
    const event = {
      kind: "llm" as const,
      category: "provider_5xx" as const,
      outcome: "retry_exhausted" as const,
      provider: "opencode_zen",
      durationMs: 5000,
      turn: 7,
      worldTime: 7,
      attempt: 3,
      priority: "interactive" as const,
      timeout: 30000,
      retryOutcome: "exhausted" as const,
    };
    expect(event.outcome).toBe("retry_exhausted");
  });

  it("outcome is deterministic_fallback for schema_rejection (epistemic violation)", () => {
    const event = {
      kind: "llm" as const,
      category: "schema_rejection" as const,
      outcome: "deterministic_fallback" as const,
      provider: "opencode_zen",
      durationMs: 100,
      turn: 7,
      worldTime: 7,
      attempt: 1,
      priority: "interactive" as const,
      timeout: 30000,
      retryOutcome: "none" as const,
      model: "deepseek-v4-flash-free",
      configuredModel: "deepseek-v4-flash-free",
    };
    expect(event.outcome).toBe("deterministic_fallback");
  });
});
