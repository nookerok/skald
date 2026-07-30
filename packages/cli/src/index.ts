import { EventBus } from "@skald/event-bus";
import { RuleRegistry, RuleEngine, type ProcessOptions, type CommitContext } from "@skald/rule-engine";
import { parseIntent, type IntentResult } from "@skald/intent-parser";
import {
  WorldProjector,
  handleCommand,
  commitBootstrap,
  commandEventId,
  buildBiographyGraph,
  buildNarrative,
  narrateLLM,
  ModelRouter,
  bootstrapWorldEvents,
  createRules,
} from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createMultiWorldStore, LEGACY_WORLD_ID, type WorldId } from "./persistence.js";
import { rollCriticalCheck, rollPendingCheck } from "./dice-roller.js";

export type { IntentResult } from "@skald/intent-parser";
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
  store: ReturnType<typeof createMultiWorldStore> | null;
  worldId: WorldId;
}

function createRouter(): ModelRouter | null {
  const zenKey = process.env["SKALD_OPENCODE_ZEN_API_KEY"] ?? "";
  const ollamaKey = process.env["SKALD_OLLAMA_CLOUD_API_KEY"] ?? "";
  if (!zenKey && !ollamaKey) return null;
  return new ModelRouter({ apiKey: zenKey, healthCachePath: "packages/cli/llm-health.json" });
}

export function createApp(): App {
  const bus = new EventBus();
  const projection = new WorldProjector();
  const registry = createRules();
  const onSubErr = (err: unknown, eventType: string) => {
    console.error(`[subscriber-error] eventType="${eventType}": ${err instanceof Error ? err.message : String(err)}`);
  };
  const engine = new RuleEngine(registry, projection, bus, undefined, onSubErr);
  commitBootstrap(bus, (e) => projection.apply(e));
  const router = createRouter();
  return { bus, registry, engine, projection, processedKeys: new Set(), router, store: null, worldId: LEGACY_WORLD_ID };
}

export function createPersistentApp(opts?: { dbPath?: string | undefined }): App {
  const dbPath = opts?.dbPath ?? process.env["SKALD_DB_PATH"] ?? "/home/nook/skald-data/events.sqlite";
  const store = createMultiWorldStore(dbPath);
  const worldId = LEGACY_WORLD_ID;
  const storedEvents = store.loadEvents(worldId);
  const bus = new EventBus();
  const projection = new WorldProjector();
  const processedKeys = store.loadProcessedKeys(worldId);

  if (storedEvents.length === 0) {
    const bootstrap = bootstrapWorldEvents();
    store.commitBatch(worldId, bootstrap);
    for (const e of bootstrap) {
      bus.append(e);
      projection.apply(e);
    }
  } else {
    for (const e of storedEvents) {
      bus.append(e);
      projection.apply(e);
    }
  }

  const registry = createRules();
  const committer: (events: readonly DomainEvent[], ctx: CommitContext) => void = (events, ctx) => {
    const opts = ctx as { idempotencyKey?: string; requestKind?: string; correlationId?: string };
    store.commitBatch(worldId, events, {
      idempotencyKey: opts?.idempotencyKey ?? undefined,
      requestKind: (opts?.requestKind as "command" | "wait" | undefined) ?? undefined,
      correlationId: opts?.correlationId ?? undefined,
    });
  };
  const onSubErr = (err: unknown, eventType: string) => {
    console.error(`[subscriber-error] eventType="${eventType}": ${err instanceof Error ? err.message : String(err)}`);
  };
  const engine = new RuleEngine(registry, projection, bus, committer, onSubErr);
  const router = createRouter();

  // Crash recovery: roll any pending critical checks
  const pendingChecks = projection.getSnapshot().pendingChecks;
  if (pendingChecks.size > 0) {
    console.log(`[recovery] Found ${pendingChecks.size} pending critical checks`);
    for (const [checkId, pendingCheck] of pendingChecks) {
      const requestEvent = bus.query().find(
        (e) => e.type === "CriticalCheckRequested" && (e.payload as { checkId: string }).checkId === checkId,
      );
      if (requestEvent) {
        const rollEvent = rollPendingCheck(
          pendingCheck,
          requestEvent.eventId,
          requestEvent.correlationId,
          requestEvent.timestamp,
        );
        engine.processSequence([rollEvent]);
        console.log(`[recovery] Rolled check ${checkId}`);
      }
    }
  }

  return { bus, registry, engine, projection, processedKeys, router, store, worldId };
}

export interface CommandOutcome {
  events: DomainEvent[];
  position: { x: number; y: number };
}

/**
 * Run a single command (without tick).
 */
