import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { bootstrapWorldEvents, attachTurnNarrations, buildTurnJournal, narrationKey } from "@skald/world";
import type { TurnNarration } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createMultiWorldStore } from "../src/persistence/index.js";
import { execSchemaV9 } from "../src/persistence/schema.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { NarrationScheduler } from "../src/runtime/narration-scheduler.js";
import { handleWorldJournal } from "../src/http/world-handlers.js";
import { narrationHandle, readSideHandle } from "../src/conversation/identity.js";
import { toConversationTurnDTO } from "../src/conversation/builder.js";

const require = createRequire(import.meta.url);
const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => any }).DatabaseSync;
const path = () => join(mkdtempSync(join(tmpdir(), "skald-turn-identity-")), "events.sqlite");
const prose = (text: string): TurnNarration => ({ text, model: "test", usedFallback: false, fallbackReason: null, latencyMs: 1 });
const event = (id: string, correlationId: string): DomainEvent => ({
  eventId: id, type: "ObservationUpdated", schemaVersion: 1, payload: { key: "risk_taken" },
  timestamp: 1, causationId: null, correlationId,
});
function seed(store: ReturnType<typeof createMultiWorldStore>) {
  store.createWorld({
    worldId: "identity-world", idempotencyKey: "create", requestHash: "create-hash",
    saveLabel: "Проверка", characterName: "Виктор", characterPresetId: "keeper",
    worldTemplateId: "legacy", characterWound: "", characterPromise: "", characterPrinciple: "",
    characterProfileVersion: 1, bootstrapEvents: bootstrapWorldEvents(),
  });
}

