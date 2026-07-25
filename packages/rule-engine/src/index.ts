/**
 * @skald/rule-engine
 *
 * Generic, world-agnostic rule engine. Knows nothing about gameplay
 * (players, walls, moves) — only about Domain Events, phases, a queue, and
 * a Projection that can be snapshotted, applied, and cloned. Gameplay lives
 * in the Rule implementations (package `world`).
 *
 * AGENTS.md invariants honoured here:
 * - Rule contract: `(Event, ReadonlyWorld) => Event[]`. Here `W` is the
 *   generic read-only snapshot type; rules receive a frozen snapshot.
 * - Snapshot-consistency: all rules processing one dequeued event read the
 *   same snapshot, taken at dequeue time. The working projection is updated
 *   only after every rule for that event has run.
 * - Top-level Command transaction: events accumulate in a staged, in-memory
 *   list; canonical Event Log + Projection are touched only on successful
 *   commit, as one atomic batch. A thrown rule aborts and discards the lot.
 * - No infinite loops: hard `MAX_ITERATIONS` guard.
 * - RuleEngine never sees a PlayerCommand — only Domain Events.
 */

import { type DomainEvent, EventBus } from "@skald/event-bus";

export type Phase = "validation" | "physics" | "consequence" | "notification";

export const PHASE_ORDER: readonly Phase[] = [
  "validation",
  "physics",
  "consequence",
  "notification",
];

/** A pure, deterministic rule handler. Must not mutate `world`. */
export type RuleHandler<W> = (event: DomainEvent, world: W) => DomainEvent[];

export interface Rule<W> {
  id: string;
  phase: Phase;
  listens: string[];
  /** Declarative: event types this rule may produce. Not enforced in v1. */
  produces: string[];
  handle: RuleHandler<W>;
}

/**
 * The engine's view of a Projection store. Implemented by the world package
 * (WorldProjector). Clone returns an independent working copy used during a
 * transaction so the canonical projection stays untouched until commit.
 *
 * IMPORTANT (AGENTS.md "WorldProjector listens via EventBus.subscribe" vs
 * direct apply): the canonical Projection is updated DIRECTLY by the
 * RuleEngine inside the atomic commit loop — `projection.apply(event)` is
 * called for every committed event. We do NOT rely on EventBus.subscribe
 * for this, for two reasons documented in docs/ARCHITECTURE.md exploration:
 *   (a) EventBus.subscribe is per-event-type with no wildcard, but
 *       `eventNumber`/`world.time` must count EVERY committed event —
 *       subscribing to all enumerable types is unmaintainable.
 *   (b) AGENTS §12.2 requires the canonical Projection to update atomically
 *       together with the log commit; direct-apply inside the commit loop
 *       satisfies this exactly. `publish` remains available for narrative /
 *       future read models.
 * The Projection Purity CI test proves the live projection is byte-identical
 * to a from-scratch replay, so this deviation is behaviourally invisible.
 */
export interface ProjectionStore<W> {
  /** A frozen, read-only snapshot of the current projection. */
  getSnapshot(): W;
  /** Apply a committed event, mutating internal state. Only the World
   *  Projector produces world state (AGENTS invariant #2). */
  apply(event: DomainEvent): void;
  /** Independent deep copy of current state. */
  clone(): ProjectionStore<W>;
}

export class RuleRegistry<W> {
  private readonly byPhase: Map<Phase, Rule<W>[]> = new Map();

  /**
   * Register a rule. Rules are registered once at startup (composition root
   * in `cli/`). Dynamic registration is forbidden (AGENTS invariant #5).
   * Within a phase, order = registration order.
   */
  register(rule: Rule<W>): void {
    if (PHASE_ORDER.indexOf(rule.phase) === -1) {
      throw new Error(`RuleRegistry: unknown phase "${rule.phase}"`);
    }
    let list = this.byPhase.get(rule.phase);
    if (!list) {
      list = [];
      this.byPhase.set(rule.phase, list);
    }
    list.push(rule);
  }

  /** Rules for a phase, in registration order, that listen to `eventType`. */
  listenersFor(eventType: string, phase: Phase): readonly Rule<W>[] {
    const list = this.byPhase.get(phase);
    if (!list) return [];
    return list.filter((r) => r.listens.includes(eventType));
  }

