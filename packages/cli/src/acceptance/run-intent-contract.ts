/**
 * Opt-in live intent/narration contract runner (plan: real acceptance).
 *
 * Reads the configured providers from the environment, builds a read-only
 * living-region snapshot, and runs the plan's three live phrases plus one
 * narration round-trip. It never creates a world or mutates the Event Log.
 * Exit 0 when the contract passes, 1 otherwise. Intended for a deployment
 * gate or a manual post-deploy check, not the fast repository suite.
 *
 *   npm run acceptance:intent:contract
 */

import {
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  rebuildProjection,
} from "@skald/world";
import { createRouterConfiguration } from "../runtime/router-factory.js";
import { buildMasterConversationContext } from "../conversation/context-builder.js";
import { probeLiveIntentContract } from "./live-intent-contract.js";

async function main(): Promise<number> {
  const configuration = createRouterConfiguration();
  const router = configuration?.router ?? null;
  const events = buildBootstrapEvents("living_region");
  const world = rebuildProjection(events).getSnapshot();
  const report = await probeLiveIntentContract(
    {
      events,
      world,
      scene: buildMasterTurnSceneContext(events, world),
      conversation: buildMasterConversationContext([], "live-contract"),
    },
    router,
    { timeoutMs: 20_000 },
  );
  process.stdout.write(`${JSON.stringify({ ok: report.pass, contract: report }, null, 2)}\n`);
  return report.pass ? 0 : 1;
}

main().then(
  (code) => { process.exitCode = code; },
  () => { process.exitCode = 1; },
);
