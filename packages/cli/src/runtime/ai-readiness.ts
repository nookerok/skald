import { probeAIReadiness, type AIReadinessReport, type ModelRouter, type AIDiagnosticSink, type LiveModelSelectionReport } from "@skald/world";

export interface AIReadinessOptions {
  readonly cooldownMs?: number;
  readonly timeoutMs?: number;
  /** Secret-free fingerprint captured by the same environment factory as the router. */
  readonly configFingerprint?: string;
  /** Sanitized startup catalogue/probe selection report. */
  readonly selectionReport?: LiveModelSelectionReport;
  readonly diagnostics?: AIDiagnosticSink;
  readonly now?: () => number;
}

/**
 * Serializes and caches operational probes. It never receives a world id and
 * never owns or mutates simulation state.
 */
export class AIReadinessService {
  private inFlight: Promise<AIReadinessReport> | null = null;
  private lastReport: AIReadinessReport | null = null;
  private lastStartedAt = -Infinity;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly configFingerprint: string | undefined;
  private readonly selectionReport: LiveModelSelectionReport | undefined;
  private readonly now: () => number;

  constructor(
    private readonly router: ModelRouter | null,
    options?: AIReadinessOptions,
  ) {
    this.cooldownMs = Math.max(0, Math.floor(options?.cooldownMs ?? 15_000));
    this.timeoutMs = Math.max(1, Math.floor(options?.timeoutMs ?? 10_000));
    this.configFingerprint = options?.configFingerprint;
    this.selectionReport = options?.selectionReport;
    this.now = options?.now ?? (() => Date.now());
    this.diagnostics = options?.diagnostics;
  }

  private readonly diagnostics: AIDiagnosticSink | undefined;

  async probe(): Promise<AIReadinessReport> {
    if (this.inFlight) return this.inFlight;
    const now = this.now();
    if (this.lastReport && now - this.lastStartedAt < this.cooldownMs) return this.lastReport;
    this.lastStartedAt = now;
    // Prefer the router's live selection/fingerprint: daily re-discovery
    // applies fresh selections to the router, while this service only holds
    // the startup snapshot. Reading live avoids reporting stale models after
    // a Zen->Ollama (or back) refresh.
    const liveSelection = (this.router as unknown as { liveModelSelection?: () => LiveModelSelectionReport | undefined })?.liveModelSelection?.();
    const selectionReport = liveSelection ?? this.selectionReport;
    const liveFingerprint = (this.router as unknown as { configFingerprint?: () => string })?.configFingerprint?.();
    const configFingerprint = liveFingerprint ?? this.configFingerprint;
    const request = probeAIReadiness(this.router, {
      timeoutMs: this.timeoutMs,
      ...(configFingerprint ? { configFingerprint } : {}),
      ...(selectionReport ? { selectionReport } : {}),
      ...(this.diagnostics ? { diagnostics: (event) => this.diagnostics?.(event) } : {}),
    });
    this.inFlight = request;
    try {
      const report = await request;
      this.lastReport = report;
      return report;
    } finally {
      if (this.inFlight === request) this.inFlight = null;
    }
  }

  cached(): AIReadinessReport | null {
    return this.lastReport;
  }

  isProbing(): boolean {
    return this.inFlight !== null;
  }
}
