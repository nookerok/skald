/**
 * Unified MasterTurn envelope (plan_9 §6): one input ends in one object
 * with a stable opaque turnKey, kind, world-time span, deterministic text
 * and narration status. Autonomous journal turns are flagged, never answers.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand, handleWorldWait } from "../src/http/world-handlers.js";
import { buildMasterTurn, masterTurnKey, withMasterTurnNarration } from "../src/conversation/master-turn.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

function tmpDb(): string {
  return join(mkdtempSync(join(tmpdir(), "skald-master-envelope-")), "events.sqlite");
}

async function testRuntime(dbSuffix: string): Promise<{ store: ReturnType<typeof createMultiWorldStore>; runtime: WorldRuntime; worldId: string }> {
  const store = createMultiWorldStore(tmpDb());
  const worldId = `envelope-${dbSuffix}`;
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: "Envelope test",
    characterName: "Tester",
    characterPresetId: "wanderer",
    worldTemplateId: "old_tower",
    characterWound: "none",
    characterPromise: "observe",
    characterPrinciple: "care",
    characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents("old_tower"),
  });
  const manager = new WorldRuntimeManager(store, null);
  const runtime = await manager.get(worldId);
  return { store, runtime, worldId };
}

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

describe("MasterTurn envelope (plan_9 §6)", () => {
  it("issues stable opaque turn keys without internal identifiers", async () => {
    const { store, runtime, worldId } = await testRuntime("keys");
    try {
      const first = parse(await handleWorldCommand(runtime, { input: "осмотреться", idempotencyKey: "ek-1" }));
      const second = parse(await handleWorldCommand(runtime, { input: "осмотреться", idempotencyKey: "ek-2" }));
      const a = first.conversationTurn.turnKey as string;
      const b = second.conversationTurn.turnKey as string;
      expect(a).toMatch(/^[a-f0-9]{64}$/);
      expect(b).toMatch(/^[a-f0-9]{64}$/);
      expect(a).not.toBe(b);
      expect(a).toBe(masterTurnKey(worldId, "ek-1"));
      // The key carries no turn sequence, correlation, key text or world id.
      expect(a).not.toContain("ek-1");
      expect(a).not.toContain(worldId);
      expect(JSON.stringify(first.conversationTurn)).not.toMatch(/requestHash|contextMetadata/);
    } finally {
      store.close();
    }
  });

  it("ends action, inquiry and clarification inputs in one envelope each", async () => {
    const { store, runtime } = await testRuntime("kinds");
    try {
      const action = parse(await handleWorldCommand(runtime, { input: "осмотреться", idempotencyKey: "ek-action" }));
      expect(action.masterTurn).toMatchObject({ kind: "action_outcome", narration: { status: "not_requested" } });
      expect(action.masterTurn.turnKey).toBe(action.conversationTurn.turnKey);
      expect(action.masterTurn.worldTimeAfter - action.masterTurn.worldTimeBefore).toBeLessThanOrEqual(1);
      expect(action.masterTurn.deterministicText).toBe(action.conversationTurn.responseText);

      const inquiry = parse(await handleWorldCommand(runtime, { input: "где я?", idempotencyKey: "ek-inquiry" }));
      expect(inquiry.masterTurn).toMatchObject({ kind: "inquiry_answer", narration: { status: "not_requested" } });
      expect(inquiry.masterTurn.worldTimeBefore).toBe(inquiry.masterTurn.worldTimeAfter);

      const clarification = parse(await handleWorldCommand(runtime, { input: "абракадабра", idempotencyKey: "ek-clarify" }));
      expect(clarification.masterTurn).toMatchObject({ kind: "contextual_clarification", narration: { status: "not_requested" } });
      expect(clarification.masterTurn.deterministicText).toContain("правильно понял");
    } finally {
      store.close();
    }
  });

  it("marks advance journal turns autonomous and answers wait with an envelope", async () => {
    const { store, runtime } = await testRuntime("auto");
    try {
      const wait = parse(await handleWorldWait(runtime, { count: 1, idempotencyKey: "ek-wait" }));
      expect(wait.masterTurn).toMatchObject({ kind: "action_outcome", narration: { status: "not_requested" } });
      expect(wait.masterTurn.turnKey).toMatch(/^[a-f0-9]{64}$/);

      const advanced = parse(await handleWorldCommand(runtime, { input: "advance 3", idempotencyKey: "ek-advance" }));
      expect(advanced.masterTurn.kind).toBe("action_outcome");
      const journal = runtime.bus.query().length;
      expect(journal).toBeGreaterThan(0);
      const { buildTurnJournal } = await import("@skald/world");
      const turns = buildTurnJournal(runtime.bus.query()).turns;
      const offline = turns.filter((turn) => turn.autonomous === true);
      expect(offline.length).toBeGreaterThanOrEqual(3);
      const online = turns.filter((turn) => turn.autonomous !== true);
      expect(online.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it("leaks no internals through the envelope", async () => {
    const { store, runtime } = await testRuntime("leak");
    try {
      const response = parse(await handleWorldCommand(runtime, { input: "осмотреться", idempotencyKey: "ek-leak" }));
      expect(JSON.stringify(response.masterTurn)).not.toMatch(/eventId|sourceEventIds|correlation|idempotencyKey|turnSeq|coordinates|xMetres|entityId/);
    } finally {
      store.close();
    }
  });

  it("advances the narration lifecycle to ready/unavailable (plan_9 §6)", () => {
    const base = buildMasterTurn({
      worldId: "w",
      idempotencyKey: "k",
      kind: "action_outcome",
      worldTimeBefore: 0,
      worldTimeAfter: 1,
      deterministicText: "Ты осматриваешься.",
      narrationPending: true,
    });
    expect(base.narration).toEqual({ status: "pending" });

    const ready = withMasterTurnNarration(base, "ready", "Ты осматриваешься, и ветер несёт запах воды.");
    expect(ready.narration).toEqual({ status: "ready", text: "Ты осматриваешься, и ветер несёт запах воды." });
    expect(ready.turnKey).toBe(base.turnKey);
    expect(ready.deterministicText).toBe(base.deterministicText);
    expect(base.narration).toEqual({ status: "pending" });

    const unavailable = withMasterTurnNarration(base, "unavailable");
    expect(unavailable.narration).toEqual({ status: "unavailable" });
    expect(Object.isFrozen(unavailable)).toBe(true);
  });
});
