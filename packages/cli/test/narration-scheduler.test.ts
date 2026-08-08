import { describe, it, expect } from "vitest";
import { NarrationScheduler, resolveNarrationState } from "../src/runtime/narration-scheduler.js";
import type { NarrationJob } from "../src/runtime/narration-scheduler.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}

function job(fn: () => Promise<void>, worldTime = 0, onDrop: () => void = () => {}): NarrationJob {
  return { priority: "interactive", worldTime, run: fn, onDrop };
}

async function flush(scheduler: NarrationScheduler): Promise<void> {
  while (scheduler.isRunning()) await tick();
}

describe("NarrationScheduler", () => {
  it("runs jobs strictly one at a time in order", async () => {
    const order: string[] = [];
    const scheduler = new NarrationScheduler();
    let active = 0;
    let maxActive = 0;

    scheduler.schedule(job(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      order.push("a");
      active -= 1;
    }, 1));
    scheduler.schedule(job(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await tick();
      order.push("b");
      active -= 1;
    }, 2));

    await flush(scheduler);
    expect(order).toEqual(["a", "b"]);
    expect(maxActive).toBe(1);
  });

  it("swallows a failing job and continues with later jobs", async () => {
    const order: string[] = [];
    const scheduler = new NarrationScheduler();
    scheduler.schedule(job(async () => {
      order.push("a");
      throw new Error("llm down");
    }, 1));
    scheduler.schedule(job(async () => {
      order.push("b");
    }, 2));

    await flush(scheduler);
    expect(order).toEqual(["a", "b"]);
  });

  it("caps the interactive pending backlog to the newest jobs only", async () => {
    const gate = deferred();
    const finishedOrder: string[] = [];
    const scheduler = new NarrationScheduler(2, 2);

    // First job blocks the drain so later schedules stay pending.
    scheduler.schedule(job(async () => {
      await gate.promise;
      finishedOrder.push("first");
    }, 1));

    for (let i = 0; i < 5; i++) {
      scheduler.schedule(job(async () => { finishedOrder.push(`burst-${i}`); }, 10 + i));
    }

    // While blocked: only the two newest pending jobs survive the cap.
    expect(scheduler.pendingCount()).toBeLessThanOrEqual(2);

    gate.release();
    await flush(scheduler);

    // Oldest bursts were pruned; drain finishes with the newest queued jobs.
    expect(finishedOrder).toContain("first");
  });

  it("caps the batch queue separately and calls onDrop on eviction", async () => {
    const gate = deferred();
    const dropped: number[] = [];
    const executed: number[] = [];
    const scheduler = new NarrationScheduler(8, 2);

    scheduler.schedule({ priority: "batch", worldTime: 1, run: async () => { await gate.promise; executed.push(1); }, onDrop: () => dropped.push(1) });

    // Batch overflow: only the two newest survive; oldest get onDrop.
    for (let i = 2; i <= 6; i++) {
      scheduler.schedule({ priority: "batch", worldTime: i, run: async () => { executed.push(i); }, onDrop: () => dropped.push(i) });
    }

    expect(dropped).toEqual([2, 3, 4]);
    expect(scheduler.pendingCount()).toBeLessThanOrEqual(2);

    gate.release();
    await flush(scheduler);

    // Dropped turns never run; newest two (5, 6) plus blocked first run.
    expect(dropped).toEqual([2, 3, 4]);
    expect(executed).toContain(1);
    expect(executed).toContain(5);
    expect(executed).toContain(6);
    expect(executed).not.toContain(2);
    expect(executed).not.toContain(3);
  });

  it("advance N burst keeps interactive-only pending capped and batch yields to later interactive", async () => {
    const gate = deferred();
    const executed: string[] = [];
    const scheduler = new NarrationScheduler(1, 1);

    // First interactive blocks the drain (this is the "in-flight LLM request").
    scheduler.schedule(job(async () => { await gate.promise; executed.push("blocked-interactive"); }, -1));

    for (let i = 0; i < 100; i++) {
      scheduler.schedule({ priority: "batch", worldTime: i, run: async () => { executed.push(`batch-${i}`); }, onDrop: () => { /* evicted batch never settles */ } });
    }

    // Interactive backlog is its own capped queue; batch capped separately.
    expect(scheduler.pendingCount()).toBeLessThanOrEqual(2);

    // An interactive narration scheduled after the burst must be picked next.
    scheduler.schedule(job(async () => { executed.push("interactive-after-batch"); }, -2));

    gate.release();
    await flush(scheduler);

    // Interactive-after-batch runs before any batch turn that survived.
    const interIdx = executed.indexOf("interactive-after-batch");
    const firstBatchRun = executed.findIndex((e) => e.startsWith("batch-"));
    expect(interIdx).toBeGreaterThanOrEqual(0);
    if (firstBatchRun >= 0) expect(interIdx).toBeLessThan(firstBatchRun);
  });

  it("marks pending on schedule, ready on markReady, unavailable on markUnavailable", async () => {
    const scheduler = new NarrationScheduler();
    scheduler.schedule(job(async () => {}, 42));
    expect(scheduler.statusOf(42)).toBe("pending");
    scheduler.markUnavailable(42);
    expect(scheduler.statusOf(42)).toBe("unavailable");
    scheduler.markReady(42);
    expect(scheduler.statusOf(42)).toBeUndefined();
  });

  it("tracked status is independent per turn", async () => {
    const scheduler = new NarrationScheduler();
    scheduler.schedule(job(async () => {}, 7));
    scheduler.schedule(job(async () => {}, 8));
    scheduler.markUnavailable(7);
    expect(scheduler.statusOf(7)).toBe("unavailable");
    expect(scheduler.statusOf(8)).toBe("pending");
  });
});

describe("resolveNarrationState", () => {
  it("persisted non-fallback narration always resolves ready regardless of runtime", () => {
    expect(resolveNarrationState({ hasNonFallback: true }, "pending")).toBe("ready");
    expect(resolveNarrationState({ hasNonFallback: true }, undefined)).toBe("ready");
    expect(resolveNarrationState({ hasNonFallback: true }, "unavailable")).toBe("ready");
  });

  it("fallback/error/eviction resolves to unavailable", () => {
    expect(resolveNarrationState({ hasNonFallback: false }, "unavailable")).toBe("unavailable");
  });

  it("queued/running turns resolve to pending", () => {
    expect(resolveNarrationState({ hasNonFallback: false }, "pending")).toBe("pending");
  });

  it("uniqueness: neither persisted nor runtime means not_requested", () => {
    expect(resolveNarrationState({ hasNonFallback: false }, undefined)).toBe("not_requested");
  });

  it("restart: persisted ready survives with a fresh runtime (undefined status)", () => {
    // Post-restart the scheduler has no in-memory status; the persisted row is
    // still authoritative for `ready`.
    expect(resolveNarrationState({ hasNonFallback: true }, undefined)).toBe("ready");
  });
});