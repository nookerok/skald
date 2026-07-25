import { EventBus } from "@skald/event-bus";
import { RuleRegistry, RuleEngine } from "@skald/rule-engine";
import { parseCommand, type ParseResult } from "@skald/intent-parser";
import {
  WorldProjector,
  physicsMovement,
  observationRules,
  handleCommand,
  commitBootstrap,
} from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

export interface App {
  bus: EventBus;
  registry: RuleRegistry<ReturnType<WorldProjector["getSnapshot"]>>;
  engine: RuleEngine<ReturnType<WorldProjector["getSnapshot"]>>;
  projection: WorldProjector;
}

/**
 * Composition root: wire EventBus, RuleRegistry (registers physics.wall_block),
 * RuleEngine, WorldProjector, and commit the bootstrap batch (player + walls)
 * into the canonical log + projection.
 */
export function createApp(): App {
  const bus = new EventBus();
  const projection = new WorldProjector();
  const registry = new RuleRegistry<ReturnType<WorldProjector["getSnapshot"]>>();
  registry.register(physicsMovement);
  for (const rule of observationRules) {
    registry.register(rule);
  }
  const engine = new RuleEngine(registry, projection, bus);

  commitBootstrap(bus, (e) => projection.apply(e));

  return { bus, registry, engine, projection };
}

export interface CommandOutcome {
  events: DomainEvent[];
  position: { x: number; y: number };
}

/**
 * Run one top-level player command end-to-end:
 *   parse → Command Handler → RuleEngine → committed events.
 *
 * `timestamp` is the current world.time (integer tick counter for MVP-0,
 * advanced once per processed command by the caller — the REPL — never
 * Date.now()). `correlationId` is generated per call.
 */
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