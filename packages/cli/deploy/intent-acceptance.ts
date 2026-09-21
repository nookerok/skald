/**
 * Deployment acceptance gate for the live intent/narration contract.
 *
 * Pure decision over a sanitized `/api/ops/intent-probe` body, shared by
 * install-orange-pi.sh and update-orange-pi.sh. Accepts only when the probe's
 * `contract.pass` is explicitly true; every other shape — unparsable input,
 * missing contract, false pass — rejects fail-closed. Simulation liveness and
 * AI readiness alone do not prove the master can carry a turn.
 *
 * CLI: `node --import tsx packages/cli/deploy/intent-acceptance.ts < body.json`
 * prints one line and exits 0 on accept, 1 on reject.
 */

import { readFileSync } from "node:fs";

export interface IntentAcceptance {
  readonly accepted: boolean;
  readonly pass: boolean;
}

/** Pure acceptance decision over an unknown probe body. Never throws. */
export function decideIntentAcceptance(body: unknown): IntentAcceptance {
  let pass = false;
  try {
    if (typeof body === "object" && body !== null) {
      const contract = (body as Record<string, unknown>)["contract"];
      if (typeof contract === "object" && contract !== null) {
        pass = (contract as Record<string, unknown>)["pass"] === true;
      }
    }
  } catch {
    pass = false;
  }
  return { accepted: pass, pass };
}

/** Single-line verdict for deploy logs. */
export function formatIntentAcceptance(decision: IntentAcceptance): string {
  return decision.accepted
    ? "Live intent/narration contract passed (three phrases + narration)."
    : "Live intent/narration contract failed: the master cannot carry a turn on the deployed providers.";
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
  const decision = decideIntentAcceptance(body);
  process.stdout.write(`${formatIntentAcceptance(decision)}\n`);
  return decision.accepted ? 0 : 1;
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("intent-acceptance.ts");
if (invokedAsScript) {
  process.exitCode = main();
}
