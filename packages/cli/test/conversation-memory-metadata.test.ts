import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultiWorldStore, DuplicateRequestError } from "../src/persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "../src/persistence/types.js";
import { buildReadSideConversationTurn, buildTurnMemoryMetadata, toConversationTurnDTO } from "../src/conversation/builder.js";
import {
  parseConversationMemoryMetadata,
  serializeConversationMemoryMetadata,
  type ConversationMemoryMetadataV1,
} from "../src/conversation/types.js";

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "skald-memory-meta-"));
  return join(dir, "events.sqlite");
}

function fullMetadata(): ConversationMemoryMetadataV1 {
  return {
    schemaVersion: 1,
    mentions: [
      { kind: "person", role: "target", label: "перевозчик" },
      { kind: "route", role: "destination", label: "тропа вдоль реки" },
    ],
    goal: { summary: "Найти старое русло" },
    clarification: {
      question: "С перевозчиком или со стражем?",
      options: [
        { optionId: "carrier", label: "С перевозчиком" },
        { optionId: "guard", label: "Со стражем" },
      ],
    },
    continuation: { relation: "continues", clarificationTurnSeq: 3 },
    dramaticThread: { source: "player_goal", title: "Найти старое русло" },
  };
}

describe("conversation memory metadata", () => {
  it("parses a full metadata object and rejects malformed shapes fail-closed", () => {
    expect(parseConversationMemoryMetadata(fullMetadata())).toEqual(fullMetadata());
    expect(parseConversationMemoryMetadata(JSON.stringify(fullMetadata()))).toEqual(fullMetadata());
    expect(parseConversationMemoryMetadata(null)).toBeNull();
    expect(parseConversationMemoryMetadata(undefined)).toBeNull();
    expect(parseConversationMemoryMetadata("")).toBeNull();
    expect(parseConversationMemoryMetadata("not-json{")).toBeNull();
    expect(parseConversationMemoryMetadata([])).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 2 })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, prompt: "x" })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, mentions: [{ kind: "spell", role: "target", label: "x" }] })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, mentions: [{ kind: "person", role: "target", label: "" }] })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, mentions: [{ kind: "person", role: "target", label: "x".repeat(121) }] })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, goal: { summary: "" } })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, clarification: { question: "q?", options: [] } })).toEqual({
      schemaVersion: 1,
      clarification: { question: "q?", options: [] },
    });
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, clarification: { question: "q?" } })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, continuation: { relation: "maybe" } })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, continuation: { relation: "cancels", clarificationTurnSeq: -1 } })).toBeNull();
    expect(parseConversationMemoryMetadata({ schemaVersion: 1, dramaticThread: { source: "quest", title: "t" } })).toBeNull();
  });

  it("serializes with budget caps and round-trips through the parser", () => {
    expect(serializeConversationMemoryMetadata(null)).toBeNull();
    expect(serializeConversationMemoryMetadata(undefined)).toBeNull();
    const capped = serializeConversationMemoryMetadata({
      schemaVersion: 1,
      mentions: [
        { kind: "person", role: "target", label: "y".repeat(200) },
        { kind: "object", role: "instrument", label: "ok" },
      ],
      goal: { summary: "g".repeat(300) },
      clarification: {
        question: "q".repeat(600),
        options: Array.from({ length: 10 }, (_, i) => ({ optionId: `o-${i}`, label: "l" })),
      },
    });
    expect(capped).not.toBeNull();
    const parsed = parseConversationMemoryMetadata(capped!);
    expect(parsed?.mentions).toHaveLength(2);
    expect(parsed?.mentions?.[0]?.label).toHaveLength(120);
    expect(parsed?.goal?.summary).toHaveLength(140);
    expect(parsed?.clarification?.question).toHaveLength(500);
    expect(parsed?.clarification?.options).toHaveLength(6);
  });

  it("round-trips metadata through the store and keeps legacy rows NULL", () => {
    const store = createMultiWorldStore(tmpDb());
    const withMeta = store.recordConversationTurn(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "meta-1",
      playerText: "Поговорю с ним.",
      inputClass: "clarification",
      responseKind: "clarification",
      responseText: "С кем именно?",
      worldTime: 4,
      contextMetadata: fullMetadata(),
    }));
    expect(withMeta.contextMetadata).toEqual(fullMetadata());
    const legacy = store.recordConversationTurn(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "legacy-1",
      playerText: "Жду.",
      inputClass: "inquiry",
      responseKind: "inquiry_answer",
      responseText: "Тихо.",
      worldTime: 4,
    }));
    expect(legacy.contextMetadata).toBeNull();
    store.close();
  });

  it("ignores corrupt column JSON fail-closed on read", () => {
    const db = tmpDb();
    const store = createMultiWorldStore(db);
    store.recordConversationTurn(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "corrupt-1",
      playerText: "Иду.",
      inputClass: "inquiry",
      responseKind: "inquiry_answer",
      responseText: "Куда?",
      worldTime: 1,
      contextMetadata: { schemaVersion: 1, goal: { summary: "Дойти" } },
    }));
    store.close();

    const require = createRequire(import.meta.url);
    const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => {
      exec(sql: string): unknown;
      close(): void;
    } }).DatabaseSync;
    const raw = new DatabaseSync(db);
    raw.exec(`UPDATE conversation_turns SET conversation_context_json = '{broken' WHERE idempotency_key = 'corrupt-1'`);
    raw.close();

    const reopened = createMultiWorldStore(db);
    expect(reopened.getConversationTurn(LEGACY_WORLD_ID, "corrupt-1")?.contextMetadata).toBeNull();
    reopened.close();
  });

  it("never exposes metadata or requestHash in the player-facing DTO", () => {
    const store = createMultiWorldStore(tmpDb());
    const recorded = store.recordConversationTurn(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "dto-1",
      playerText: "Спрошу его.",
      inputClass: "clarification",
      responseKind: "clarification",
      responseText: "О чём?",
      worldTime: 2,
      contextMetadata: fullMetadata(),
    }));
    const dto = toConversationTurnDTO(recorded);
    expect(dto).not.toHaveProperty("requestHash");
    expect(dto).not.toHaveProperty("contextMetadata");
    expect(JSON.stringify(dto)).not.toContain("перевозчик");
    store.close();
  });

  it("migrates a v11 database to v12 preserving rows with NULL metadata", () => {
    const db = tmpDb();
    const seed = createMultiWorldStore(db);
    seed.recordConversationTurn(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "v11-1",
      playerText: "Осматриваюсь.",
      inputClass: "clarification",
      responseKind: "clarification",
      responseText: "Что именно?",
      worldTime: 0,
      contextMetadata: { schemaVersion: 1, mentions: [{ kind: "object", role: "target", label: "двор" }] },
    }));
    seed.close();

    const require = createRequire(import.meta.url);
    const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => {
      exec(sql: string): unknown;
      close(): void;
    } }).DatabaseSync;
    const raw = new DatabaseSync(db);
    raw.exec(`CREATE TABLE conversation_turns_v11 (
      turn_seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id        TEXT NOT NULL,
      correlation_id  TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash    TEXT NOT NULL,
      player_text     TEXT NOT NULL,
      input_class     TEXT NOT NULL
          CHECK (input_class IN ('action', 'inquiry', 'speech', 'mixed', 'meta', 'clarification')),
      world_time_before INTEGER NOT NULL,
      world_time_after  INTEGER NOT NULL,
      response_kind   TEXT NOT NULL
          CHECK (response_kind IN ('action_outcome', 'action_rejection', 'inquiry_answer', 'speech_reaction', 'mixed_outcome', 'meta_answer', 'clarification')),
      response_text   TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (world_id) REFERENCES worlds(world_id),
      UNIQUE (world_id, idempotency_key)
    ) STRICT`);
    raw.exec(`INSERT INTO conversation_turns_v11 (turn_seq, world_id, correlation_id, idempotency_key, request_hash, player_text, input_class, world_time_before, world_time_after, response_kind, response_text, created_at)
      SELECT turn_seq, world_id, correlation_id, idempotency_key, request_hash, player_text, input_class, world_time_before, world_time_after, response_kind, response_text, created_at FROM conversation_turns`);
    raw.exec("DROP TABLE conversation_turns");
    raw.exec("ALTER TABLE conversation_turns_v11 RENAME TO conversation_turns");
    raw.exec("PRAGMA user_version = 11");
    raw.close();

    const store = createMultiWorldStore(db);
    const rows = store.listConversationTurns(LEGACY_WORLD_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerText).toBe("Осматриваюсь.");
    expect(rows[0]?.contextMetadata).toBeNull();
    const next = store.recordConversationTurn(buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "v12-1",
      playerText: "Иду.",
      inputClass: "inquiry",
      responseKind: "inquiry_answer",
      responseText: "Куда?",
      worldTime: 1,
      contextMetadata: { schemaVersion: 1, goal: { summary: "Дойти" } },
    }));
    expect(next.turnSeq).toBe(2);
    expect(next.contextMetadata).toEqual({ schemaVersion: 1, goal: { summary: "Дойти" } });
    store.close();
  });

  it("assembles turn memory from validated focus, goal and relation", () => {
    expect(buildTurnMemoryMetadata({})).toBeNull();
    expect(buildTurnMemoryMetadata({ focus: [], goal: null, relation: null })).toBeNull();
    expect(buildTurnMemoryMetadata({
      focus: [
        { observerRef: "person_1", surface: "перевозчик", kind: "addressee" },
        { observerRef: null, surface: "куда-то", kind: "destination" },
        { observerRef: null, surface: "что-то", kind: "target" },
        { observerRef: "object_9", surface: "", kind: "target" },
      ],
      goal: "  Найти русло  ",
      relation: "continuation",
      pendingClarificationSeq: 4,
    })).toEqual({
      schemaVersion: 1,
      mentions: [
        { kind: "person", role: "addressee", label: "перевозчик" },
        { kind: "route", role: "destination", label: "куда-то" },
      ],
      goal: { summary: "Найти русло" },
      continuation: { relation: "continues", clarificationTurnSeq: 4 },
      dramaticThread: { source: "player_goal", title: "Найти русло" },
    });
    expect(buildTurnMemoryMetadata({ relation: "cancel_pending", pendingClarificationSeq: null })).toEqual({
      schemaVersion: 1,
      continuation: { relation: "cancels" },
    });
    expect(buildTurnMemoryMetadata({
      clarification: { question: "Кто?", options: [{ optionId: "rephrase", label: "Уточнить" }] },
    })).toEqual({
      schemaVersion: 1,
      clarification: { question: "Кто?", options: [{ optionId: "rephrase", label: "Уточнить" }] },
    });
  });

  it("commits events and metadata atomically and replays idempotent keys", () => {
    const store = createMultiWorldStore(tmpDb());
    const turn = buildReadSideConversationTurn({
      worldId: LEGACY_WORLD_ID,
      idempotencyKey: "atomic-1",
      playerText: "Жду.",
      inputClass: "inquiry",
      responseKind: "inquiry_answer",
      responseText: "Тихо.",
      worldTime: 0,
      contextMetadata: { schemaVersion: 1, goal: { summary: "Переждать" } },
    });
    store.commitBatch(LEGACY_WORLD_ID, [], {
      idempotencyKey: "atomic-1",
      requestKind: "command",
      correlationId: "conversation:atomic-1",
      conversationTurn: turn,
    });
    expect(store.getConversationTurn(LEGACY_WORLD_ID, "atomic-1")?.contextMetadata).toEqual({
      schemaVersion: 1,
      goal: { summary: "Переждать" },
    });
    const replay = store.recordConversationTurn(turn);
    expect(replay.contextMetadata).toEqual({ schemaVersion: 1, goal: { summary: "Переждать" } });
    expect(() => store.recordConversationTurn({ ...turn, playerText: "Другое.", requestHash: "hash:other" })).toThrow(DuplicateRequestError);
    store.close();
  });
});
