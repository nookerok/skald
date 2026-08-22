import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultiWorldStore, DuplicateRequestError } from "../src/persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";
import type { ConversationTurnDraft } from "../src/conversation/types.js";

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "skald-conversation-"));
  return join(dir, "events.sqlite");
}

function draft(key: string, text = key, time = 0): ConversationTurnDraft {
  return {
    worldId: LEGACY_WORLD_ID,
    correlationId: `conversation:${key}`,
    idempotencyKey: key,
    requestHash: `hash:${text}`,
    playerText: text,
    inputClass: "inquiry",
    worldTimeBefore: time,
    worldTimeAfter: time,
    responseKind: "inquiry_answer",
    responseText: `answer:${text}`,
  };
}

describe("conversation turn persistence", () => {
  it("creates schema v9 and records a round-trip without backfilling events", () => {
    const db = tmpDb();
    const store = createMultiWorldStore(db);
    expect(store.listConversationTurns(LEGACY_WORLD_ID)).toEqual([]);
    const first = store.recordConversationTurn(draft("k-1", "где я?"));
    expect(first).toEqual(expect.objectContaining({ turnSeq: 1, playerText: "где я?", createdAt: expect.any(Number) }));
    expect(first.requestHash).toBe("hash:где я?");
    store.close();

    const reopened = createMultiWorldStore(db);
    expect(reopened.listConversationTurns(LEGACY_WORLD_ID)).toHaveLength(1);
    expect(reopened.getConversationTurn(LEGACY_WORLD_ID, "k-1")?.createdAt).toBe(first.createdAt);
    reopened.close();
  });

  it("migrates a v8 database to v9 without creating transcript rows", () => {
    const db = tmpDb();
    const store = createMultiWorldStore(db);
    store.close();
    const require = createRequire(import.meta.url);
    const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void } }).DatabaseSync;
    const raw = new DatabaseSync(db);
    raw.exec("DROP TABLE conversation_turns");
    raw.exec("PRAGMA user_version = 8");
    raw.close();

    const migrated = createMultiWorldStore(db);
    expect(migrated.listConversationTurns(LEGACY_WORLD_ID)).toEqual([]);
    migrated.close();
  });

  it("replays the same key, rejects a conflicting text, and orders by turn_seq", () => {
    const store = createMultiWorldStore(tmpDb());
    const first = store.recordConversationTurn(draft("k-1", "first"));
    const replay = store.recordConversationTurn(draft("k-1", "first"));
    expect(replay.turnSeq).toBe(first.turnSeq);
    expect(replay.createdAt).toBe(first.createdAt);
    expect(() => store.recordConversationTurn(draft("k-1", "different"))).toThrow(DuplicateRequestError);

    const second = store.recordConversationTurn(draft("k-2", "second"));
    const rows = store.listConversationTurns(LEGACY_WORLD_ID);
    expect(rows.map((row) => row.turnSeq)).toEqual([first.turnSeq, second.turnSeq]);
    expect(store.getConversationTurnBySeq(LEGACY_WORLD_ID, second.turnSeq)?.playerText).toBe("second");
    store.close();
  });
});