export function runCommand(
  app: App,
  input: string,
  correlationId: string,
  timestamp: number,
  idempotencyKey: string,
): CommandOutcome | IntentResult | IdempotencyReject {
  if (app.processedKeys.has(idempotencyKey)) {
    return { type: "IdempotencyReject", reason: "duplicate command", idempotencyKey };
  }

  const parsed = parseIntent(input);
  if (parsed.type !== "ActionIntentCommand") return parsed;

  const firstEvent = handleCommand(parsed, correlationId, timestamp);
  const options: ProcessOptions = app.store
    ? { commitContext: { idempotencyKey, requestKind: "command", correlationId } as CommitContext }
    : {};

  try {
    const { committed } = app.engine.process(firstEvent, options);
    app.processedKeys.add(idempotencyKey);
    return {
      events: committed,
      position: { ...app.projection.getSnapshot().player },
    };
  } catch (err) {
    throw err;
  }
}

export interface TickOutcome {
  events: DomainEvent[];
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

/**
 * Process dice rolls for CriticalCheckRequested events.
 * Rolls dice and processes them through the engine to get resolution events.
 * This is the ONLY place where dice are rolled.
 */
function processDiceRolls(
  app: App,
  committed: DomainEvent[],
  _correlationId: string,
): DomainEvent[] {
  const allEvents = [...committed];
  const rollEvents: DomainEvent[] = [];

  for (const event of committed) {
    if (event.type === "CriticalCheckRequested") {
      const rollEvent = rollCriticalCheck(event);
      rollEvents.push(rollEvent);
    }
  }

  if (rollEvents.length > 0) {
    // Process roll events through the engine to get resolution events
    const { committed: rollCommitted } = app.engine.processSequence(rollEvents);
    allEvents.push(...rollCommitted);
  }

  return allEvents;
}

/**
 * Run a full command cycle: parse intent, process through rules, roll dice, tick.
 */
export function runCommandCycle(
  app: App,
  input: string,
  idempotencyKey: string,
): { events: DomainEvent[]; tickEvents: DomainEvent[]; position: { x: number; y: number } } | IntentResult | IdempotencyReject {
  if (app.processedKeys.has(idempotencyKey)) {
    return { type: "IdempotencyReject", reason: "duplicate command", idempotencyKey };
  }

  const parsed = parseIntent(input);
  if (parsed.type !== "ActionIntentCommand") return parsed;

  const ts = app.projection.getSnapshot().time + 1;
  const correlationId = `cmd-${ts}`;
  const firstEvent = handleCommand(parsed, correlationId, ts);
  const tickEvent: DomainEvent = {
    eventId: commandEventId(`tick-${ts}`, "TickPassed"),
    type: "TickPassed",
    schemaVersion: 1,
    payload: { delta: 1 },
    timestamp: ts,
    correlationId: `tick-${ts}`,
    causationId: null,
  };

  const options: ProcessOptions = app.store
    ? { commitContext: { idempotencyKey, requestKind: "command", correlationId } as CommitContext }
    : {};

  try {
    const { committed } = app.engine.processSequence([firstEvent, tickEvent], options);
    app.processedKeys.add(idempotencyKey);

    // Process dice rolls for any CriticalCheckRequested events
    const allCommandEvents = processDiceRolls(
      app,
      committed.filter((e) => e.correlationId === correlationId),
      correlationId,
    );

    return {
      events: allCommandEvents,
      tickEvents: committed.filter((e) => e.correlationId === `tick-${ts}`),
      position: { ...app.projection.getSnapshot().player },
    };
  } catch (err) {
    throw err;
  }
}

export function runOfflineTicks(
  app: App,
  count: number,
  idempotencyKey: string,
): { tickEvents: DomainEvent[] } | IdempotencyReject {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new Error("count must be an integer between 1 and 100");
  }
  if (app.processedKeys.has(idempotencyKey)) {
    return { type: "IdempotencyReject", reason: "duplicate command", idempotencyKey };
  }

  const startTs = app.projection.getSnapshot().time;
  const rootEvents: DomainEvent[] = [];
  for (let i = 0; i < count; i++) {
    const ts = startTs + 1 + i;
    rootEvents.push({
      eventId: commandEventId(`tick-offline-${ts}`, "TickPassed"),
      type: "TickPassed",
      schemaVersion: 1,
      payload: { delta: 1, playerOffline: true },
      timestamp: ts,
      correlationId: `tick-offline-${ts}`,
      causationId: null,
    });
  }

  const options: ProcessOptions = app.store
    ? { commitContext: { idempotencyKey, requestKind: "wait", correlationId: `wait-${startTs + 1}` } as CommitContext }
    : {};

  try {
    const { committed } = app.engine.processSequence(rootEvents, options);
    app.processedKeys.add(idempotencyKey);
    return { tickEvents: committed };
  } catch (err) {
    throw err;
  }
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
