/**
 * Replay finalize contract: the world commit and the conversation turn are
 * durable, but the response envelope write can still fail between them.
 * The failure must be diagnosed structurally (never swallowed), the
 * request must fail 500 without pinning, and the identical retry must
 * recover to 200 + replayed instead of 409 — with a frozen log, frozen
 * time, a single transcript turn and no repeated narration scheduling.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

function campEvent(type: string, eventId: string, payload: unknown): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 0, correlationId: "bootstrap", causationId: null };
}

describe("replay finalize contract", () => {
  it("fails 500 with a structured diagnostic, then recovers the retry to 200 + replayed", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-replay-finalize-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "replay-finalize";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Replay finalize",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: [...buildBootstrapEvents("old_tower"), campEvent("PlayerSpawned", "boot-player-2", { x: 1, y: 1 })],
      });
      const diagnostics: unknown[] = [];
      const manager = new WorldRuntimeManager(store, null, ((event: unknown) => {
        diagnostics.push(event);
      }) as never);
      const runtime: WorldRuntime = await manager.get(worldId);

      const save = vi.spyOn(store, "saveCommandReplay").mockImplementationOnce(() => {
        throw new Error("disk fault between commit and envelope");
      });
      const first = await handleWorldCommand(runtime, { input: "Осмотреться.", idempotencyKey: "rk-fault" });
      expect(save).toHaveBeenCalledTimes(1);
      expect(first.statusCode).toBe(500);
      expect(JSON.parse(first.body)).toMatchObject({ ok: false, error: { code: "internal_error" } });

      const finalizeDiag = diagnostics.filter((event) => {
        const record = event as Record<string, unknown>;
        return record.category === "persistence_error" && typeof record.detail === "string"
          && (record.detail as string).includes("command_replay_save_failed");
      });
      expect(finalizeDiag).toHaveLength(1);
      const detail = (finalizeDiag[0] as Record<string, unknown>).detail as string;
      expect(detail).not.toContain("Осмотреться");
      expect(detail).not.toContain("rk-fault");
      expect((finalizeDiag[0] as Record<string, unknown>).worldId).toBe(worldId);

      // The world committed exactly once; the envelope row is absent.
      expect(store.getCommandReplay(worldId, "rk-fault")).toBeNull();
      expect(store.listConversationTurns(worldId)).toHaveLength(1);
      const eventsAfterFirst = runtime.bus.query().length;
      const timeAfterFirst = runtime.projection.getSnapshot().time;

      const retry = await handleWorldCommand(runtime, { input: "Осмотреться.", idempotencyKey: "rk-fault" });
      expect(retry.statusCode).toBe(200);
      const retryBody = JSON.parse(retry.body);
      expect(retryBody.replayed).toBe(true);
      expect(retryBody.recovered).toBe(true);
      expect(retryBody.conversationTurn).toMatchObject({ playerText: "Осмотреться.", inputClass: "action" });
      expect(typeof retryBody.masterTurn?.turnKey).toBe("string");

      // Frozen world, single transcript turn, no narration rescheduling.
      expect(runtime.bus.query().length).toBe(eventsAfterFirst);
      expect(runtime.projection.getSnapshot().time).toBe(timeAfterFirst);
      expect(store.listConversationTurns(worldId)).toHaveLength(1);
      expect(runtime.narration.pendingCount()).toBe(0);

      // The recovery pins: the next identical retry serves identical bytes.
      const again = await handleWorldCommand(runtime, { input: "Осмотреться.", idempotencyKey: "rk-fault" });
      expect(again.statusCode).toBe(200);
      expect(again.body).toBe(retry.body);

      // A reused key with a different payload still conflicts.
      const conflict = await handleWorldCommand(runtime, { input: "Другой текст.", idempotencyKey: "rk-fault" });
      expect(conflict.statusCode).toBe(409);
      expect(store.listConversationTurns(worldId)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("diagnoses a failed recovery pin without failing the recovered retry", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-replay-pin-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "replay-pin";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Replay pin",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: [...buildBootstrapEvents("old_tower"), campEvent("PlayerSpawned", "boot-player-2", { x: 1, y: 1 })],
      });
      const diagnostics: unknown[] = [];
      const manager = new WorldRuntimeManager(store, null, ((event: unknown) => {
        diagnostics.push(event);
      }) as never);
      const runtime: WorldRuntime = await manager.get(worldId);

      // Fail the original save and the recovery pin alike: the retry must
      // still answer 200 + recovered, with both failures diagnosed.
      const save = vi.spyOn(store, "saveCommandReplay").mockImplementation(() => {
        throw new Error("disk fault");
      });
      const first = await handleWorldCommand(runtime, { input: "Осмотреться.", idempotencyKey: "rk-pin" });
      expect(first.statusCode).toBe(500);
      const retry = await handleWorldCommand(runtime, { input: "Осмотреться.", idempotencyKey: "rk-pin" });
      expect(retry.statusCode).toBe(200);
      expect(JSON.parse(retry.body)).toMatchObject({ replayed: true, recovered: true });
      expect(save).toHaveBeenCalledTimes(2);
      const pinDiags = diagnostics.filter((event) => {
        const record = event as Record<string, unknown>;
        return record.category === "persistence_error" && typeof record.detail === "string"
          && (record.detail as string).includes("command_replay_save_failed");
      });
      expect(pinDiags).toHaveLength(2);

      // The store heals: the next identical retry pins and converges.
      save.mockRestore();
      const healed = await handleWorldCommand(runtime, { input: "Осмотреться.", idempotencyKey: "rk-pin" });
      expect(healed.statusCode).toBe(200);
      expect(healed.body).toBe(retry.body);
      expect(store.listConversationTurns(worldId)).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
