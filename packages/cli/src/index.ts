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
  giveRule,
  heatSpread,
  durationCheck,
  playerStrategy,
  handleCommand,
  commitBootstrap,
  commandEventId,
  buildBiographyGraph,
  buildNarrative,
  narrateLLM,
  ModelRouter,
} from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

export interface IdempotencyReject {
  type: "IdempotencyReject";
  reason: string;
  idempotencyKey: string;
}

export interface App {
  bus: EventBus;
  registry: RuleRegistry<ReturnType<WorldProjector["getSnapshot"]>>;
  engine: RuleEngine<ReturnType<WorldProjector["getSnapshot"]>>;
  projection: WorldProjector;
  processedKeys: Set<string>;
  router: ModelRouter | null;
}

export function createApp(): App {
  const bus = new EventBus();
  const projection = new WorldProjector();
  const registry = new RuleRegistry<ReturnType<WorldProjector["getSnapshot"]>>();
  registry.register(durationCheck);
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
  registry.register(giveRule);
  registry.register(heatSpread);
  registry.register(playerStrategy);
  const engine = new RuleEngine(registry, projection, bus);

  commitBootstrap(bus, (e) => projection.apply(e));

  const routerApiKey = process.env["SKALD_OPENCODE_ZEN_API_KEY"] ?? "";
  const router = routerApiKey ? new ModelRouter({ apiKey: routerApiKey, healthCachePath: "packages/cli/llm-health.json" }) : null;

  return { bus, registry, engine, projection, processedKeys: new Set(), router };
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
  idempotencyKey: string,
): CommandOutcome | ParseResult | IdempotencyReject {
  if (app.processedKeys.has(idempotencyKey)) {
    return { type: "IdempotencyReject", reason: "duplicate command", idempotencyKey };
  }

  const parsed = parseCommand(input);
  if (parsed.type === "ParseError") return parsed;

  app.processedKeys.add(idempotencyKey);

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

function formatNode(node: { event: { type: string; eventId: string; payload: unknown }; children: unknown[] }, indent: number): string {
  let s = "  ".repeat(indent) + `[${node.event.type}] ${node.event.eventId}`;
  const payloadStr = JSON.stringify(node.event.payload);
  if (payloadStr !== "{}") s += ` ${payloadStr}`;
  s += "\n";
  for (const child of node.children as Array<Parameters<typeof formatNode>[0]>) {
    s += formatNode(child, indent + 1);
  }
  return s;
}

export function printBiography(app: App, correlationId?: string): string {
  const events = app.bus.query();
  const opts = correlationId !== undefined ? { correlationId } : undefined;
  const graph = buildBiographyGraph(events, opts);
  let s = `Biography (correlationId: ${graph.correlationId ?? "all"}):\n`;
  for (const root of graph.roots) {
    s += formatNode(root as Parameters<typeof formatNode>[0], 1);
  }
  s += `Total events: ${events.length}, roots: ${graph.roots.length}\n`;
  return s;
}

export function runTick(
  app: App,
  timestamp: number,
  correlationId: string,
  playerOffline = false,
): TickOutcome {
  const tickEvent: DomainEvent = {
    eventId: commandEventId(correlationId, "TickPassed"),
    type: "TickPassed",
    schemaVersion: 1,
    payload: { delta: 1, playerOffline },
    timestamp,
    correlationId,
    causationId: null,
  };
  const { committed } = app.engine.process(tickEvent);
  return { events: committed };
}

export async function printNarrativeLLM(app: App, sinceTick?: number): Promise<string> {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const opts = sinceTick !== undefined ? { sinceTick } : undefined;
  const snapshot = buildNarrative(events, world, opts);
  const result = await narrateLLM(snapshot, app.router);
  let header = `--- Narrative LLM (world.time=${snapshot.worldTime}) ---\n`;
  if (result.usedFallback) {
    header += `[fallback: ${result.fallbackReason}]\n`;
  }
  return header + result.text + "\n";
}

export function printNarrative(app: App, sinceTick?: number): string {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const opts = sinceTick !== undefined ? { sinceTick } : undefined;
  const snapshot = buildNarrative(events, world, opts);
  let s = `--- Narrative (world.time=${snapshot.worldTime}, player at ${JSON.stringify(snapshot.playerPosition)}) ---\n`;
  for (const entry of snapshot.entries) {
    s += `  [${entry.kind}] (T=${entry.timestamp}) ${entry.text}\n`;
  }
  return s;
}
