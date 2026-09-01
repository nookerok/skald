/**
 * DOM-independent narration-settlement poller (ADR-0024 "МАСТЕР" voice).
 *
 * The browser must not guess "is the narration ready yet?" by elapsed time:
 * the server journal DTO now reports a per-turn `narrationState`
 * (`pending`/`ready`/`unavailable`/`not_requested`). This module owns the only
 * state a stale-tick needs: one live session per generation. Every rearm
 * cancels the previous timer and bumps the generation; a tick that resolves
 * after a newer session started discovers its generation is stale and exits
 * without touching state or scheduling a timer. Two concurrent ticks can
 * therefore never create two timers.
 *
 * Stop conditions are explicit decisions, not fixed timeouts:
 *   - `ready`      -> chronicle updated, stop
 *   - `unavailable`/`not_requested` -> stop
 *   - `pending`    -> continue polling
 *   - world change or exit           -> cancelled by caller before the tick
 *   - watchdog (default 150s)        -> only protects against a wedged state
 */
/** Exact lifecycle lookup; legacy time-only lookup is safe only if unique. */
export function resolveNarrationPollState(turns, { targetNarrationHandle = null, targetWorldTime = null } = {}) {
  const candidates = Array.isArray(turns) ? turns : [];
  const matches = targetNarrationHandle
    ? candidates.filter((turn) => turn.narrationHandle === targetNarrationHandle)
    : candidates.filter((turn) => turn.worldTime === targetWorldTime);
  return matches.length === 1 ? matches[0].narrationState ?? "not_requested" : "not_requested";
}

export function createNarrationPoll({ intervalMs = 400, watchdogMs = 150000, onStopped = () => {} } = {}) {
  let live = null;
  let nextGeneration = 0;

  function isStale(generation) {
    return live === null || live.generation !== generation;
  }

  function stop() {
    if (live && live.timer) clearTimeout(live.timer);
    live = null;
  }

  /** Starts (or re-arms) a polling session. Returns the new session object. */
  function start(pollFn, { worldId = null, targetWorldTime = null, targetNarrationHandle = null } = {}) {
    if (live && live.timer) clearTimeout(live.timer);
    const generation = ++nextGeneration;
    const session = {
      generation, worldId, targetWorldTime, targetNarrationHandle, attempts: 0, startedAt: Date.now(), timer: null,
    };
    live = session;
    scheduleTick(session, pollFn);
    return session;
  }

  function scheduleTick(session, pollFn) {
    const token = session;
    session.timer = setTimeout(async () => {
      // Stale tick (a newer session replaced this one): exit without any
      // side effect and WITHOUT scheduling the next timer.
      if (isStale(token.generation)) return;
      let status;
      try {
        status = await pollFn({ worldId: token.worldId, targetWorldTime: token.targetWorldTime, targetNarrationHandle: token.targetNarrationHandle });
      } catch {
        status = "unavailable";
      }
      if (isStale(token.generation)) return; // superseded while awaiting
      token.attempts += 1;
      if (status === "pending" && Date.now() - token.startedAt < watchdogMs) {
        scheduleTick(session, pollFn);
        return;
      }
      const settled = status === "pending" ? { reason: "watchdog", status: "unavailable" } : status;
      stop();
      onStopped({ sessionId: token.generation, status: typeof settled === "object" ? settled.status : settled });
    }, intervalMs);
  }

  function isActive() {
    return live !== null;
  }

  function active() {
    return live;
  }

  return { start, stop, isActive, active };
}
