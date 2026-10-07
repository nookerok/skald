/**
 * Deterministic vs model-plan vs repaired-plan parity (ADR-0039, T7.3).
 *
 * Same replicas through the deterministic command cycle and through a scripted
 * (and repaired) Master Turn plan must agree on the sanitized `command_outcome`,
 * the world-time delta and the committed event count.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";

const deadRouter = () => ({ apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) }) as any;
const parse = (r: { statusCode: number; body: string }) => JSON.parse(r.body);

function scriptedRouter(proposals: readonly unknown[]) {
  const queue = [...proposals];
  const last = proposals[proposals.length - 1];
  return {
    apiKey: "",
    chat: vi.fn(async (category: string) => {
      if (category === "interpret") {
        const next = queue.length > 0 ? queue.shift()! : last;
        return { text: typeof next === "string" ? next : JSON.stringify(next) };
      }
      return { text: "" };
    }),
  } as any;
}

async function fresh(tag: string, entrypointId: string, router: any, sink: (e: any) => void) {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-t73-${tag}-`)), "events.sqlite"));
  const worldId = `t73-${tag}`;
  store.createWorld({
    worldId, idempotencyKey: `c-${worldId}`, requestHash: `h-${worldId}`, saveLabel: "T7.3",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents({ templateId: "living_region", entrypointId, backgroundId: "wanderer" }),
  });
  const runtime = await new WorldRuntimeManager(store, router, sink).get(worldId);
  return { store, runtime };
}

async function run(tag: string, entrypointId: string, router: any, input: string) {
  const seen: any[] = [];
  const { store, runtime } = await fresh(tag, entrypointId, router, (e) => seen.push(e));
  try {
    const before = runtime.projection.getSnapshot();
    const eventsBefore = runtime.bus.query().length;
    const reply = parse(await handleWorldCommand(runtime, { input, idempotencyKey: `k-${tag}` }));
    const after = runtime.projection.getSnapshot();
    const outcome = [...seen].reverse().find((e) => e.category === "command_outcome");
    return {
      kind: reply.status ?? "exec",
      timeDelta: after.time - before.time,
      eventDelta: runtime.bus.query().length - eventsBefore,
      outcome: outcome?.movementOutcome ?? null,
      cost: outcome?.temporalCost ?? null,
      ticks: outcome?.tickPassedCount ?? null,
      policy: outcome?.timePolicy ?? null,
      targetKind: outcome?.movementTargetKind ?? null,
    };
  } finally {
    store.close();
  }
}

const journeyProposal = (surface: string) => ({
  schemaVersion: 2, kind: "mixed",
  primaryIntent: { kind: "journey", destination: { role: "destination", surface }, sourceText: "иду" },
  supportingClauses: [], question: { queryId: "visible_scene" }, referents: [],
});

const absentProposal = {
  schemaVersion: 2, kind: "mixed",
  primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к перевозчику" },
  supportingClauses: [], question: { queryId: "visible_scene" },
  target: { role: "target", surface: "перевозчику" },
  referents: [{ role: "target", surface: "перевозчику" }],
};

const expectParity = (det: any, model: any) => {
  expect(model.outcome).toBe(det.outcome);
  expect(model.cost).toBe(det.cost);
  expect(model.ticks).toBe(det.ticks);
  expect(model.policy).toBe(det.policy);
  expect(model.targetKind).toBe(det.targetKind);
  expect(model.timeDelta).toBe(det.timeDelta);
  expect(model.eventDelta).toBe(det.eventDelta);
};

describe("deterministic vs model-plan parity (T7.3)", () => {
  it("agrees on journey start", async () => {
    const det = await run("jrn-det", "river_waystation_arrival", deadRouter(), "Иду к Речному Стражу");
    const model = await run("jrn-model", "river_waystation_arrival", scriptedRouter([journeyProposal("Речной Страж")]), "Иду к Речному Стражу, что я вижу?");
    expectParity(det, model);
    expect(det.outcome).toBe("journey_started");
    expect(det.targetKind).toBe("remote_location");
  });

  it("agrees on an absent-contact rejection", async () => {
    const det = await run("abs-det", "southern_borough_arrival", deadRouter(), "Подойти к перевозчику");
    const model = await run("abs-model", "southern_borough_arrival", scriptedRouter([absentProposal]), "Подойти к перевозчику, что здесь происходит?");
    expectParity(det, model);
    expect(det.kind).toBe("action_rejection");
    expect(model.kind).toBe("action_rejection");
    expect(det.timeDelta).toBe(0);
  });

  it("agrees on a repaired plan (invalid then valid)", async () => {
    const det = await run("rep-det", "southern_borough_arrival", deadRouter(), "Подойти к перевозчику");
    const model = await run("rep-model", "southern_borough_arrival", scriptedRouter([{ kind: "mixed" }, absentProposal]), "Подойти к перевозчику, что здесь происходит?");
    expectParity(det, model);
    expect(model.kind).toBe("action_rejection");
  });

  it("agrees on a blocked journey", async () => {
    const det = await run("blk-det", "river_waystation_arrival", deadRouter(), "Иду в Неведомые земли");
    const model = await run("blk-model", "river_waystation_arrival", scriptedRouter([journeyProposal("Неведомые земли")]), "Иду в Неведомые земли, что я вижу?");
    expectParity(det, model);
    expect(det.outcome).toBe("blocked");
  });
});
