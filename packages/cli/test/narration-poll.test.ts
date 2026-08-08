// @ts-nocheck
import { describe, it, expect, vi } from "vitest";

describe("createNarrationPoll", () => {
  it("polls pending repeatedly well beyond the old 24s wall and stops on ready", async () => {
    vi.useFakeTimers();
    const { createNarrationPoll } = await import("../public/narration-poll.js");
    let calls = 0;
    let settled: Settlement = null;
    const poll = createNarrationPoll({ intervalMs: 10, watchdogMs: 10000, onStopped: (s: Settlement) => { settled = s; } });
    const session = poll.start(() => {
      calls += 1;
      return calls >= 300 ? "ready" : "pending";
    }, { worldId: "w1", targetWorldTime: 42 });

    // 3s of fake time at 10ms intervals = 300 ticks; a fixed ~12s budget
    // would have stopped long ago, but `pending` keeps polling until ready.
    await vi.advanceTimersByTimeAsync(3000);

    expect(calls).toBeGreaterThanOrEqual(100);
    expect(poll.isActive()).toBe(false);
    expect(settled).not.toBeNull();
    expect(settled!.status).toBe("ready");
    expect(settled!.sessionId).toBe(session.generation);
    vi.useRealTimers();
  });

  it.each(["unavailable", "not_requested"])("stops immediately on terminal %s", async (terminal: string) => {
    vi.useFakeTimers();
    const { createNarrationPoll } = await import("../public/narration-poll.js");
    let calls = 0;
    let settled: Settlement = null;
    const poll = createNarrationPoll({ intervalMs: 10, watchdogMs: 10000, onStopped: (s: Settlement) => { settled = s; } });
    poll.start(() => { calls += 1; return terminal; }, { worldId: "w1", targetWorldTime: 1 });
    await vi.advanceTimersByTimeAsync(50);
    expect(poll.isActive()).toBe(false);
    expect(calls).toBe(1);
    expect(settled!.status).toBe(terminal);
    vi.useRealTimers();
  });

  it("watchdog stops a wedged pending session and reports unavailable", async () => {
    vi.useFakeTimers();
    const { createNarrationPoll } = await import("../public/narration-poll.js");
    let settled: Settlement = null;
    const poll = createNarrationPoll({ intervalMs: 10, watchdogMs: 100, onStopped: (s: Settlement) => { settled = s; } });
    const session = poll.start(() => "pending", { worldId: "w1", targetWorldTime: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(poll.isActive()).toBe(false);
    expect(settled).not.toBeNull();
    expect(settled!.status).toBe("unavailable");
    expect(settled!.sessionId).toBe(session.generation);
    vi.useRealTimers();
  });

  it("rearm cancels the previous session; an in-flight stale tick is a no-op", async () => {
    vi.useFakeTimers();
    const { createNarrationPoll } = await import("../public/narration-poll.js");
    const order: string[] = [];
    const poll = createNarrationPoll({ intervalMs: 10, watchdogMs: 10000 });

    // First session fires one tick that awaits a gate (the in-flight LLM)
    // which we do NOT release until after the rearm.
    let releaseFirst = null;
    poll.start(() => new Promise<void>((res) => { releaseFirst = () => res(undefined); }), { worldId: "A", targetWorldTime: 1 });
    await vi.advanceTimersByTimeAsync(10); // first poll tick fires, starts awaiting
    await Promise.resolve();

    // Rearm to a brand-new session (a new player command).
    const sessionB = poll.start(() => { order.push("B-tick"); return "pending"; }, { worldId: "B", targetWorldTime: 2 });

    // Release the stale A tick AFTER the rearm — it must not schedule anew.
    releaseFirst?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
    expect(order).toEqual(["B-tick", "B-tick"]);
    expect(sessionB.generation).toBeGreaterThanOrEqual(2);
    poll.stop();
    vi.useRealTimers();
  });

  it("rearm never double-schedules: only the newest session's timer runs", async () => {
    vi.useFakeTimers();
    const { createNarrationPoll } = await import("../public/narration-poll.js");
    let calls = 0;
    const poll = createNarrationPoll({ intervalMs: 10, watchdogMs: 10000 });
    poll.start(() => { calls += 1; return "pending"; }, { worldId: "w1", targetWorldTime: 1 });
    const a = poll.active();
    poll.start(() => { calls += 1; return "ready"; }, { worldId: "w1", targetWorldTime: 1 });
    const b = poll.active();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toBe(1); // only newest session ticked once
    expect(a).not.toBe(b);
    expect(b.generation).toBeGreaterThan(a.generation);
    vi.useRealTimers();
  });
});