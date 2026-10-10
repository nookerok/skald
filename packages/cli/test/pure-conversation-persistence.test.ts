/**
 * Pure-conversation persistence (Conversation Director P2 / S1): a turn with
 * ZERO world events must be saved exactly once, must not move world time, and a
 * retry (including the crash window before the HTTP envelope is written) must
 * not duplicate the turn NOR change its MasterTurn kind.
 *
 * The store already provides the capability through `recordConversationTurn`
 * (idempotent + transactional); `processSequence` deliberately skips its durable
 * commit for an empty batch, so read-side turns must use that API.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents, rebuildProjection } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { DuplicateRequestError } from "../src/persistence/sqlite-store.js";
import { buildReadSideConversationTurn, buildSpeechConversationTurn } from "../src/conversation/builder.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

const WORLD = "p2-world";

function freshStore() {
  const db = join(mkdtempSync(join(tmpdir(), "skald-p2-")), "events.sqlite");
  const store = createMultiWorldStore(db);
  const bootstrap = buildBootstrapEvents("living_region");
  store.createWorld({
    worldId: WORLD, idempotencyKey: `c-${WORLD}`, requestHash: `h-${WORLD}`, saveLabel: "P2",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care",
    characterProfileVersion: 1, bootstrapEvents: bootstrap,
  });
  return { store, db, bootstrap };
}

const clarificationDraft = (idempotencyKey: string, playerText: string, worldTime = 0) =>
  buildReadSideConversationTurn({
    worldId: WORLD, idempotencyKey, playerText,
    inputClass: "clarification", responseKind: "clarification",
    responseText: "Что именно ты хочешь спросить?", worldTime,
  });

describe("pure conversation turn persistence (P2)", () => {
  it("saves a zero-event read-only turn exactly once and never moves world time", () => {
    const { store, bootstrap } = freshStore();
    try {
      const before = store.listConversationTurns(WORLD).length;
      const record = store.recordConversationTurn(clarificationDraft("p2-1", "спроси меня ещё раз"));
      expect(record.turnSeq).toBeGreaterThan(0);

      // Zero world events, zero time: a pure conversation changes nothing.
      const events = store.loadEvents(WORLD);
      expect(events.length).toBe(bootstrap.length);
      expect(rebuildProjection(events).getSnapshot().time).toBe(rebuildProjection(bootstrap).getSnapshot().time);

      const again = store.recordConversationTurn(clarificationDraft("p2-1", "спроси меня ещё раз"));
      expect(again.turnSeq).toBe(record.turnSeq);
      expect(store.listConversationTurns(WORLD).length).toBe(before + 1);
    } finally {
      store.close();
    }
  });

  it("pins the future speech contract: speech → speech_reaction, saved once", () => {
    const { store, bootstrap } = freshStore();
    try {
      const projectedWorld = rebuildProjection(bootstrap).getSnapshot();
      const draft = buildSpeechConversationTurn({
        worldId: WORLD,
        correlationId: "cmd-1",
        idempotencyKey: "p2-speech",
        playerText: "Привет, перевозчик",
        worldTimeBefore: projectedWorld.time,
        stagedEvents: [], // a pure conversation turn carries NO world events
        projectedWorld,
      });
      expect(draft.inputClass).toBe("speech");
      expect(draft.responseKind).toBe("speech_reaction");

      const saved = store.recordConversationTurn(draft);
      expect(saved.inputClass).toBe("speech");
      expect(saved.responseKind).toBe("speech_reaction");
      expect(store.loadEvents(WORLD).length).toBe(bootstrap.length);

      const replayed = store.recordConversationTurn(draft);
      expect(replayed.turnSeq).toBe(saved.turnSeq);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("rejects a conflicting retry under the same key", () => {
    const { store } = freshStore();
    try {
      store.recordConversationTurn(clarificationDraft("p2-2", "первый"));
      const conflicting = buildReadSideConversationTurn({
        worldId: WORLD, idempotencyKey: "p2-2", playerText: "совсем другое",
        inputClass: "clarification", responseKind: "clarification",
        responseText: "x", worldTime: 0,
      });
      expect(() => store.recordConversationTurn(conflicting)).toThrow(DuplicateRequestError);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("two connections with the same key + hash share ONE row (no DuplicateRequestError)", () => {
    const { store, db } = freshStore();
    const second = createMultiWorldStore(db);
    try {
      const turn = clarificationDraft("p2-cc", "один и тот же запрос");
      const a = store.recordConversationTurn(turn);
      const b = second.recordConversationTurn(turn);
      expect(b.turnSeq).toBe(a.turnSeq);
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      // A different hash on either connection is still a conflict.
      const conflict = buildReadSideConversationTurn({
        worldId: WORLD, idempotencyKey: "p2-cc", playerText: "другой",
        inputClass: "clarification", responseKind: "clarification",
        responseText: "y", worldTime: 0,
      });
      expect(() => second.recordConversationTurn(conflict)).toThrow(DuplicateRequestError);
    } finally {
      second.close();
      store.close();
    }
  });

  it("two truly concurrent commands with the same key produce ONE turn", async () => {
    const { store } = freshStore();
    let runtime: WorldRuntime | null = null;
    try {
      runtime = await new WorldRuntimeManager(store, { apiKey: "", chat: () => { throw new Error("model down"); } } as never).get(WORLD);
      const eventsBefore = store.loadEvents(WORLD).length;
      const timeBefore = rebuildProjection(store.loadEvents(WORLD)).getSnapshot().time;
      const input = "Кто здесь?";
      const idempotencyKey = `t7-cc-${Date.now()}`;
      const [a, b] = await Promise.all([
        handleWorldCommand(runtime, { input, idempotencyKey }),
        handleWorldCommand(runtime, { input, idempotencyKey }),
      ]);
      const parsed = [a, b].map((r) => ({ status: r.statusCode, body: JSON.parse(r.body) as { replayed?: boolean } }));
      for (const p of parsed) expect(p.status).toBe(200);
      // Invariant under concurrency: ONE durable turn, no duplicated events,
      // no time movement. A concurrent same-key read-only pair may both report
      // a response; the second's store write is idempotent.
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
      expect(store.loadEvents(WORLD)).toHaveLength(eventsBefore);
      expect(rebuildProjection(store.loadEvents(WORLD)).getSnapshot().time).toBe(timeBefore);
    } finally {
      store.close();
    }
  });

  it("HTTP recovery replay keeps the ORIGINAL MasterTurn kind (not contextual_clarification)", async () => {
    const { store } = freshStore();
    let runtime: WorldRuntime | null = null;
    try {
      // Crash window: the turn is durable, the HTTP envelope is NOT written.
      const projectedWorld = rebuildProjection(store.loadEvents(WORLD)).getSnapshot();
      const reply = "Ты подходишь ближе. Перед тобой — Перевозчик у переправы.";
      store.recordConversationTurn(buildReadSideConversationTurn({
        worldId: WORLD, idempotencyKey: "p2-http", playerText: "кто переводит лодку?",
        inputClass: "inquiry", responseKind: "inquiry_answer",
        responseText: reply, worldTime: projectedWorld.time,
      }));
      expect(store.getCommandReplay(WORLD, "p2-http")).toBeNull();

      runtime = await new WorldRuntimeManager(store, { apiKey: "", chat: () => { throw new Error("model down"); } } as never).get(WORLD);
      const res = await handleWorldCommand(runtime, { input: "кто переводит лодку?", idempotencyKey: "p2-http" });
      const body = JSON.parse(res.body);
      expect(res.statusCode).toBe(200);
      expect(body.replayed).toBe(true);
      // The turn's own kind survives recovery; only clarification turns map to
      // contextual_clarification.
      expect(body.masterTurn?.kind).toBe("inquiry_answer");
      expect(store.listConversationTurns(WORLD)).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
