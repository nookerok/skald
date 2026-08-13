import { EventBus } from "@skald/event-bus";
import { RuleRegistry, RuleEngine, type CommitContext } from "@skald/rule-engine";
import {
  WorldProjector,
  bootstrapWorldEvents,
  ModelRouter,
  createRules,
  buildObserverMap,
  buildSpatialWorldProjection,
} from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import type { MultiWorldStore } from "../persistence/sqlite-store.js";
import type { WorldId } from "../persistence/types.js";
import { WorldCommandQueue } from "./world-command-queue.js";
import { NarrationScheduler } from "./narration-scheduler.js";
import { rollPendingCheck } from "../dice-roller.js";

export interface WorldRuntime {
  worldId: WorldId;
  bus: EventBus;
  registry: RuleRegistry<ReturnType<WorldProjector["getSnapshot"]>>;
  engine: RuleEngine<ReturnType<WorldProjector["getSnapshot"]>>;
  projection: WorldProjector;
  processedKeys: Set<string>;
  router: ModelRouter | null;
  store: MultiWorldStore;
  queue: WorldCommandQueue;
  narration: NarrationScheduler;
}

function createRouter(): ModelRouter | null {
  const zenKey = process.env["SKALD_OPENCODE_ZEN_API_KEY"] ?? "";
  const ollamaKey = process.env["SKALD_OLLAMA_CLOUD_API_KEY"] ?? "";
  if (!zenKey && !ollamaKey) return null;
  return new ModelRouter({ apiKey: zenKey || ollamaKey, providerId: zenKey ? "opencode_zen" : "ollama_cloud", availableProviders: [zenKey ? "opencode_zen" : null, ollamaKey ? "ollama_cloud" : null].filter((provider): provider is "opencode_zen" | "ollama_cloud" => provider !== null), healthCachePath: "packages/cli/llm-health.json" });
}

export class WorldRuntimeManager {
  private runtimes = new Map<WorldId, WorldRuntime>();
  private initializing = new Map<WorldId, Promise<WorldRuntime>>();

  constructor(
    private readonly store: MultiWorldStore,
    private readonly configuredRouter?: ModelRouter | null,
  ) {}

  async get(worldId: WorldId): Promise<WorldRuntime> {
    const record = this.store.getWorldRecord(worldId);
    if (!record) throw Object.assign(new Error(`World not found: ${worldId}`), { statusCode: 404 });
    if (record.status !== "active") {
      throw Object.assign(new Error(`World is ${record.status}: ${worldId}`), { statusCode: 409 });
    }
    const successorWorldId = this.store.getWorldSuccessor(worldId);
    if (successorWorldId) {
      throw Object.assign(new Error(`World superseded by ${successorWorldId}: ${worldId}`), { statusCode: 409, successorWorldId });
    }
    const cached = this.runtimes.get(worldId);
    if (cached) return cached;
    const pending = this.initializing.get(worldId);
    if (pending) return pending;
    const load = this.load(worldId);
    this.initializing.set(worldId, load);
    try {
      return await load;
    } finally {
      if (this.initializing.get(worldId) === load) this.initializing.delete(worldId);
    }
  }

  private async load(worldId: WorldId): Promise<WorldRuntime> {

    const record = this.store.getWorldRecord(worldId);
    if (!record) throw Object.assign(new Error(`World not found: ${worldId}`), { statusCode: 404 });
    if (record.status !== "active") {
      throw Object.assign(new Error(`World is ${record.status}: ${worldId}`), { statusCode: 409 });
    }

    const bus = new EventBus();
    const projection = new WorldProjector();
    const storedEvents = this.store.loadEvents(worldId);
    const processedKeys = this.store.loadProcessedKeys(worldId);

    // Load or bootstrap
    if (storedEvents.length > 0) {
      for (const e of storedEvents) {
        bus.append(e);
        projection.apply(e);
      }
    } else {
      // Fresh world — bootstrap initial events and persist them
      const bootstrap = bootstrapWorldEvents();
      for (const e of bootstrap) {
        bus.append(e);
        projection.apply(e);
      }
      this.store.commitBatch(worldId, bootstrap);
    }

    const allEvents = bus.query();
    const spatial = buildSpatialWorldProjection(allEvents);
    const registry = spatial.region
      ? createRules(spatial, () => buildObserverMap(bus.query(), spatial, true))
      : createRules();
    const committer: (events: readonly DomainEvent[], ctx: CommitContext) => void = (events, ctx) => {
      const opts = ctx as { idempotencyKey?: string; requestKind?: string; correlationId?: string };
      this.store.commitBatch(worldId, events, {
        idempotencyKey: opts?.idempotencyKey ?? undefined,
        requestKind: (opts?.requestKind as "command" | "wait" | undefined) ?? undefined,
        correlationId: opts?.correlationId ?? undefined,
      });
    };
    const onSubErr = (err: unknown, eventType: string) => {
      console.error(`[subscriber-error] world="${worldId}" eventType="${eventType}": ${err instanceof Error ? err.message : String(err)}`);
    };
    const engine = new RuleEngine(registry, projection, bus, committer, onSubErr);
    // Tests and acceptance harnesses may inject a deterministic, non-network
    // narration adapter. Production keeps the environment-backed router.
    const router = this.configuredRouter === undefined ? createRouter() : this.configuredRouter;
    const queue = new WorldCommandQueue();

    const runtime: WorldRuntime = {
      worldId, bus, registry, engine, projection, processedKeys, router,
      store: this.store, queue, narration: new NarrationScheduler(),
    };

    // Crash recovery: roll any pending critical checks
    // Must happen before caching to avoid partial state on recovery failure
    await recoverPendingChecks(runtime);

    this.runtimes.set(worldId, runtime);
    return runtime;
  }

  evict(worldId: WorldId): void {
    this.runtimes.delete(worldId);
  }

  has(worldId: WorldId): boolean {
    return this.runtimes.has(worldId);
  }

  isAnyPoisoned(): boolean {
    for (const runtime of this.runtimes.values()) {
      if ((runtime.engine as { isPoisoned?: () => boolean }).isPoisoned?.() === true) return true;
    }
    return false;
  }
}

/**
 * Crash recovery for critical checks.
 * Finds CriticalCheckRequested events without corresponding CriticalCheckRolled
 * and rolls them exactly once.
 */
export async function recoverPendingChecks(runtime: WorldRuntime): Promise<void> {
  const pendingChecks = runtime.projection.getSnapshot().pendingChecks;
  if (pendingChecks.size === 0) return;

  console.log(`[recovery] Found ${pendingChecks.size} pending critical checks`);

  for (const [checkId, pendingCheck] of pendingChecks) {
    // Find the original CriticalCheckRequested event
    const requestEvent = runtime.bus.query().find(
      (e) => e.type === "CriticalCheckRequested" && (e.payload as { checkId: string }).checkId === checkId,
    );

    if (!requestEvent) {
      console.error(`[recovery] CriticalCheckRequested not found for checkId=${checkId}`);
      continue;
    }

    // Roll the dice using the original event's correlationId and timestamp
    // to maintain consistent command history
    const rollEvent = rollPendingCheck(
      pendingCheck,
      requestEvent.eventId,
      requestEvent.correlationId,
      requestEvent.timestamp,
    );

    // Process through engine (this will trigger resolution)
    runtime.engine.processSequence([rollEvent]);
    console.log(`[recovery] Rolled check ${checkId}`);
  }
}
