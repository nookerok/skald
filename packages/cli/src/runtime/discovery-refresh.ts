import {
  OPENCODE_PREFERRED_MODELS,
  discoverOpenCodeRoutes,
  type LiveModelSelectionReport,
  type ModelRouter,
} from "@skald/world";
import { refreshRouterSelection } from "./router-factory.js";

/** One day in milliseconds: the default re-discovery cadence. */
export const DISCOVERY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Lower bound for the refresh cadence: never hammer providers in a hot loop. */
export const MIN_DISCOVERY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Environment override for the refresh cadence (milliseconds). */
export const DISCOVERY_REFRESH_ENV = "SKALD_AI_DISCOVERY_REFRESH_MS";

export type DiscoveryRefreshOutcome = "applied" | "skipped_empty" | "skipped_failed" | "skipped_no_router";

export interface DiscoveryRefreshSummary {
  readonly outcome: DiscoveryRefreshOutcome;
  readonly checkedAt: string;
  readonly status?: string;
  readonly activeModel?: string;
  readonly backupModel?: string;
  readonly configFingerprint?: string;
}

export interface DiscoveryRefreshEvent {
  readonly kind: "discovery_refresh";
  readonly outcome: DiscoveryRefreshOutcome;
  readonly checkedAt: string;
  readonly status?: string;
  readonly activeModel?: string;
  readonly backupModel?: string;
  readonly configFingerprint?: string;
  readonly durationMs: number;
}

export interface DiscoveryRefresherOptions {
  /** Zen credential captured once at wiring time; values never leave this module. */
  readonly apiKey: string;
  readonly router: ModelRouter | null;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly preferredModels?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly checkedAt?: () => string;
  readonly onEvent?: (event: DiscoveryRefreshEvent) => void;
  readonly discover?: typeof discoverOpenCodeRoutes;
}

/**
 * Resolve the refresh cadence from the environment. Unknown, non-positive or
 * sub-minimum values fall back to the daily default, so a typo can never turn
 * the refresher into a hot loop against paid provider endpoints.
 */
export function resolveRefreshIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[DISCOVERY_REFRESH_ENV];
  if (raw === undefined || raw.trim() === "") return DISCOVERY_REFRESH_INTERVAL_MS;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < MIN_DISCOVERY_REFRESH_INTERVAL_MS) return DISCOVERY_REFRESH_INTERVAL_MS;
  return parsed;
}

function activeCount(selection: LiveModelSelectionReport): number {
  return selection.candidates.filter((candidate) => candidate.active).length;
}

/**
 * Re-runs live Zen catalogue discovery on a daily cadence and applies the
 * fresh selection to a running router without rebuilding it.
 *
 * Availability policy is stale-while-revalidate: a selection that activates
 * nothing (or a failed discovery run) never empties live routes; the last
 * good selection keeps serving while the miss is reported. Everything leaving
 * this module is secret-free routing metadata by construction.
 */
export class DiscoveryRefresher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<DiscoveryRefreshSummary> | null = null;
  private lastSummary: DiscoveryRefreshSummary | null = null;
  private readonly intervalMs: number;

  constructor(private readonly options: DiscoveryRefresherOptions) {
    const interval = Math.floor(options.intervalMs ?? DISCOVERY_REFRESH_INTERVAL_MS);
    this.intervalMs = Number.isFinite(interval) && interval >= MIN_DISCOVERY_REFRESH_INTERVAL_MS
      ? interval
      : DISCOVERY_REFRESH_INTERVAL_MS;
  }

  /** Start the daily cadence. The timer is unref'd so it never blocks exit. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refreshNow();
    }, this.intervalMs);
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as unknown as { unref: () => void }).unref();
    }
  }

  /** Stop the cadence. In-flight refreshes still settle. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Most recent refresh outcome, if any refresh has settled. */
  lastResult(): DiscoveryRefreshSummary | null {
    return this.lastSummary;
  }

  /**
   * Run one discovery pass now. Concurrent callers share the in-flight pass.
   * Never throws: failures resolve to a skipped summary.
   */
  async refreshNow(): Promise<DiscoveryRefreshSummary> {
    if (this.inFlight) return this.inFlight;
    const request = this.runOnce().finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    });
    this.inFlight = request;
    return request;
  }

  private async runOnce(): Promise<DiscoveryRefreshSummary> {
    const startedAt = performance.now();
    const checkedAt = this.options.checkedAt ?? (() => new Date().toISOString());
    const finish = (summary: Omit<DiscoveryRefreshSummary, "checkedAt">): DiscoveryRefreshSummary => {
      const full: DiscoveryRefreshSummary = { ...summary, checkedAt: checkedAt() };
      this.lastSummary = full;
      try {
        this.options.onEvent?.({
          kind: "discovery_refresh",
          outcome: full.outcome,
          checkedAt: full.checkedAt,
          ...(full.status ? { status: full.status } : {}),
          ...(full.activeModel ? { activeModel: full.activeModel } : {}),
          ...(full.backupModel ? { backupModel: full.backupModel } : {}),
          ...(full.configFingerprint ? { configFingerprint: full.configFingerprint } : {}),
          durationMs: Math.round(performance.now() - startedAt),
        });
      } catch {
        // Observability is best effort and must not break routing.
      }
      return full;
    };
    const router = this.options.router;
    if (!router) return finish({ outcome: "skipped_no_router" });
    let selection: LiveModelSelectionReport;
    try {
      const discover = this.options.discover ?? discoverOpenCodeRoutes;
      selection = await discover({
        apiKey: this.options.apiKey,
        preferredModels: this.options.preferredModels ?? OPENCODE_PREFERRED_MODELS,
        ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      });
    } catch {
      return finish({ outcome: "skipped_failed" });
    }
    const active = activeCount(selection);
    if (active < 1) {
      return finish({
        outcome: "skipped_empty",
        status: selection.status,
        ...(selection.activeModel ? { activeModel: selection.activeModel } : {}),
      });
    }
    const configFingerprint = refreshRouterSelection(router, selection);
    return finish({
      outcome: "applied",
      status: selection.status,
      ...(selection.activeModel ? { activeModel: selection.activeModel } : {}),
      ...(selection.backupModel ? { backupModel: selection.backupModel } : {}),
      configFingerprint,
    });
  }
}
