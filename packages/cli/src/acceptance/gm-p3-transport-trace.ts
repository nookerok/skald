import { AsyncLocalStorage } from "node:async_hooks";
import type { Category } from "@skald/world";
import { summarizeP3LiveRunnerFailure, type P3LiveRunnerFailureSummary } from "./gm-p3-live-gate.js";
import type { OpenCodeHttpObservation } from "./opencode-live-budget.js";

/** Separate cold starts from requests causally owned by a gameplay router call. */
export type P3TransportPhase = "initial_prewarm" | "reload_prewarm" | "router_call";

interface TransportScope {
  readonly scopeId: number;
  readonly phase: P3TransportPhase;
  readonly category: Category | null;
}

type TransportEvent = {
  readonly type: "started";
  /** Serialized UTF-8 chat frame size, without retaining any message content. */
  readonly messageBytes?: number;
} | {
  readonly type: "finished";
  readonly outcome: "returned" | "threw";
  readonly elapsedMs: number;
  readonly failure?: P3LiveRunnerFailureSummary;
} | ({
  readonly type: "http";
} & OpenCodeHttpObservation);

const EVENT_LIMIT = 512;

/**
 * Bounded, per-run trace. Async scoping happens in the router/prewarm caller,
 * not the outer HTTP client, so overlapped awaits cannot reattribute requests.
 * The only accepted HTTP input is the budget guard's allowlisted observation.
 */
export function createP3TransportTrace() {
  const context = new AsyncLocalStorage<TransportScope>();
  const entries: Array<TransportEvent & {
    readonly sequence: number;
    readonly scopeId: number | null;
    readonly phase: P3TransportPhase | "unscoped";
    readonly category: Category | null;
  }> = [];
  let nextScopeId = 1;
  let nextSequence = 1;
  let droppedEntries = 0;
  function append(event: TransportEvent, scope?: TransportScope) {
    const sequence = nextSequence++;
    if (entries.length >= EVENT_LIMIT) {
      droppedEntries++;
      return;
    }
    entries.push({
      ...event,
      sequence,
      scopeId: scope?.scopeId ?? null,
      phase: scope?.phase ?? "unscoped",
      category: scope?.category ?? null,
    });
  }
  return {
    /** Record a completed or failed dispatch without changing its result. */
    observeHttp(observation: OpenCodeHttpObservation): void {
      append({
        type: "http",
        operation: observation.operation,
        httpStatus: observation.httpStatus,
        elapsedMs: observation.elapsedMs,
        retryAfterHeader: observation.retryAfterHeader,
      }, context.getStore());
    },
    /** Record the completion of a prewarm or router call, including local rejection. */
    async run<T>(phase: P3TransportPhase, category: Category | null, run: () => Promise<T>, messageBytes?: number): Promise<T> {
      const scope = { scopeId: nextScopeId++, phase, category };
      const startedAt = performance.now();
      append({
        type: "started",
        ...(messageBytes !== undefined && Number.isSafeInteger(messageBytes) && messageBytes >= 0 ? { messageBytes } : {}),
      }, scope);
      try {
        const result = await context.run(scope, run);
        append({ type: "finished", outcome: "returned", elapsedMs: Math.round(performance.now() - startedAt) }, scope);
        return result;
      } catch (error) {
        append({
          type: "finished", outcome: "threw", elapsedMs: Math.round(performance.now() - startedAt),
          failure: summarizeP3LiveRunnerFailure(error),
        }, scope);
        throw error;
      }
    },
    /** Cursor marks are observation windows; scopeId is causal attribution. */
    checkpoint: () => nextSequence - 1,
    snapshot: () => ({ entries: [...entries], droppedEntries }),
  };
}
