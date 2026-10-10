/**
 * Pure-conversation persistence (Conversation Director P2 / S1): a turn with
 * ZERO world events must be saved exactly once, must not move world time, and a
 * retry (including the crash window before the HTTP envelope is written) must
 * not duplicate the turn.
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
import { buildReadSideConversationTurn } from "../src/conversation/builder.js";
import { DuplicateRequestError } from "../src/persistence/sqlite-store.js";

function freshStore() {
  const db = join(mkdtempSync(join(tmpdir(), "skald-p2-")), "events.sqlite");
  const store = createMultiWorldStore(db);
  const worldId = "p2-world";
  const bootstrap = buildBootstrapEvents("living_region");
  store.createWorld({
    worldId, idempotencyKey: `c-${worldId}`, requestHash: `h-${worldId}`, saveLabel: "P2",
    characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
    characterWound: "none", characterPromise: "observe", characterPrinciple: "care",
    characterProfileVersion: 1, bootstrapEvents: bootstrap,
  });
  return { store, worldId, db, bootstrap };
}

const draft = (idempotencyKey: string, playerText: string, worldTime = 0) =>
  buildReadSideConversationTurn({
    worldId: "p2-world",
    idempotencyKey,
    playerText,
    inputClass: "clarification",
    responseKind: "clarification",
    responseText: "Что именно ты хочешь спросить?",
    worldTime,
  });

describe("pure conversation turn persistence (P2)", () => {
  it("saves a zero-event turn exactly once and never moves world time", () => {
    const { store, worldId, bootstrap } = freshStore();
    try {
      const before = store.listConversationTurns(worldId).length;
      const record = store.recordConversationTurn(draft("p2-1", "спроси меня ещё раз"));
      expect(record.turnSeq).toBeGreaterThan(0);

      // Zero world events, zero time: a pure conversation changes nothing.
      const events = store.loadEvents(worldId);
      expect(events.length).toBe(bootstrap.length);
      const world = rebuildProjection(events).getSnapshot();
      expect(world.time).toBe(rebuildProjection(bootstrap).getSnapshot().time);

      // Retry with the same key + same hash returns the ORIGINAL turn.
      const again = store.recordConversationTurn(draft("p2-1", "спроси меня ещё раз"));
      expect(again.turnSeq).toBe(record.turnSeq);
      expect(store.listConversationTurns(worldId).length).toBe(before + 1);
    } finally {
      store.close();
    }
  });

  it("rejects a conflicting retry under the same key", () => {
    const { store, worldId } = freshStore();
    try {
      store.recordConversationTurn(draft("p2-2", "первый"));
      // Same key + different text (different requestHash) must be refused,
      // and the record count must not grow.
      const conflicting = buildReadSideConversationTurn({
        worldId, idempotencyKey: "p2-2", playerText: "совсем другое",
        inputClass: "clarification", responseKind: "clarification",
        responseText: "x", worldTime: 0,
      });
      expect(() => store.recordConversationTurn(conflicting)).toThrow(DuplicateRequestError);
      expect(store.listConversationTurns(worldId).length).toBe(1);
    } finally {
      store.close();
    }
  });

  it("recovers the original turn after a crash before the HTTP envelope (replay window)", () => {
    const { store, worldId, db } = freshStore();
    try {
      // Crash window: the turn is durable, the replay envelope is NOT written.
      store.recordConversationTurn(draft("p2-3", "чистая беседа"));
      store.close();

      // Retry reopens the store: the turn must still be there, once.
      const reopened = createMultiWorldStore(db);
      try {
        const replay = reopened.getConversationTurnReplay(worldId, "p2-3");
        expect(replay).not.toBeNull();
        expect(replay!.turn.playerText).toBe("чистая беседа");
        expect(reopened.listConversationTurns(worldId)).toHaveLength(1);

        // Re-issuing the same turn does not add a second record.
        reopened.recordConversationTurn(draft("p2-3", "чистая беседа"));
        expect(reopened.listConversationTurns(worldId)).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      try { store.close(); } catch { /* already closed */ }
    }
  });
});
