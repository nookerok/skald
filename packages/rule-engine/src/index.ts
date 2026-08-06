import { type DomainEvent, EventBus } from "@skald/event-bus";

export type Phase = "validation" | "physics" | "consequence" | "notification";

export const PHASE_ORDER: readonly Phase[] = [
  "validation",
  "physics",
  "consequence",
  "notification",
];

export type RuleHandler<W> = (event: DomainEvent, world: W) => DomainEvent[];

export interface Rule<W> {
  id: string;
  phase: Phase;
  listens: string[];
  produces: string[];
  handle: RuleHandler<W>;
}

export interface ProjectionStore<W> {
  getSnapshot(): W;
  apply(event: DomainEvent): void;
  clone(): ProjectionStore<W>;
}

export class RuleRegistry<W> {
  private readonly byPhase: Map<Phase, Rule<W>[]> = new Map();

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

  listenersFor(eventType: string, phase: Phase): readonly Rule<W>[] {
    const list = this.byPhase.get(phase);
    if (!list) return [];
    return list.filter((r) => r.listens.includes(eventType));
  }

  hasRulesFor(eventType: string, phase: Phase): boolean {
    return this.listenersFor(eventType, phase).length > 0;
  }

  /** Every registered rule, in phase order. Read-only enumeration for
   *  coverage tooling; never call the rules through this list. */
  listRules(): readonly Rule<W>[] {
    return PHASE_ORDER.flatMap((phase) => this.byPhase.get(phase) ?? []);
  }
}

export const MAX_ITERATIONS = 10_000;

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
  committed: DomainEvent[];
}

export type CommitContext = unknown;
export type DurableCommitter = (
  events: readonly DomainEvent[],
  context: CommitContext,
) => void;

export interface ProcessOptions {
  readonly commitContext?: CommitContext;
  /** Derive continuation roots from staged events before one durable commit. */
  readonly deriveEvents?: (staged: readonly DomainEvent[]) => readonly DomainEvent[];
}

function cloneAndFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T;
  }
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    clone[key] = cloneAndFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(clone) as T;
}

function immutableEventBatch(events: readonly DomainEvent[]): readonly DomainEvent[] {
  return Object.freeze(events.map((event) => Object.freeze({
    ...event,
    payload: cloneAndFreeze(event.payload),
  })));
}

export class PostCommitConsistencyError extends Error {
  readonly stagedCount: number;
  constructor(stagedCount: number, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Post-commit consistency failure after ${stagedCount} events: ${msg}. Server must restart.`);
    this.name = "PostCommitConsistencyError";
    this.stagedCount = stagedCount;
  }
}

export class RuleEngine<W> {
  private poisoned = false;

  isPoisoned(): boolean { return this.poisoned; }

  constructor(
    private readonly registry: RuleRegistry<W>,
    private readonly projection: ProjectionStore<W>,
    private readonly bus: EventBus,
    private readonly durableCommitter?: DurableCommitter,
    onSubscriberError?: (err: unknown, eventType: string) => void,
  ) {
    if (onSubscriberError) {
      bus.setSubscriberErrorHandler(onSubscriberError);
    }
  }

  process(firstEvent: DomainEvent, options?: ProcessOptions): ProcessResult {
    return this.processSequence([firstEvent], options);
  }

  processSequence(
    firstEvents: readonly DomainEvent[],
    options?: ProcessOptions,
  ): ProcessResult {
    if (this.poisoned) {
      throw new PostCommitConsistencyError(0, new Error("engine is poisoned after previous post-commit failure"));
    }

    if (firstEvents.length === 0) {
      return { committed: [] };
    }

    const working = this.projection.clone();
    const staged: DomainEvent[] = [];
    const queue: DomainEvent[] = [];
    let iterations = 0;

    let failed: { ruleId: string; eventType: string; cause: unknown } | null = null;

    const drainQueue = (): void => {
      outer: while (queue.length > 0) {
        iterations++;
        if (iterations > MAX_ITERATIONS) {
          throw new MaxIterationsExceededError(iterations, queue.slice());
        }

        const event = queue.shift() as DomainEvent;
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

        for (const e of producedForThisEvent) {
          queue.push(e);
        }
        working.apply(event);
        staged.push(event);
      }
    };

    for (const root of firstEvents) {
      queue.push(root);
      drainQueue();
      if (failed) break;
    }

    if (!failed && options?.deriveEvents) {
      const continuation = options.deriveEvents(immutableEventBatch(staged));
      for (const event of continuation) queue.push(event);
      drainQueue();
    }

    const failure = failed as { ruleId: string; eventType: string; cause: unknown } | null;
    if (failure) {
      throw new RuleProcessingError(
        failure.ruleId,
        failure.eventType,
        staged,
        failure.cause,
      );
    }

    // 1. Durable commit — always for non-empty batch
    if (this.durableCommitter && staged.length > 0) {
      this.durableCommitter(staged, options?.commitContext);
    }

    // 2. Memory commit
    try {
      for (const event of staged) {
        this.bus.append(event);
        this.projection.apply(event);
        this.bus.publish(event);
      }
    } catch (err) {
      this.poisoned = true;
      throw new PostCommitConsistencyError(staged.length, err);
    }

    return { committed: staged };
  }
}
