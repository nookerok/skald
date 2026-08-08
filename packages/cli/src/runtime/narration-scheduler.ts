/**
 * Detached, bounded runner for LLM turn-narration (ADR-0024 "МИР" voice).
 *
 * Narration is non-authoritative read-side decoration: it must never hold the
 * per-world command queue or delay the command response. Callers schedule a
 * job right after the world cycle commits; the LLM call and the read-side
 * persistence happen asynchronously on a dedicated runner. Jobs run strictly
 * one at a time.
 *
 * Two priority queues keep an `advance N` batch from starving ordinary
 * commands: interactive jobs (normal commands / wait / offline intents) always
 * run before queued batch jobs. Batch backlog is capped separately and dropped
 * (oldest first) via `onDrop`, so a giant batch can never occupy the runner
 * for tens of minutes while later narrations wait. We never interrupt an
 * in-flight LLM request; the worst-case delay for one interactive narration is
 * a single running job, not the whole backlog.
 *
 * The scheduler owns the in-memory runtime status for every known turn:
 * `pending` while a job is queued/running, `unavailable` after a fallback,
 * error or eviction. `ready` is intentionally NOT tracked here — it is derived
 * from the persisted read-side `turn_narrations` rows in the journal handler.
 * These statuses live only in WorldRuntime process memory: no Domain Events,
 * no Rules, no Projection state.
 */
export type NarrationPriority = "interactive" | "batch";

export type NarrationJob = {
  priority: NarrationPriority;
  /** Chronicle worldTime this job narrates; used for status bookkeeping. */
  worldTime: number;
  run(): Promise<void>;
  /**
   * Called when the job is evicted from a capped queue before it runs. The
   * caller must settle the turn to `unavailable` (markUnavailable).
   */
  onDrop(): void;
};

/**
 * In-memory runtime status for a turn. `ready` is not produced here: the
 * journal handler derives it from stored `turn_narrations`.
 */
export type NarrationRuntimeStatus = "pending" | "unavailable";

/**
 * Full per-turn narration lifecycle surfaced in the journal DTO.
 * - `not_requested` — no router or nothing scheduled for this turn.
 * - `pending` — job queued/running, LLM not yet persisted.
 * - `ready` — a non-fallback narration is persisted for the turn worldTime.
 * - `unavailable` — fallback/error/eviction; no literary prose will arrive.
 */
export type NarrationState = "not_requested" | "pending" | "ready" | "unavailable";

const DEFAULT_INTERACTIVE_LIMIT = 8;
const DEFAULT_BATCH_LIMIT = 2;

export class NarrationScheduler {
  private running = false;
  private interactiveQueue: NarrationJob[] = [];
  private batchQueue: NarrationJob[] = [];
  private readonly statuses = new Map<number, NarrationRuntimeStatus>();

  constructor(
    private readonly interactiveLimit = DEFAULT_INTERACTIVE_LIMIT,
    private readonly batchLimit = DEFAULT_BATCH_LIMIT,
  ) {}

  schedule(job: NarrationJob): void {
    const queue = job.priority === "batch" ? this.batchQueue : this.interactiveQueue;
    const limit = job.priority === "batch" ? this.batchLimit : this.interactiveLimit;
    if (queue.length >= limit) {
      // Oldest evicted first; the caller's onDrop settles the turn.
      const dropped = queue.shift()!;
      dropped.onDrop();
    }
    this.statuses.set(job.worldTime, "pending");
    queue.push(job);
    void this.drain();
  }

  /** Recompose pending -> ready after a successful persist. */
  markReady(worldTime: number): void {
    this.statuses.delete(worldTime);
  }

  /** Recompose pending -> unavailable after fallback, error or eviction. */
  markUnavailable(worldTime: number): void {
    this.statuses.set(worldTime, "unavailable");
  }

  /** Runtime status for a turn; undefined means not_requested/ready-untracked. */
  statusOf(worldTime: number): "pending" | "unavailable" | undefined {
    return this.statuses.get(worldTime);
  }

  pendingCount(): number {
    return this.batchQueue.length + this.interactiveQueue.length;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.batchQueue.length > 0 || this.interactiveQueue.length > 0) {
        // Interactive always wins the head; batch only runs when nothing
        // interactive is waiting.
        const job = this.interactiveQueue.length > 0 ? this.interactiveQueue.shift()! : this.batchQueue.shift()!;
        try {
          await job.run();
        } catch {
          // Narration is best-effort decoration; a runner-level failure means
          // the turn will never get prose.
          this.statuses.set(job.worldTime, "unavailable");
        }
      }
    } finally {
      this.running = false;
    }
  }
}

/**
 * Pure DTO resolution of the per-turn narration lifecycle. `ready` derives
 * from the persisted read-side row; the in-memory scheduler runtime status
 * fills in `pending`/`unavailable`; otherwise the turn was never narrated.
 */
export function resolveNarrationState(
  persistent: { hasNonFallback: boolean },
  runtimeStatus: NarrationRuntimeStatus | undefined,
): NarrationState {
  if (persistent.hasNonFallback) return "ready";
  if (runtimeStatus === "pending") return "pending";
  if (runtimeStatus === "unavailable") return "unavailable";
  return "not_requested";
}