/**
 * Command time & movement characterization (command-time-and-scene-movement
 * T1, updated for the ADR-0039 contract by T3).
 *
 * Pins the command-path semantics: inquiry/clarification never move time;
 * ordinary and blocked attempts cost one pulse; a journey start costs one unit
 * with its first pulse at the start time; a traveling rejection and an
 * interrupt are cost 0; approach has exactly one owner outcome. The owner
 * matrix and the causal journey trace live here too.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, bootstrapWorldEvents, buildMasterTurnSceneContext } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { runCommandCycleForRuntime } from "../src/http/world-handlers.js";
import { validateMasterTurnPlan } from "../src/runtime/master-turn-validator.js";
import { executeMasterTurnPlan } from "../src/runtime/master-turn-executor.js";
import type { TurnProposalV2 } from "@skald/intent-parser";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

const MATRIX: string[] = [];

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

function deadRouter() {
  return { apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) } as any;
}

function evt(type: string, eventId: string, payload: unknown, timestamp = 0): any {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function contactEvent(entityId: string, name: string, locationId: string, aliases: readonly string[] = [name]): any {
  return evt("ObjectPlaced", entityId, {
    entityId,
    x: 1,
    y: 1,
    name,
    aliases: [...aliases],
    description: name,
    components: {
      contact: {
        locationId,
        profile: { visibleAppearance: ["x"], distinguishingFeatures: [], publicRole: name, knownAs: [name], addressForms: [name] },
      },
    },
  });
}

async function freshRuntime(
  tag: string,
  worldId: string,
  bootstrapEvents: readonly any[] = buildBootstrapEvents("living_region"),
  template = "living_region",
): Promise<{ store: ReturnType<typeof createMultiWorldStore>; runtime: WorldRuntime }> {
  const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), `skald-ct-${tag}-`)), "events.sqlite"));
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: "Time characterization",
    characterName: "Tester",
    characterPresetId: "wanderer",
    worldTemplateId: template,
    characterWound: "none",
    characterPromise: "observe",
    characterPrinciple: "care",
    characterProfileVersion: 1,
    bootstrapEvents,
  });
  const runtime: WorldRuntime = await new WorldRuntimeManager(store, deadRouter()).get(worldId);
  return { store, runtime };
}

interface Probe {
  readonly label: string;
  readonly status: string | undefined;
  readonly delta: readonly string[];
  readonly timeBefore: number;
  readonly timeAfter: number;
  readonly tickCount: number;
  readonly firstTimestamp: number | null;
  readonly resolvedResults: readonly (string | undefined)[];
  readonly reply: any;
  readonly runtime: WorldRuntime;
  readonly store: ReturnType<typeof createMultiWorldStore>;
}

async function probe(
  tag: string,
  worldId: string,
  input: string,
  key: string,
  bootstrapEvents?: readonly any[],
  template?: string,
  pre?: (runtime: WorldRuntime) => Promise<void>,
): Promise<Probe> {
  const { store, runtime } = await freshRuntime(tag, worldId, bootstrapEvents, template);
  if (pre) await pre(runtime);
  const before = runtime.projection.getSnapshot();
  const eventsBefore = runtime.bus.query().length;
  const reply = parse(await handleWorldCommand(runtime, { input, idempotencyKey: key }));
  const after = runtime.projection.getSnapshot();
  const delta = runtime.bus.query().slice(eventsBefore);
  const row = {
    label: input,
    status: reply.status,
    delta: delta.map((e) => e.type),
    timeBefore: before.time,
    timeAfter: after.time,
    tickCount: delta.filter((e) => e.type === "TickPassed").length,
    firstTimestamp: delta[0]?.timestamp ?? null,
    resolvedResults: delta
      .filter((e) => e.type === "ActionResolved")
      .map((e) => (e.payload as any).result),
    reply,
    runtime,
    store,
  };
  MATRIX.push(
    `${input} | status=${row.status} | time=${row.timeBefore}->${row.timeAfter} | tick=${row.tickCount} | firstTs=${row.firstTimestamp} | resolved=[${row.resolvedResults.join(",")}] | events=${row.delta.join(",")}`,
  );
  return row;
}

describe("command time & movement characterization (T1)", () => {
  it("inquiry and clarification never move the world", async () => {
    const inquiry = await probe("inq", "ct-inq", "Где я?", "ct-1");
    expect(inquiry.timeAfter).toBe(inquiry.timeBefore);
    expect(inquiry.delta).toHaveLength(0);
    inquiry.store.close();

    // No focus anywhere: the dual pronoun clarifies before anything runs.
    const ambiguous = await probe("amb", "ct-amb", "Подойду к нему", "ct-2");
    expect(ambiguous.status).toBe("clarification");
    expect(ambiguous.timeAfter).toBe(ambiguous.timeBefore);
    expect(ambiguous.delta).toHaveLength(0);
    ambiguous.store.close();
  });

  it("an ordinary action costs exactly one tick", async () => {
    const row = await probe("ord", "ct-ord", "осматриваюсь", "ct-3");
    expect(row.timeAfter).toBe(row.timeBefore + 1);
    expect(row.tickCount).toBe(1);
    expect(row.firstTimestamp).toBe(row.timeBefore + 1);
    expect(row.delta).toContain("InteractionRequested");
    row.store.close();
  });

  it("a physically blocked attempt still costs one tick (two-step ledger)", async () => {
    // Grid world: (0,0) -> east (1,0) Succeeded -> east (2,0) is a wall.
    // Kept as an explicit two-step ledger so "blocked costs +1" is proven,
    // not inferred from a single ambiguous delta.
    const { store, runtime } = await freshRuntime("blk", "ct-blk", bootstrapWorldEvents(), "old_tower");
    const ledger: string[] = [];
    const step = (label: string, key: string) => {
      const before = runtime.projection.getSnapshot().time;
      const eventsBefore = runtime.bus.query().length;
      return handleWorldCommand(runtime, { input: label, idempotencyKey: key }).then((res) => {
        const after = runtime.projection.getSnapshot().time;
        const delta = runtime.bus.query().slice(eventsBefore);
        ledger.push(`${label} | ${before}->${after} | ${delta.map((e) => e.type).join(",")}`);
        return { delta, before, after, res: parse(res) };
      });
    };
    try {
      const first = await step("move east", "ct-4a");
      expect(first.delta.some((e) => e.type === "MovementSucceeded")).toBe(true);
      expect(first.after).toBe(first.before + 1);

      const second = await step("move east", "ct-4");
      expect(second.delta.some((e) => e.type === "MovementBlocked")).toBe(true);
      expect(second.after).toBe(second.before + 1);
      expect(second.delta.filter((e) => e.type === "TickPassed").length).toBe(1);
      console.log("CT-BLOCKED-LEDGER:\n" + ledger.join("\n"));
    } finally {
      store.close();
    }
  });

  it("an unknown target refuses before execution at zero cost", async () => {
    const row = await probe("unk", "ct-unk", "Подойти к фонарю", "ct-5");
    expect(row.status).toBe("clarification");
    expect(row.timeAfter).toBe(row.timeBefore);
    expect(row.delta).toHaveLength(0);
    row.store.close();
  });

  it("journey start costs exactly one tick; its first pulse is at the start time", async () => {
    const row = await probe("jrn", "ct-jrn", "Иду к Речному Стражу", "ct-6");
    expect(row.delta.some((t) => t.startsWith("Journey"))).toBe(true);
    // ADR-0039: the first journey step pulses at the start command's own
    // logical time, so a start costs one world-time unit, not two.
    expect(row.timeAfter).toBe(row.timeBefore + 1);
    expect(row.tickCount).toBe(1);
    expect(row.firstTimestamp).toBe(row.timeBefore + 1);
    row.store.close();
  });

  it("a command during the journey is rejected at zero cost", async () => {
    const row = await probe("trv", "ct-trv", "осматриваюсь", "ct-7", undefined, undefined, async (runtime) => {
      parse(await handleWorldCommand(runtime, { input: "Иду к Речному Стражу", idempotencyKey: "ct-7a" }));
    });
    expect(row.delta).toContain("ActionRejected");
    // ADR-0039: a traveling rejection is cost 0 and must not move the clock.
    expect(row.timeAfter).toBe(row.timeBefore);
    expect(row.tickCount).toBe(0);
    row.store.close();
  });

  it("wait during the journey advances exactly one pulse", async () => {
    const row = await probe("wat", "ct-wat", "ждать", "ct-8", undefined, undefined, async (runtime) => {
      parse(await handleWorldCommand(runtime, { input: "Иду к Речному Стражу", idempotencyKey: "ct-8a" }));
    });
    expect(row.tickCount).toBe(1);
    expect(row.timeAfter).toBe(row.timeBefore + 1);
    row.store.close();
  });

  it("interrupt costs zero world time", async () => {
    const row = await probe("int", "ct-int", "остановиться", "ct-9", undefined, undefined, async (runtime) => {
      parse(await handleWorldCommand(runtime, { input: "Иду к Речному Стражу", idempotencyKey: "ct-9a" }));
    });
    expect(row.delta).toContain("JourneyInterrupted");
    // ADR-0039: a stop is immediate and free.
    expect(row.timeAfter).toBe(row.timeBefore);
    expect(row.tickCount).toBe(0);
    row.store.close();
  });

  it("an idempotent replay adds nothing", async () => {
    const { store, runtime } = await freshRuntime("idem", "ct-idem");
    const first = parse(await handleWorldCommand(runtime, { input: "осматриваюсь", idempotencyKey: "ct-10" }));
    expect(first.ok).toBe(true);
    const timeAfterFirst = runtime.projection.getSnapshot().time;
    const eventsAfterFirst = runtime.bus.query().length;
    const replay = parse(await handleWorldCommand(runtime, { input: "осматриваюсь", idempotencyKey: "ct-10" }));
    expect(replay.replayed).toBe(true);
    expect(runtime.projection.getSnapshot().time).toBe(timeAfterFirst);
    expect(runtime.bus.query().length).toBe(eventsAfterFirst);
    store.close();
  });

  it("grid direction belongs to physics.movement and yields one outcome", async () => {
    const { store, runtime } = await freshRuntime("grid", "ct-grid", bootstrapWorldEvents(), "old_tower");
    try {
      const eventsBefore = runtime.bus.query().length;
      parse(await handleWorldCommand(runtime, { input: "move north", idempotencyKey: "ct-11" }));
      const delta = runtime.bus.query().slice(eventsBefore);
      const moved = delta.filter((e) => e.type === "MovementSucceeded" || e.type === "MovementBlocked");
      expect(moved).toHaveLength(1);
      expect(delta.some((e) => e.type === "PlayerLocationChanged")).toBe(false);
    } finally {
      store.close();
    }
  });

  it("approach yields exactly one owner outcome — never two", async () => {
    const row = await probe("own", "ct-own", "Подойти к перевозчику", "ct-12");
    const movementOutcomes = row.delta.filter((t) => t === "PlayerLocationChanged" || t === "MovementSucceeded");
    expect(movementOutcomes, `events=${row.delta.join(",")}`).toHaveLength(0);
    expect(row.resolvedResults).toHaveLength(1);
    expect(row.resolvedResults[0]).toBe("approach");
    row.store.close();
  });

  it("journey start: full causal event trace proves the TickPassed source", async () => {
    const { store, runtime } = await freshRuntime("trace", "ct-trace");
    try {
      const timeBefore = runtime.projection.getSnapshot().time;
      const eventsBefore = runtime.bus.query().length;
      parse(await handleWorldCommand(runtime, { input: "Иду к Речному Стражу", idempotencyKey: "ct-trace" }));
      const timeAfter = runtime.projection.getSnapshot().time;
      const delta = runtime.bus.query().slice(eventsBefore);
      const trace = delta.map((e) => ({
        type: e.type,
        eventId: e.eventId,
        timestamp: e.timestamp,
        correlationId: e.correlationId,
        causationId: e.causationId,
        root: e.causationId == null,
      }));
      console.log(`CT-JOURNEY-TRACE: time ${timeBefore}->${timeAfter}\n` + JSON.stringify(trace, null, 1));
      const ticks = delta.filter((e) => e.type === "TickPassed");
      const rootTick = ticks.filter((e) => e.correlationId?.startsWith("tick-"));
      console.log(
        `CT-JOURNEY-TRACE-SUMMARY: ticks=${ticks.length} rootTicks=${rootTick.length} `
        + `rootTickCorrelations=[${rootTick.map((e) => e.correlationId).join(",")}] `
        + `journeyTs=[${delta.filter((e) => e.type.startsWith("Journey")).map((e) => e.timestamp).join(",")}]`,
      );
      const byType = (type: string) => delta.find((e) => e.type === type);
      // Provenance, not harness bookkeeping: the tick is caused by the journey
      // step, and the root command is the only causeless event.
      expect(byType("JourneyRequested")!.causationId).toBeNull();
      expect(byType("JourneyValidated")!.causationId).toContain("JourneyRequested");
      expect(byType("JourneyStarted")!.causationId).toContain("JourneyValidated");
      expect(byType("JourneyStepRequested")!.causationId).toContain("JourneyStarted");
      const tick = ticks[0]!;
      expect(tick.causationId).toContain("JourneyStepRequested");
      expect(rootTick).toHaveLength(0);
      expect(ticks.length).toBeGreaterThanOrEqual(1);
    } finally {
      store.close();
    }
  });

  it("remote location is owned by journey — no movement outcome", async () => {
    const { store, runtime } = await freshRuntime("rem", "ct-rem");
    try {
      const eventsBefore = runtime.bus.query().length;
      parse(await handleWorldCommand(runtime, { input: "Иду к Речному Стражу", idempotencyKey: "ct-rem" }));
      const delta = runtime.bus.query().slice(eventsBefore);
      expect(delta.some((e) => e.type === "JourneyStarted")).toBe(true);
      expect(delta.some((e) => e.type === "PlayerLocationChanged")).toBe(false);
      expect(delta.some((e) => e.type === "MovementSucceeded")).toBe(false);
    } finally {
      store.close();
    }
  });

  it("parity: the journey replica costs the same through the master-turn executor", async () => {
    const deterministic = await probe("par", "ct-par", "Иду к Речному Стражу", "ct-par");
    deterministic.store.close();

    // Same runtime environment, so the route resolver sees the same region
    // facts the deterministic path sees.
    const mt = await freshRuntime("par-mt", "ct-par-mt");
    try {
      const events = mt.runtime.bus.query();
      const world = mt.runtime.projection.getSnapshot();
      const scene = buildMasterTurnSceneContext(events, world);
      const route = scene.context.knownRoutes.find((r) => r.status === "open");
      if (!route) throw new Error("no open route in the scene");
      const validated = validateMasterTurnPlan({
        proposal: {
          schemaVersion: 2,
          kind: "action",
          primaryIntent: { kind: "journey", destination: { role: "destination", observerRef: route.observerRef, surface: route.label }, sourceText: "Иду к Речному Стражу" },
          supportingClauses: [],
          referents: [],
        } as TurnProposalV2,
        scene,
        world,
        rawText: "Иду к Речному Стражу",
      });
      console.log(`CT-PARITY-PLAN: status=${validated.status}`);
      expect(validated.status).toBe("accepted");
      if (validated.status !== "accepted") return;

      const before = mt.runtime.projection.getSnapshot().time;
      const executed = executeMasterTurnPlan(validated.plan, scene, {
        engine: mt.runtime.engine,
        projection: mt.runtime.projection,
        events,
        worldId: mt.runtime.worldId,
      });
      expect(executed.status).toBe("executed");
      if (executed.status !== "executed") return;
      const after = mt.runtime.projection.getSnapshot().time;
      const mtDelta = after - before;
      const mtTicks = mt.runtime.bus.query().slice(events.length).filter((e) => e.type === "TickPassed").length;

      const deterministicDelta = deterministic.timeAfter - deterministic.timeBefore;
      console.log(
        `CT-PARITY: deterministic delta=${deterministicDelta} ticks=${deterministic.tickCount} `
        + `| masterTurn delta=${mtDelta} ticks=${mtTicks}`,
      );
      expect(mtDelta).toBe(deterministicDelta);
      expect(mtTicks).toBe(deterministic.tickCount);
    } finally {
      mt.store.close();
    }
  });

  it("connected location belongs to interaction.movement", async () => {
    const world = [
      evt("PlayerSpawned", "wl-p", { x: 0, y: 0 }),
      evt("LocationDefined", "wl-a", { id: "hall", name: "Зал", description: "hall", objectIds: [], connections: { "двер": "yard" } }),
      evt("LocationDefined", "wl-b", { id: "yard", name: "Двор", description: "yard", objectIds: [], connections: {} }),
      evt("PlayerLocationChanged", "wl-pc", { locationId: "hall" }),
    ];
    const { store, runtime } = await freshRuntime("conn", "ct-conn", world, "living_region");
    try {
      const eventsBefore = runtime.bus.query().length;
      parse(await handleWorldCommand(runtime, { input: "подойти к двери", idempotencyKey: "ct-conn" }));
      const delta = runtime.bus.query().slice(eventsBefore);
      expect(delta.some((e) => e.type === "PlayerLocationChanged")).toBe(true);
      expect(runtime.projection.getSnapshot().currentLocationId).toBe("yard");
      expect(delta.some((e) => e.type === "ActionResolved" && (e.payload as any).result === "approach")).toBe(false);
    } finally {
      store.close();
    }
  });

  it("a known but absent contact is a cost-0 action rejection", async () => {
    const world = [...buildBootstrapEvents("living_region"), contactEvent("ct-abroad", "Староста", "riverwatch_city", ["старосте", "старосты"])];
    const { store, runtime } = await freshRuntime("abs", "ct-abs", world);
    try {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const res = parse(await handleWorldCommand(runtime, { input: "Подойти к старосте", idempotencyKey: "ct-abs" }));
      const delta = runtime.bus.query().slice(eventsBefore);
      console.log(`CT-ABSENT-CONTACT: status=${res.status} text=${res.responseText ?? res.question} events=[${delta.map((e) => e.type).join(",")}]`);
      // ADR-0039 §2 (T4): a known-but-absent contact is a real action
      // rejection, not a clarification. Cost 0, no Domain Event.
      expect(res.status).toBe("action_rejection");
      expect(res.reason).toBe("target_not_present");
      expect(String(res.responseText ?? res.question)).toContain("сейчас не рядом");
      expect(String(res.responseText ?? res.question)).not.toContain("Уточни");
      expect(delta).toHaveLength(0);
      expect(runtime.projection.getSnapshot().time).toBe(before.time);
    } finally {
      store.close();
    }
  });

  it("a contact colliding with a connection is owned by the contact for approach", async () => {
    const world = [
      evt("PlayerSpawned", "cc-p", { x: 0, y: 0 }),
      evt("LocationDefined", "cc-a", { id: "hall", name: "Зал", description: "hall", objectIds: ["cc-c"], connections: { "старост": "vault" } }),
      evt("LocationDefined", "cc-b", { id: "vault", name: "Подвал", description: "vault", objectIds: [], connections: {} }),
      evt("PlayerLocationChanged", "cc-pc", { locationId: "hall" }),
      contactEvent("cc-c", "Староста", "hall", ["старосте", "старосты"]),
    ];
    const { store, runtime } = await freshRuntime("col", "ct-col", world, "living_region");
    try {
      const eventsBefore = runtime.bus.query().length;
      parse(await handleWorldCommand(runtime, { input: "Подойти к старосте", idempotencyKey: "ct-col" }));
      const delta = runtime.bus.query().slice(eventsBefore);
      // ADR-0039 §2 (T4): for `approach` a present contact outranks a location
      // connection of the same name, so the NPC stays approachable.
      expect(delta.some((e) => e.type === "ActionResolved" && (e.payload as any).result === "approach")).toBe(true);
      expect(delta.some((e) => e.type === "PlayerLocationChanged")).toBe(false);
      expect(runtime.projection.getSnapshot().currentLocationId).toBe("hall");
    } finally {
      store.close();
    }
  });

  it("enter on a colliding surface is owned by the connection", async () => {
    const world = [
      evt("PlayerSpawned", "ce-p", { x: 0, y: 0 }),
      evt("LocationDefined", "ce-a", { id: "hall", name: "Зал", description: "hall", objectIds: ["ce-c"], connections: { "страж": "vault" } }),
      evt("LocationDefined", "ce-b", { id: "vault", name: "Подвал", description: "vault", objectIds: [], connections: {} }),
      evt("PlayerLocationChanged", "ce-pc", { locationId: "hall" }),
      contactEvent("ce-c", "Страж", "hall", ["стражу", "стража"]),
    ];
    const { store, runtime } = await freshRuntime("entcol", "ct-entcol", world, "living_region");
    try {
      const eventsBefore = runtime.bus.query().length;
      parse(await handleWorldCommand(runtime, { input: "Войти к стражу", idempotencyKey: "ct-entcol" }));
      const delta = runtime.bus.query().slice(eventsBefore);
      console.log(`CT-ENTER-COLLISION: events=[${delta.map((e) => e.type).join(",")}]`);
      // ADR-0039 §2: `enter` prefers the connection even when a present
      // contact shares the name.
      expect(delta.some((e) => e.type === "PlayerLocationChanged")).toBe(true);
      expect(delta.some((e) => e.type === "ActionResolved" && (e.payload as any).result === "approach")).toBe(false);
    } finally {
      store.close();
    }
  });

  it("command outcome diagnostics parity: deterministic vs master-turn", async () => {
    const det = await freshRuntime("diag-det", "ct-diag-det");
    const detResult = await runCommandCycleForRuntime(det.runtime, "Иду к Речному Стражу", "diag-det");
    const detDiag = (detResult as any).diagnostics;
    det.store.close();

    const mt = await freshRuntime("diag-mt", "ct-diag-mt");
    const events = mt.runtime.bus.query();
    const world = mt.runtime.projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const route = scene.context.knownRoutes.find((r) => r.status === "open")!;
    const validated = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "journey", destination: { role: "destination", observerRef: route.observerRef, surface: route.label }, sourceText: "Иду к Речному Стражу" },
        supportingClauses: [],
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "Иду к Речному Стражу",
    });
    expect(validated.status).toBe("accepted");
    if (validated.status !== "accepted") return;
    const executed = executeMasterTurnPlan(validated.plan, scene, {
      engine: mt.runtime.engine,
      projection: mt.runtime.projection,
      events,
      worldId: mt.runtime.worldId,
    });
    mt.store.close();
    expect(executed.status).toBe("executed");
    if (executed.status !== "executed") return;
    expect(executed.diagnostics.movement.targetKind).toBe(detDiag.movement.targetKind);
    expect(executed.diagnostics.movement.outcome).toBe(detDiag.movement.outcome);
    expect(executed.diagnostics.temporal.cost).toBe(detDiag.temporal.cost);
    expect(executed.diagnostics.temporal.tickPassedCount).toBe(detDiag.temporal.tickPassedCount);
    expect(executed.diagnostics.temporal.policy).toBe(detDiag.temporal.policy);
  });

  it("the player command response never carries command diagnostics", async () => {
    const row = await probe("leak", "ct-leak", "осматриваюсь", "ct-leak");
    const body = JSON.stringify(row.reply);
    for (const key of ["targetKind", "timePolicy", "tickPassedCount", "movementOutcome", "temporalCost", "movementTargetKind"]) {
      expect(body).not.toContain(key);
    }
    row.store.close();
  });

  it("both executors call the shared planCommandTime; no inline suppressTick remains", () => {
    // Architecture pin only. The behavioural parity matrix (deterministic vs
    // scripted/repaired plan) is the primary evidence; this source-text check
    // is an extra guard and is expected to be updated on a refactor.
    const executor = readFileSync(new URL("../src/runtime/master-turn-executor.ts", import.meta.url), "utf8");
    const handlers = readFileSync(new URL("../src/http/world-handlers.ts", import.meta.url), "utf8");
    for (const source of [executor, handlers]) {
      expect(source).not.toContain("suppressTick");
      expect(source).toContain("planCommandTime");
    }
  });

  it("prints the full characterization matrix", () => {
    console.log("CT-MATRIX:\n" + MATRIX.join("\n"));
    expect(MATRIX.length).toBeGreaterThan(0);
  });
});
