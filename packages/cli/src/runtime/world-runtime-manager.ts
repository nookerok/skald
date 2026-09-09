import { EventBus } from "@skald/event-bus";
import { RuleRegistry, RuleEngine, type CommitContext } from "@skald/rule-engine";
import {
  WorldProjector,
  bootstrapWorldEvents,
  LLM_CONFIG,
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
import type { NarrationDiagnosticEvent, NarrationDiagnosticSink } from "@skald/world";
import { NarrationDiagnosticLog } from "./narration-diagnostic-log.js";
import { createProductionDiagnosticSink } from "./narration-diagnostic-prod-sink.js";
import { AIReadinessService } from "./ai-readiness.js";
import { DiscoveryRefresher, type DiscoveryRefreshEvent } from "./discovery-refresh.js";
import { createRouterConfiguration, type RouterConfiguration } from "./router-factory.js";
import type { AIReadinessReport } from "@skald/world";

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
  /** Operational diagnostic sink for LLM narration telemetry. */
  diagnostics: NarrationDiagnosticSink;
}

export class WorldRuntimeManager {
  private runtimes = new Map<WorldId, WorldRuntime>();
  private initializing = new Map<WorldId, Promise<WorldRuntime>>();
  private readonly diagnosticLog = new NarrationDiagnosticLog();
  private readonly diagnosticSink: NarrationDiagnosticSink;
  private readonly sharedRouter: ModelRouter | null;
  private readonly readiness: AIReadinessService;
  private discoveryRefresher: DiscoveryRefresher | null = null;

  constructor(
    private readonly store: MultiWorldStore,
    configuredRouter?: ModelRouter | null,
    diagnostics?: NarrationDiagnosticSink,
    routerConfiguration?: RouterConfiguration | null,
  ) {
    const externalSink = diagnostics ?? createProductionDiagnosticSink();
    this.diagnosticSink = (event) => {
      this.diagnosticLog.record(event);
      try {
        externalSink(event);
      } catch {
        // Best-effort: external sink errors must not affect narration.
      }
    };
    const resolvedConfiguration = routerConfiguration ?? (configuredRouter === undefined ? createRouterConfiguration() : null);
    this.sharedRouter = configuredRouter === undefined ? resolvedConfiguration!.router : configuredRouter;
    this.readiness = new AIReadinessService(this.sharedRouter, {
      ...(resolvedConfiguration ? { configFingerprint: resolvedConfiguration.configFingerprint } : {}),
      ...(resolvedConfiguration?.selectionReport ? { selectionReport: resolvedConfiguration.selectionReport } : {}),
      diagnostics: this.diagnosticSink,
    });
  }

  /** Read-only operational diagnostics for trusted diagnostics surfaces/tests. */
  narrationDiagnostics(): readonly NarrationDiagnosticEvent[] {
    return this.diagnosticLog.snapshot();
  }

  /** Execute the cached/serialized no-world AI readiness probe. */
  aiReadiness(): Promise<AIReadinessReport> {
    return this.readiness.probe();
  }

  /** Return the most recent probe without invoking a provider. */
  cachedAIReadiness(): AIReadinessReport | null {
    return this.readiness.cached();
  }

  /**
   * Start the daily live-model re-discovery cadence for the shared router.
   * Stale-while-revalidate: empty or failed selections never empty live
   * routes. Safe to call when no live router exists (it stays idle).
   */
  startDiscoveryRefresh(options?: {
    apiKey?: string;
    ollamaKey?: string;
    ollamaModel?: string;
    intervalMs?: number;
    timeoutMs?: number;
    onEvent?: (event: DiscoveryRefreshEvent) => void;
  }): void {
    this.stopDiscoveryRefresh();
    if (!this.sharedRouter) return;
    const envName = LLM_CONFIG.providers["opencode_zen"]?.apiKeyEnv ?? "";
    const ollamaEnvName = LLM_CONFIG.providers["ollama_cloud"]?.apiKeyEnv ?? "";
    this.discoveryRefresher = new DiscoveryRefresher({
      apiKey: options?.apiKey ?? (envName ? process.env[envName] ?? "" : ""),
      ollamaKey: options?.ollamaKey ?? (ollamaEnvName ? process.env[ollamaEnvName] ?? "" : ""),
      ...(options?.ollamaModel !== undefined ? { ollamaModel: options.ollamaModel } : {}),
      router: this.sharedRouter,
      ...(options?.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
    });
    this.discoveryRefresher.start();
  }

  /** Stop the re-discovery cadence. In-flight refreshes still settle. */
  stopDiscoveryRefresh(): void {
    this.discoveryRefresher?.stop();
    this.discoveryRefresher = null;
  }

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
      const opts = ctx as { idempotencyKey?: string; requestKind?: string; correlationId?: string; conversationTurn?: import("../conversation/types.js").ConversationTurnDraft };
      this.store.commitBatch(worldId, events, {
        idempotencyKey: opts?.idempotencyKey ?? undefined,
        requestKind: (opts?.requestKind as "command" | "wait" | undefined) ?? undefined,
        correlationId: opts?.correlationId ?? undefined,
        conversationTurn: opts?.conversationTurn,
      });
    };
    const onSubErr = (err: unknown, eventType: string) => {
      console.error(`[subscriber-error] world="${worldId}" eventType="${eventType}": ${err instanceof Error ? err.message : String(err)}`);
    };
    const engine = new RuleEngine(registry, projection, bus, committer, onSubErr);
    // Tests and acceptance harnesses may inject a deterministic, non-network
    // narration adapter. Production keeps the environment-backed router.
    const router = this.sharedRouter;
    const queue = new WorldCommandQueue();

    const runtime: WorldRuntime = {
      worldId, bus, registry, engine, projection, processedKeys, router,
      store: this.store, queue, narration: new NarrationScheduler(8, 2, this.diagnosticSink, worldId),
      diagnostics: this.diagnosticSink,
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