  hasRulesFor(eventType: string, phase: Phase): boolean {
    return this.listenersFor(eventType, phase).length > 0;
  }
}

/** Hard limit on dequeue iterations for a single top-level Command. */
export const MAX_ITERATIONS = 10_000;

/** Engineering error: the rule contract was violated by an exception. Not a
 *  Domain Event — a bug. The whole transaction is discarded. */
export class RuleProcessingError extends Error {
  readonly failedRuleId: string;
  readonly failedEventType: string;
  readonly stagedEvents: DomainEvent[];
  constructor(
    failedRuleId: string,
    failedEventType: string,
    stagedEvents: DomainEvent[],
    cause: unknown,
  ) {
    const causeMessage =
      cause instanceof Error ? cause.message : String(cause);
    super(
      `Rule "${failedRuleId}" threw while handling "${failedEventType}": ${causeMessage}`,
    );
    this.name = "RuleProcessingError";
    this.failedRuleId = failedRuleId;
    this.failedEventType = failedEventType;
    this.stagedEvents = stagedEvents;
  }
}

/** Engineering error: the queue did not drain within MAX_ITERATIONS. */
export class MaxIterationsExceededError extends Error {
  readonly queueDump: DomainEvent[];
  readonly iterations: number;
  constructor(iterations: number, queueDump: DomainEvent[]) {
    super(
      `RuleEngine: max iterations (${MAX_ITERATIONS}) exceeded after ${iterations} steps. ` +
        `Remaining queue (${queueDump.length} events) dumped.`,
    );
    this.name = "MaxIterationsExceededError";
    this.iterations = iterations;
    this.queueDump = queueDump;
  }
}

export interface ProcessResult {
  /** Events committed to the canonical log, in commit (dequeue) order. */
  committed: DomainEvent[];
}

export class RuleEngine<W> {
  constructor(
    private readonly registry: RuleRegistry<W>,
    private readonly projection: ProjectionStore<W>,
    private readonly bus: EventBus,
  ) {}

  /**
   * Process a single top-level Command's first Domain Event to completion.
   * Throws on engineering errors (rule exceptions / max-iterations). Normal
   * domain outcomes (MovementBlocked, etc.) are returned as committed events.
   */
  process(firstEvent: DomainEvent): ProcessResult {
    const working = this.projection.clone();
    const staged: DomainEvent[] = [];
    const queue: DomainEvent[] = [firstEvent];
    let iterations = 0;

    let failed: { ruleId: string; eventType: string; cause: unknown } | null =
      null;

    outer: while (queue.length > 0) {
      iterations++;
      if (iterations > MAX_ITERATIONS) {
        throw new MaxIterationsExceededError(iterations, queue.slice());
      }

      const event = queue.shift() as DomainEvent;
      // Snapshot taken at dequeue — all rules for THIS event read this copy.
      const snapshot = working.getSnapshot();

      const producedForThisEvent: DomainEvent[] = [];
      for (const phase of PHASE_ORDER) {
        const rules = this.registry.listenersFor(event.type, phase);
        for (const rule of rules) {
          try {
            const produced = rule.handle(event, snapshot);
            for (const e of produced) producedForThisEvent.push(e);
          } catch (err) {
            failed = { ruleId: rule.id, eventType: event.type, cause: err };
            break outer;
          }
        }
      }

      // Enqueue newly produced events, then apply the triggering event to the
      // working projection AFTER all rules for it have run (snapshot-
      // consistency: all rules saw the pre-update snapshot).
      for (const e of producedForThisEvent) {
        queue.push(e);
      }
      working.apply(event);
      staged.push(event);
    }

    if (failed) {
      throw new RuleProcessingError(
        failed.ruleId,
        failed.eventType,
        staged,
        failed.cause,
      );
    }

    // Atomic commit. The whole staged batch becomes durable as one unit:
    //   1. append to the canonical Event Log (append-only)
    //   2. apply to the canonical Projection (direct — see note on
    //      ProjectionStore above; keeps live projection == from-scratch replay)
    //   3. publish to EventBus subscribers (narrative / future read models)
    // Nothing above was durable until this loop.
    for (const event of staged) {
      this.bus.append(event);
      this.projection.apply(event);
      this.bus.publish(event);
    }

    return { committed: staged };
  }
}