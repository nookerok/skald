/**
 * Command time & scene movement integration matrix (ADR-0039, T7.1).
 *
 * One scratch world, real command path, per-step ledger (response kind, world
 * time before/after, event delta, sanitized command_outcome, replay result,
 * persisted turn), then a SQLite close/reopen + replay-purity re-check.
 *
 * Deferred (not implemented, so not asserted): proximity-GATED acts and a
 * withdraw/«отойти» operation.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, rebuildProjection } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

const deadRouter = () => ({ apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) }) as any;
const parse = (r: { statusCode: number; body: string }) => JSON.parse(r.body);

async function fresh(tag: string, sink: (e: any) => void) {
  const db = join(mkdtempSync(join(tmpdir(), `skald-t71-${tag}-`)), "events.sqlite");
  const store = createMultiWorldStore(db);
  const worldId = `t71-${tag}`;
  store.createWorld({
    worldId, idempotencyKey: `c-${worldId}`, requestHash: `h-${worldId}`, saveLabel: "T7.1",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" }),
  });
  const runtime: WorldRuntime = await new WorldRuntimeManager(store, deadRouter(), sink).get(worldId);
  return { db, store, runtime, worldId };
}

describe("command time & movement integration matrix (T7.1)", () => {
  it("covers every owner and survives a store restart", async () => {
    const seen: any[] = [];
    const { db, store, runtime, worldId } = await fresh("matrix", (e) => seen.push(e));
    const ledger: any[] = [];
    const run = async (input: string, key: string) => {
      const before = runtime.projection.getSnapshot();
      const eventsBefore = runtime.bus.query().length;
      const raw = await handleWorldCommand(runtime, { input, idempotencyKey: key });
      const reply = parse(raw);
      const after = runtime.projection.getSnapshot();
      const lastOutcome = [...seen].reverse().find((e) => e.category === "command_outcome");
      const entry = {
        input,
        statusCode: raw.statusCode,
        kind: reply.status ?? "exec",
        timeBefore: before.time,
        timeAfter: after.time,
        events: runtime.bus.query().length - eventsBefore,
        outcome: lastOutcome?.movementOutcome ?? null,
        cost: lastOutcome?.temporalCost ?? null,
        ticks: lastOutcome?.tickPassedCount ?? null,
        replayed: reply.replayed === true,
      };
      ledger.push(entry);
      seen.length = 0;
      return { ...entry, before, after, reply };
    };

    try {
      const s1 = await run("Где я?", "m1");
      expect(s1.kind).toBe("inquiry");
      expect(s1.timeAfter).toBe(s1.timeBefore);
      expect(s1.outcome).toBe("none");

      const s2 = await run("Подойти к перевозчику", "m2");
      expect(s2.timeAfter).toBe(s2.timeBefore + 1);
      expect(s2.outcome).toBe("approached");
      expect(s2.after.sceneEngagement?.state).toBe("near");
      const establishedAt = s2.after.sceneEngagement?.establishedAt;

      const s3 = await run("Подойти к перевозчику", "m3");
      expect(s3.timeAfter).toBe(s3.timeBefore + 1);
      expect(s3.after.sceneEngagement?.establishedAt).toBe(establishedAt);

      const s4 = await run("Иду к Речному Стражу", "m4");
      expect(s4.timeAfter).toBe(s4.timeBefore + 1);
      expect(s4.outcome).toBe("journey_started");
      expect(s4.after.sceneEngagement).toBeNull();

      const s5 = await run("осматриваюсь", "m5");
      expect(s5.timeAfter).toBe(s5.timeBefore);
      expect(s5.outcome).toBe("rejected");

      const s6 = await run("остановиться", "m6");
      expect(s6.timeAfter).toBe(s6.timeBefore);
      expect(s6.after.activeJourneyId).toBeNull();

      await run("Иду к Речному Стражу", "m7");
      const s8 = await run("ждать", "m8");
      expect(s8.timeAfter).toBe(s8.timeBefore + 1);
      expect(s8.after.currentLocationId).toBe("riverwatch_city");

      const s9 = await run("Подойти к перевозчику", "m9");
      expect(s9.kind).toBe("action_rejection");
      expect(s9.timeAfter).toBe(s9.timeBefore);
      expect(s9.outcome).toBe("rejected");
      expect(s9.events).toBe(0);

      const s10 = await run("Иду в Неведомые земли", "m10");
      expect(s10.outcome).toBe("blocked");

      const s11 = await run("Подойти к перевозчику", "m2");
      expect(s11.replayed).toBe(true);
      expect(s11.timeAfter).toBe(s11.timeBefore);

      const conflict = await handleWorldCommand(runtime, { input: "ждать", idempotencyKey: "m2" });
      expect(conflict.statusCode).toBe(409);

      const live = runtime.projection.getSnapshot();
      const turnsBefore = store.listConversationTurns(worldId).length;
      store.close();

      const reopened = createMultiWorldStore(db);
      try {
        const events = reopened.loadEvents(worldId);
        const rebuilt = rebuildProjection(events).getSnapshot();
        expect(rebuilt.time).toBe(live.time);
        expect(rebuilt.eventNumber).toBe(live.eventNumber);
        expect(rebuilt.currentLocationId).toBe(live.currentLocationId);
        expect(rebuilt.activeJourneyId).toBe(live.activeJourneyId);
        expect(rebuilt.sceneEngagement).toEqual(live.sceneEngagement);
        expect(reopened.listConversationTurns(worldId).length).toBe(turnsBefore);

        // Real application restart: a FRESH runtime over the same store, then
        // idempotency must still hold (replay + conflict).
        const restarted: WorldRuntime = await new WorldRuntimeManager(reopened, deadRouter(), (e) => seen.push(e)).get(worldId);
        const timeAfterRestart = restarted.projection.getSnapshot().time;
        const eventsAfterRestart = restarted.bus.query().length;
        const turnsAfterRestart = reopened.listConversationTurns(worldId).length;
        const replay = parse(await handleWorldCommand(restarted, { input: "Подойти к перевозчику", idempotencyKey: "m2" }));
        expect(replay.replayed).toBe(true);
        expect(restarted.projection.getSnapshot().time).toBe(timeAfterRestart);
        expect(restarted.bus.query().length).toBe(eventsAfterRestart);
        expect(reopened.listConversationTurns(worldId).length).toBe(turnsAfterRestart);
        const conflict = await handleWorldCommand(restarted, { input: "ждать", idempotencyKey: "m2" });
        expect(conflict.statusCode).toBe(409);
      } finally {
        reopened.close();
      }
      console.log("T7.1 LEDGER:\n" + ledger.map((e) => `${e.input} | ${e.kind} | ${e.timeBefore}->${e.timeAfter} | events=${e.events} | ${e.outcome} | cost=${e.cost} ticks=${e.ticks} | replayed=${e.replayed}`).join("\n"));
    } finally {
      try { store.close(); } catch { /* already closed */ }
    }
  });
});
