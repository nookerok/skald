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

  it("migrates a v10 database to v11 preserving rows and widening turn classes", () => {
    const db = tmpDb();
    const seed = createMultiWorldStore(db);
    seed.recordConversationTurn({ ...draft("k-1", "осматриваюсь", 0), inputClass: "action", responseKind: "action_outcome", responseText: "Вижу двор." });
    seed.recordConversationTurn({ ...draft("k-2", "где я?", 1), inputClass: "inquiry", responseKind: "inquiry_answer", responseText: "У реки." });
    seed.recordConversationTurn({ ...draft("k-3", "сделай то", 1), inputClass: "clarification", responseKind: "clarification", responseText: "Что именно?" });
    seed.close();

    const require = createRequire(import.meta.url);
    const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      close(): void;
    } }).DatabaseSync;
    const raw = new DatabaseSync(db);
    raw.exec(`CREATE TABLE conversation_turns_v10 (
      turn_seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id        TEXT NOT NULL,
      correlation_id  TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash    TEXT NOT NULL,
      player_text     TEXT NOT NULL,
      input_class     TEXT NOT NULL
          CHECK (input_class IN ('action', 'inquiry', 'clarification')),
      world_time_before INTEGER NOT NULL,
      world_time_after  INTEGER NOT NULL,
      response_kind   TEXT NOT NULL
          CHECK (response_kind IN ('action_outcome', 'action_rejection', 'inquiry_answer', 'clarification')),
      response_text   TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (world_id) REFERENCES worlds(world_id),
      UNIQUE (world_id, idempotency_key)
    ) STRICT`);
    raw.exec(`INSERT INTO conversation_turns_v10 (turn_seq, world_id, correlation_id, idempotency_key, request_hash, player_text, input_class, world_time_before, world_time_after, response_kind, response_text, created_at)
      SELECT turn_seq, world_id, correlation_id, idempotency_key, request_hash, player_text, input_class, world_time_before, world_time_after, response_kind, response_text, created_at FROM conversation_turns`);
    raw.exec("DROP TABLE conversation_turns");
    raw.exec("ALTER TABLE conversation_turns_v10 RENAME TO conversation_turns");
    raw.exec("PRAGMA user_version = 10");
    raw.close();

    const store = createMultiWorldStore(db);
    const rows = store.listConversationTurns(LEGACY_WORLD_ID);
    expect(rows.map((row) => [row.turnSeq, row.inputClass, row.responseKind, row.playerText])).toEqual([
      [1, "action", "action_outcome", "осматриваюсь"],
      [2, "inquiry", "inquiry_answer", "где я?"],
      [3, "clarification", "clarification", "сделай то"],
    ]);

    const mixed = store.recordConversationTurn({ ...draft("k-4", "подхожу и смотрю"), inputClass: "mixed", responseKind: "mixed_outcome", responseText: "Подошёл. Вижу двор." });
    expect(mixed.turnSeq).toBe(4);
    const speech = store.recordConversationTurn({ ...draft("k-5", "прошу"), inputClass: "speech", responseKind: "speech_reaction", responseText: "Кивает." });
    expect(speech.turnSeq).toBe(5);
    const meta = store.recordConversationTurn({ ...draft("k-6", "справка"), inputClass: "meta", responseKind: "meta_answer", responseText: "Действия: осмотрись." });
    expect(meta.turnSeq).toBe(6);
    expect(() => store.recordConversationTurn({ ...draft("k-7", "заклинание"), inputClass: "spell" as "action", responseText: "x" })).toThrow();
    store.close();

    const reopened = createMultiWorldStore(db);
    expect(reopened.listConversationTurns(LEGACY_WORLD_ID)).toHaveLength(6);
    reopened.close();
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
