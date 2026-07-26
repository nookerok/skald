/**
 * @skald/event-bus
 *
 * The canonical, append-only Event Log plus a publish/subscribe fan-out
 * mechanism. Contains NO game logic — only storage and dispatch.
 *
 * Design notes (AGENTS.md):
 * - `append` writes to the canonical log and never notifies anyone. Append
 *   only: there is no mutate/remove API.
 * - `publish` notifies subscribers but never touches the log. Keeping
 *   `append` and `publish` decoupled lets the RuleEngine stage events in a
 *   working log during a top-level Command transaction and only
 *   `append`+`publish` them as one atomic batch on commit.
 * - `query` reads the canonical log (used by replay/tests/projection purity).
 */

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  eventId: string;
  type: TType;
  schemaVersion: number;
  payload: TPayload;
  /** world.time — integer tick/turn counter for MVP-0, NEVER Date.now(). */
  timestamp: number;
  correlationId: string;
  /** eventId of the triggering event; null only for the root of a chain. */
  causationId: string | null;
}

export type EventPredicate = (event: DomainEvent) => boolean;
export type EventHandler = (event: DomainEvent) => void;
export type Unsubscribe = () => void;

function deepFreezePayload<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezePayload(item);
    return Object.freeze(value) as T;
  }
  for (const v of Object.values(value as Record<string, unknown>)) deepFreezePayload(v);
  return Object.freeze(value) as T;
}

export class EventBus {
  private readonly log: DomainEvent[] = [];
  private readonly subscribers: Map<string, Set<EventHandler>> = new Map();

  /** Append to the canonical log. Append-only: no mutation/removal exists.
   *  The event payload is recursively deep-frozen to prevent external mutation. */
  append(event: DomainEvent): void {
    const frozen = Object.freeze({
      ...event,
      payload: deepFreezePayload(event.payload),
    }) as DomainEvent;
    this.log.push(frozen);
  }

  /** Notify subscribers registered for `event.type`. Does not touch the log.
   *  Subscriber exceptions are caught and collected — a failing subscriber
   *  never blocks other subscribers or the canonical commit (AGENTS §9.3).
   *  Errors are passed to the optional error handler if provided. */
  private subscriberErrorHandler: ((err: unknown, eventType: string) => void) | null = null;

  setSubscriberErrorHandler(handler: ((err: unknown, eventType: string) => void) | null): void {
    this.subscriberErrorHandler = handler;
  }

  publish(event: DomainEvent): void {
    const handlers = this.subscribers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          this.subscriberErrorHandler?.(err, event.type);
        }
      }
    }
  }

  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  subscribe(eventType: string, handler: EventHandler): Unsubscribe {
    let set = this.subscribers.get(eventType);
    if (!set) {
      set = new Set();
      this.subscribers.set(eventType, set);
    }
    set.add(handler);
    return () => {
      const s = this.subscribers.get(eventType);
      if (s) {
        s.delete(handler);
        if (s.size === 0) {
          this.subscribers.delete(eventType);
        }
      }
    };
  }

  /** Read from the canonical log, optionally filtered. Returns a copy. */
  query(predicate?: EventPredicate): DomainEvent[] {
    const result = predicate ? this.log.filter(predicate) : this.log.slice();
    return result;
  }

  /** Convenience: total number of events in the canonical log. */
  size(): number {
    return this.log.length;
  }
}