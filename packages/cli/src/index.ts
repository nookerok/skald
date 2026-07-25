import { EventBus } from "@skald/event-bus";
import { RuleRegistry, RuleEngine } from "@skald/rule-engine";
import { parseCommand, type ParseResult } from "@skald/intent-parser";
import {
  WorldProjector,
  physicsMovement,
  observationRules,
  repercussion,
  expire,
  fire,
  start,
  forestFireSpread,
  end,
  handleCommand,
  commitBootstrap,
  commandEventId,
} from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

export interface App {
  bus: EventBus;
  registry: RuleRegistry<ReturnType<WorldProjector["getSnapshot"]>>;
  engine: RuleEngine<ReturnType<WorldProjector["getSnapshot"]>>;
  projection: WorldProjector;
}

export function createApp(): App {
  const bus = new EventBus();
  const projection = new WorldProjector();
  const registry = new RuleRegistry<ReturnType<WorldProjector["getSnapshot"]>>();
  registry.register(physicsMovement);
  for (const rule of observationRules) {
    registry.register(rule);
  }
  registry.register(repercussion);
  registry.register(expire);
  registry.register(fire);
  registry.register(start);
  registry.register(forestFireSpread);
  registry.register(end);
  const engine = new RuleEngine(registry, projection, bus);

  commitBootstrap(bus, (e) => projection.apply(e));

  return { bus, registry, engine, projection };
}

export interface CommandOutcome {
  events: DomainEvent[];
  position: { x: number; y: number };
}

export function runCommand(
  app: App,
  input: string,
  correlationId: string,
  timestamp: number,
): CommandOutcome | ParseResult {
  const parsed = parseCommand(input);
  if (parsed.type === "ParseError") return parsed;

  const firstEvent = handleCommand(parsed, correlationId, timestamp);
  const { committed } = app.engine.process(firstEvent);
  return {
    events: committed,
    position: { ...app.projection.getSnapshot().player },
  };
}

export interface TickOutcome {
  events: DomainEvent[];
}

export function runTick(app: App, timestamp: number, correlationId: string): TickOutcome {
  const tickEvent: DomainEvent = {
    eventId: commandEventId(correlationId, "TickPassed"),
    type: "TickPassed",
    schemaVersion: 1,
    payload: { delta: 1 },
    timestamp,
    correlationId,
    causationId: null,
  };
  const { committed } = app.engine.process(tickEvent);
  return { events: committed };
}
