import type { HealthStatus } from "./types.js";

export interface HealthRecord {
  readonly status: HealthStatus;
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly lastCheckedAt: string;
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  readonly lastError: string | null;
  readonly totalChecks: number;
  readonly successChecks: number;
}

export function loadHealth(path: string): Record<string, HealthRecord> {
  try {
    const fs = require("fs");
    if (fs.existsSync(path)) {
      const raw = fs.readFileSync(path, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return {};
}

export function saveHealth(path: string, health: Record<string, HealthRecord>): void {
  try {
    const fs = require("fs");
    fs.writeFileSync(path, JSON.stringify(health, null, 2));
  } catch {
    // ignore
  }
}

export function classifyModelError(err: unknown): { status: HealthStatus; message: string } {
  const msg = String(err);
  if (msg.includes("429") || msg.includes("rate_limited") || msg.includes("rate limit"))
    return { status: "rate_limited", message: msg };
  if (msg.includes("403") || msg.includes("forbidden") || msg.includes("forbidden"))
    return { status: "forbidden", message: msg };
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("network"))
    return { status: "network_error", message: msg };
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504"))
    return { status: "server_error", message: msg };
  return { status: "unknown", message: msg };
}

export async function checkModel(router: { chatOnce: Function; providerId: string }, model: string): Promise<HealthRecord> {
  const start = performance.now();
  let status: HealthStatus = "ok";
  let error: string | null = null;
  let lastSuccess: string | null = null;
  try {
    await (router as any).chatOnce(model, [{ role: "user" as const, content: 'Ответь строго JSON: {"ok": true}. Без markdown.' }], { provider: router.providerId, maxTokens: 50 });
    status = "ok";
    lastSuccess = new Date().toISOString();
  } catch (err) {
    const classified = classifyModelError(err);
    status = classified.status;
    error = classified.message;
  }
  const latencyMs = Math.round(performance.now() - start);
  return {
    status,
    provider: router.providerId,
    model,
    latencyMs,
    lastCheckedAt: new Date().toISOString(),
    lastSuccessAt: lastSuccess,
    lastErrorAt: error ? new Date().toISOString() : null,
    lastError: error,
    totalChecks: 1,
    successChecks: status === "ok" ? 1 : 0,
  };
}