describe("correlated narration lifecycle", () => {
  it("keeps equal-time rows separate across reopen and idempotent updates", () => {
    const dbPath = path();
    let store = createMultiWorldStore(dbPath);
    seed(store);
    store.saveTurnNarration("identity-world", 1, prose("Первый ответ."), "command:a");
    store.saveTurnNarration("identity-world", 1, prose("Второй ответ."), "command:b");
    store.saveTurnNarration("identity-world", 1, prose("Уточнённый первый ответ."), "command:a");
    store.close();
    store = createMultiWorldStore(dbPath);
    try {
      const rows = store.getTurnNarrations("identity-world");
      expect(rows.size).toBe(2);
      expect(rows.get(narrationKey(1, "command:a"))?.text).toBe("Уточнённый первый ответ.");
      expect(rows.get(narrationKey(1, "command:b"))?.text).toBe("Второй ответ.");
      expect(rows.has(1)).toBe(false);
    } finally { store.close(); }
  });

  it("migrates real v9 narration without guessing correlation or changing events", () => {
    const dbPath = path();
    const db = new DatabaseSync(dbPath);
    execSchemaV9(db);
    db.exec("INSERT INTO worlds (world_id, save_label, template_id, status, created_at) VALUES ('old', 'История', 'legacy', 'active', 0)");
    const boot = bootstrapWorldEvents()[0]!;
    db.prepare("INSERT INTO events (world_id,event_id,type,schema_version,payload_json,timestamp,causation_id,correlation_id) VALUES (?,?,?,?,?,?,?,?)")
      .run("old", boot.eventId, boot.type, boot.schemaVersion, JSON.stringify(boot.payload), boot.timestamp, boot.causationId, boot.correlationId);
    db.exec("INSERT INTO turn_narrations VALUES ('old', 1, 'Старый ответ.', 'old-provider', 0, 12)");
    const before = db.prepare("SELECT * FROM events ORDER BY seq").all();
    db.close();
    const store = createMultiWorldStore(dbPath);
    expect(store.getTurnNarrations("old").get(1)?.text).toBe("Старый ответ.");
    store.saveTurnNarration("old", 1, prose("Новый ответ."), "new");
    expect(store.getTurnNarrations("old").size).toBe(2);
    store.close();
    const check = new DatabaseSync(dbPath);
    try {
      expect(check.prepare("PRAGMA user_version").get()).toEqual({ user_version: 11 });
      expect(check.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(check.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(check.prepare("SELECT * FROM events ORDER BY seq").all()).toEqual(before);
      expect(check.prepare("SELECT correlation_id FROM turn_narrations WHERE text = 'Старый ответ.'").get()).toEqual({ correlation_id: "" });
    } finally { check.close(); }
  });

  it("does not let completion of one equal-time job settle another", async () => {
    const scheduler = new NarrationScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    scheduler.schedule({ worldTime: 1, correlationId: "a", priority: "interactive", run: () => gate, onDrop: () => {} });
    scheduler.schedule({ worldTime: 1, correlationId: "b", priority: "interactive", run: async () => scheduler.markUnavailable(1, "b"), onDrop: () => {} });
    scheduler.markReady(1, "a");
    expect(scheduler.statusOf(1, "a")).toBeUndefined();
    expect(scheduler.statusOf(1, "b")).toBe("pending");
    release();
    while (scheduler.isRunning()) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduler.statusOf(1, "b")).toBe("unavailable");
    expect(scheduler.statusOf(1, "a")).toBeUndefined();
  });

  it("attaches exact prose and never guesses a legacy row on a one-item page", () => {
    const journal = buildTurnJournal([event("first", "a"), event("second", "b")]);
    expect(journal.turns).toHaveLength(2);
    expect(new Set(journal.turns.map((turn) => turn.turnId)).size).toBe(2);
    const legacy = new Map([[1, prose("Неизвестная принадлежность.")]]);
    expect(attachTurnNarrations(journal.turns.slice(0, 1), legacy, journal.turns)[0]?.narrativeLLM).toBeUndefined();
    const exact = new Map([
      [narrationKey(1, "a"), prose("Первый.")], [narrationKey(1, "b"), prose("Второй.")],
    ]);
    expect(attachTurnNarrations(journal.turns, exact).map((turn) => turn.narrativeLLM?.text)).toEqual(["Первый.", "Второй."]);
    expect(buildTurnJournal([event("first", "a"), event("second", "b"), { ...event("third", "c"), timestamp: 2 }]).turns.slice(0, 2)).toEqual(journal.turns);
  });

  it("serves both equal-time HTTP pages with stable opaque handles after reload", async () => {
    const dbPath = path();
    const store = createMultiWorldStore(dbPath);
    seed(store);
    store.commitBatch("identity-world", [event("event:secret-first", "command:a"), event("event:secret-second", "command:b")]);
    store.saveTurnNarration("identity-world", 1, prose("Первый."), "command:a");
    store.saveTurnNarration("identity-world", 1, prose("Второй."), "command:b");
    const runtime = await new WorldRuntimeManager(store, null).get("identity-world");
    const get = (query: string) => handleWorldJournal(runtime, new URL("http://test/journal?" + query));
    const first = JSON.parse(get("limit=1").body);
    expect(first.turns[0].narrativeLLM.text).toBe("Второй.");
    expect(first.nextBeforeTurn).toMatch(/^[a-f0-9]{64}$/);
    const second = JSON.parse(get("limit=1&beforeTurn=" + first.nextBeforeTurn).body);
    expect(second.turns[0].worldTime).toBe(first.turns[0].worldTime);
    expect(second.turns[0].narrativeLLM.text).toBe("Первый.");
    expect(second.hasMore).toBe(false);
    expect(second.turns[0].turnHandle).not.toBe(first.turns[0].turnHandle);
    expect(second.turns[0].narrationHandle).toBe(narrationHandle(1, "command:a"));
    expect(first.threads[0].entries.map((entry: any) => entry.turnHandle)).toEqual([second.turns[0].turnHandle, first.turns[0].turnHandle]);
    expect(JSON.stringify(first)).not.toMatch(/event:secret|command:|sourceEventIds|epistemicClass/);
    expect(get("beforeTurn=event:secret-first").statusCode).toBe(400);
    expect(get("beforeTurn=" + "0".repeat(64)).statusCode).toBe(400);
    expect(get("before=1&beforeTurn=" + first.nextBeforeTurn).statusCode).toBe(400);
    store.close();
    const reopened = createMultiWorldStore(dbPath);
    try {
      const loaded = await new WorldRuntimeManager(reopened, null).get("identity-world");
      expect(JSON.parse(handleWorldJournal(loaded, new URL("http://test/journal?limit=1")).body)).toEqual(first);
    } finally { reopened.close(); }
  });

  it("uses the same opaque handle in transcript, without exposing requestHash", () => {
    const dto = toConversationTurnDTO({
      turnSeq: 1, worldId: "w", correlationId: "event:secret", idempotencyKey: "request",
      requestHash: "private", playerText: "Осматриваюсь", inputClass: "action",
      worldTimeBefore: 0, worldTimeAfter: 1, responseKind: "action_outcome", responseText: "Ты осматриваешься.", createdAt: 2,
    });
    expect(dto.narrationHandle).toBe(narrationHandle(1, "event:secret"));
    expect(dto.narrationHandle).toMatch(/^[a-f0-9]{64}$/);
    expect(dto).not.toHaveProperty("requestHash");
    expect(readSideHandle("turn", "x")).not.toBe(readSideHandle("thread", "x"));
    expect(narrationHandle(1, "a")).not.toBe(narrationHandle(1, "b"));
    expect(narrationHandle(1, "a")).not.toBe(narrationHandle(2, "a"));
  });

  it("sanitizes transcript response prose at the player boundary", () => {
    const dto = toConversationTurnDTO({
      turnSeq: 2, worldId: "w", correlationId: "event:secret", idempotencyKey: "request-2",
      requestHash: "private", playerText: "осмотрись", inputClass: "action",
      worldTimeBefore: 1, worldTimeAfter: 2, responseKind: "action_outcome",
      responseText: "event:secret item:unknown", createdAt: 3,
    });
    expect(dto.responseText).toBe("Подробности пока неясны.");
    expect(dto).not.toHaveProperty("requestHash");
    expect(JSON.stringify(dto)).not.toMatch(/item:unknown/);
  });
});
