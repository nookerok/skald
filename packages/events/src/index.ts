import type { DomainEvent, EventBus, Unsubscribe } from "@skald/event-bus";

/** Names of non-canonical reactive Belief notifications. */
export const BELIEF_EVENT_TYPES = Object.freeze({
  beliefChanged: "BeliefChanged",
  observationAdded: "ObservationAdded",
  hypothesisConfirmed: "HypothesisConfirmed",
  hypothesisRefuted: "HypothesisRefuted",
  patternDiscovered: "PatternDiscovered",
  relationDiscovered: "RelationDiscovered",
  predictionUpdated: "PredictionUpdated",
} as const);

/** Union of Belief notification event names. */
export type BeliefEventType = typeof BELIEF_EVENT_TYPES[keyof typeof BELIEF_EVENT_TYPES];

/** Payload common to every reactive notification. */
export interface BeliefEventPayload { readonly observerId: string; readonly subjectId: string; }

/** A reactive Belief notification that is not appended to the canonical log. */
export type BeliefEvent = DomainEvent<BeliefEventType, BeliefEventPayload>;
/** Handler for one reactive Belief notification. */
export type BeliefEventHandler = (event: BeliefEvent) => void;

/** Publishes a derived notification through EventBus fan-out only. */
export function publishBeliefEvent(bus: EventBus, event: BeliefEvent): void {
  bus.publish(event);
}

/** Subscribes to one derived notification type. */
export function subscribeBeliefEvent(bus: EventBus, type: BeliefEventType, handler: BeliefEventHandler): Unsubscribe {
  return bus.subscribe(type, handler as (event: DomainEvent) => void);
}

/** Subscribes one handler to all seven Belief notification types. */
export function subscribeToBeliefEvents(bus: EventBus, handler: BeliefEventHandler): Unsubscribe {
  const unsubscribers = Object.values(BELIEF_EVENT_TYPES).map((type) => subscribeBeliefEvent(bus, type, handler));
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
