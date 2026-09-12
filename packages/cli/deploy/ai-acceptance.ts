/**
 * Deployment acceptance gate for AI readiness (ADR-0036, playable amendment).
 *
 * Pure decision over a sanitized ai-probe body, shared by install-orange-pi.sh
 * and update-orange-pi.sh so the acceptance semantics is tested code instead
 * of duplicated shell. The endpoint contract is untouched (HTTP 200 iff
 * `ready`); this helper reads `readiness.status` and `playable` from the
 * body and accepts `(ready|degraded) AND playable`.
 *
 * CLI: `node --import tsx packages/cli/deploy/ai-acceptance.ts < body.json`
 * prints one line and exits 0 on accept, 1 on reject. Any failure —
 * unparsable input, unknown shape, helper crash — rejects fail-closed.
 */

import { readFileSync } from "node:fs";

export interface AiAcceptance {
  readonly accepted: boolean;
  /** Top-level readiness status, or "unknown" when absent/unparsable. */
  readonly status: string;
  /** True only when both routes have a working candidate. */
  readonly playable: boolean;
}

/** Pure acceptance decision over an unknown probe body. Never throws. */
export function decideAiAcceptance(body: unknown): AiAcceptance {
  let status = "unknown";
  let playable = false;
  try {
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      const readiness = record["readiness"];
      if (typeof readiness === "object" && readiness !== null) {
        const inner = readiness as Record<string, unknown>;
        if (typeof inner["status"] === "string" && (inner["status"] as string).length > 0) {
          status = inner["status"] as string;
        }
        // `playable` lives inside `readiness`, next to `status` — exactly
        // where AIReadinessReport (and the /api/ops/ai-probe DTO wrapping
        // it) carries it. A top-level `playable` is NOT accepted: tolerating
        // both shapes would let the helper and the endpoint drift apart
        // silently again.
        playable = inner["playable"] === true;
      }
    }
  } catch {
    status = "unknown";
    playable = false;
  }
  const accepted = (status === "ready" || status === "degraded") && playable;
  return { accepted, status, playable };
}

/** Single-line verdict for deploy logs. */
export function formatAiAcceptance(decision: AiAcceptance): string {
  if (decision.accepted) {
    return decision.status === "ready"
      ? "AI readiness is ready and playable."
      : "AI readiness is degraded but playable (accepted: one live model serves, deterministic fallback covers the rest).";
  }
  if (decision.status === "ready" || decision.status === "degraded") {
    return `AI readiness is ${decision.status} but not playable: a route has no working candidate.`;
  }
  return `AI readiness failed (status: ${decision.status}).`;
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

function main(): number {
  let body: unknown;
  try {
    body = JSON.parse(readStdin()) as unknown;
  } catch {
    body = undefined;
  }
  const decision = decideAiAcceptance(body);
  process.stdout.write(`${formatAiAcceptance(decision)}\n`);
  return decision.accepted ? 0 : 1;
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("ai-acceptance.ts");
if (invokedAsScript) {
  process.exitCode = main();
}
