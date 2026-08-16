import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createMultiWorldStore } from "../src/persistence/index.js";
import { shouldPersistNarration } from "../src/http/world-handlers.js";
import { NarrationScheduler, resolveNarrationState } from "../src/runtime/narration-scheduler.js";
import type { TurnNarration } from "@skald/world";
import { bootstrapWorldEvents } from "@skald/world";

const require = createRequire(import.meta.url);
const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => any }).DatabaseSync;

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "skald-narrations-"));
  return join(dir, "events.sqlite");
}

async function createWorld(store: ReturnType<typeof createMultiWorldStore>, worldId: string): Promise<void> {
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: "Test",
    characterName: "Narr",
    characterPresetId: "p1",
    worldTemplateId: "legacy",
    characterWound: "wound",
    characterPromise: "promise",
    characterPrinciple: "principle",
    characterProfileVersion: 1,
    bootstrapEvents: bootstrapWorldEvents(),
  });
}

describe("shouldPersistNarration (P2: empty LLM reply is terminal failure)", () => {
  it("persists only a non-fallback non-empty narration", () => {
    expect(shouldPersistNarration({ usedFallback: false, text: "Ветер стих." })).toBe(true);
  });

  it("rejects an empty successful response that would otherwise look ready", () => {
    expect(shouldPersistNarration({ usedFallback: false, text: "" })).toBe(false);
    expect(shouldPersistNarration({ usedFallback: false, text: "   " })).toBe(false);
  });

  it("rejects fallback narrations (templates / no-key repeats)", () => {
    expect(shouldPersistNarration({ usedFallback: true, text: "Мир продолжал дышать." })).toBe(false);
    expect(shouldPersistNarration({ usedFallback: true, text: "" })).toBe(false);
  });
});

describe("empty successful reply recomposes as unavailable, never not_requested", () => {
  // Mirrors the handler settle rule: empty text -> no persist + markUnavailable,
  // and the journal's resolveNarrationState must therefore report `unavailable`
  // so the browser polling keeps its terminal state instead of stopping as if
  // the narration had never been requested.
  it("empty text keeps the scheduler terminal and the journal reports unavailable", () => {
    const scheduler = new NarrationScheduler();
    const empty = { usedFallback: false, text: "   " };

    if (!shouldPersistNarration(empty)) scheduler.markUnavailable(42);

    expect(scheduler.statusOf(42)).toBe("unavailable");
    expect(resolveNarrationState({ hasNonFallback: false }, scheduler.statusOf(42))).toBe("unavailable");
    expect(resolveNarrationState({ hasNonFallback: false }, scheduler.statusOf(42))).not.toBe("not_requested");
  });

  it("a persisted narration recomposes as ready", () => {
    const scheduler = new NarrationScheduler();
    scheduler.schedule({ priority: "interactive", worldTime: 7, run: async () => {}, onDrop: () => {} });
    scheduler.markReady(7);
    expect(resolveNarrationState({ hasNonFallback: true }, scheduler.statusOf(7))).toBe("ready");
  });
});

describe("turn narrations persistence (v5)", () => {
  it("round-trips saved narrations keyed by worldTime", async () => {
    const dbPath = tmpDb();
    const store = createMultiWorldStore(dbPath);
    await createWorld(store, "w1");

    const narration: TurnNarration = {
      text: "Дерзкий шаг взбудоражил лес.",
      model: "deepseek-v4-flash-free",
      usedFallback: false,
      fallbackReason: null,
      latencyMs: 120,
    };
    store.saveTurnNarration("w1", 5, narration);

    const narrations = store.getTurnNarrations("w1");
    expect(narrations.size).toBe(1);
    const round = narrations.get(5)!;
    expect(round.text).toBe("Дерзкий шаг взбудоражил лес.");
    expect(round.usedFallback).toBe(false);
    expect(round.model).toBe("deepseek-v4-flash-free");
    expect(round.latencyMs).toBe(120);

    // second save for the same turn is idempotent (single row)
    store.saveTurnNarration("w1", 5, { ...narration, text: "Снова." });
    expect(store.getTurnNarrations("w1").size).toBe(1);

    // other worlds are isolated
    expect(store.getTurnNarrations("other-world-xx").size).toBe(0);
    store.close();
  });

  it("does not surface a fallback narration (usedFallback row stored, filtered read-side)", async () => {
    const dbPath = tmpDb();
    const store = createMultiWorldStore(dbPath);
    await createWorld(store, "w1");
    store.saveTurnNarration("w1", 9, {
      text: "шаблон",
      model: "",
      usedFallback: true,
      fallbackReason: "no_api_key",
      latencyMs: 0,
    });
    // Persisted yes, but consumers must filter usedFallback before surfacing.
    expect(store.getTurnNarrations("w1").get(9)!.usedFallback).toBe(true);
    store.close();
  });

  it("a later successful narration overwrites an earlier stored fallback row", async () => {
    const dbPath = tmpDb();
    const store = createMultiWorldStore(dbPath);
    await createWorld(store, "w1");

    // Legacy/transient fallback persisted for the turn first (P2 regression).
    store.saveTurnNarration("w1", 7, {
      text: "шаблон",
      model: "",
      usedFallback: true,
      fallbackReason: "chat_error",
      latencyMs: 0,
    });
    expect(store.getTurnNarrations("w1").get(7)!.usedFallback).toBe(true);

    // A later real generation must replace the fallback, not be INSERT IGNORED.
    store.saveTurnNarration("w1", 7, {
      text: "Ветер рассыпал искры по ночному лесу.",
      model: "deepseek-v4-flash-free",
      usedFallback: false,
      fallbackReason: null,
      latencyMs: 900,
    });
    const replacement = store.getTurnNarrations("w1").get(7)!;
    expect(replacement.usedFallback).toBe(false);
    expect(replacement.text).toBe("Ветер рассыпал искры по ночному лесу.");
    expect(replacement.model).toBe("deepseek-v4-flash-free");
    expect(store.getTurnNarrations("w1").size).toBe(1);
    store.close();
  });

  it("opens a real v4 database and migrates to v5 additively with integrity ok", () => {
    const dbPath = tmpDb();
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA user_version = 4");
    db.exec(`CREATE TABLE character_profiles (character_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, wound TEXT NOT NULL, promise TEXT NOT NULL, principle TEXT NOT NULL, profile_version INTEGER NOT NULL, created_at INTEGER NOT NULL) STRICT`);
    db.exec(`CREATE TABLE worlds (world_id TEXT PRIMARY KEY, save_label TEXT NOT NULL, template_id TEXT NOT NULL, character_id TEXT, character_name_snapshot TEXT, status TEXT NOT NULL CHECK (status IN ('active','archived','corrupt')), created_at INTEGER NOT NULL, last_played_at INTEGER) STRICT`);
    db.exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, event_id TEXT NOT NULL, type TEXT NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, timestamp INTEGER NOT NULL, causation_id TEXT, correlation_id TEXT, FOREIGN KEY (world_id) REFERENCES worlds(world_id), UNIQUE (world_id, event_id)) STRICT`);
    db.exec(`CREATE TABLE processed_requests (world_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_kind TEXT NOT NULL, correlation_id TEXT NOT NULL, FOREIGN KEY (world_id) REFERENCES worlds(world_id), PRIMARY KEY (world_id, idempotency_key)) STRICT`);
    db.exec(`CREATE TABLE observer_checkpoints (world_id TEXT NOT NULL, observer_id TEXT NOT NULL, last_presence_world_time INTEGER NOT NULL, last_presence_event_number INTEGER NOT NULL, belief_revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (world_id) REFERENCES worlds(world_id), PRIMARY KEY (world_id, observer_id)) STRICT`);
    db.exec(`CREATE TABLE acknowledge_requests (world_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, correlation_id TEXT NOT NULL, changed INTEGER NOT NULL, last_presence_world_time INTEGER NOT NULL, last_presence_event_number INTEGER NOT NULL, belief_revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (world_id) REFERENCES worlds(world_id), PRIMARY KEY (world_id, idempotency_key)) STRICT`);
    db.close();

    const store = createMultiWorldStore(dbPath);
    store.close();

    const reopened = new DatabaseSync(dbPath);
    expect(reopened.prepare("PRAGMA user_version").get()).toEqual({ user_version: 8 });
    expect(reopened.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    const tables = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='turn_narrations'").all() as { name: string }[];
    expect(tables.length).toBe(1);
    reopened.close();
  });
});