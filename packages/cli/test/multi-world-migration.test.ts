import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createMultiWorldStore } from "../src/persistence/index.js";

const require = createRequire(import.meta.url);
const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => any }).DatabaseSync;

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "skald-migration-"));
  return join(dir, "events.sqlite");
}

describe("multi-world persistence migration", () => {
  it("opens and migrates a real v1 database inside the migration transaction", () => {
    const dbPath = tmpDb();
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA user_version = 1");
    db.exec(`CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      correlation_id TEXT NOT NULL,
      causation_id TEXT
    ) STRICT`);
    db.exec(`CREATE TABLE processed_requests (
      idempotency_key TEXT PRIMARY KEY,
      request_kind TEXT NOT NULL,
      correlation_id TEXT NOT NULL
    ) STRICT`);
    db.prepare(
      "INSERT INTO events (event_id, type, schema_version, payload, timestamp, correlation_id, causation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("legacy-event", "TickPassed", 1, JSON.stringify({ delta: 1 }), 1, "legacy-correlation", null);
    db.prepare(
      "INSERT INTO processed_requests (idempotency_key, request_kind, correlation_id) VALUES (?, ?, ?)",
    ).run("legacy-key", "command", "legacy-correlation");
    db.close();

    const store = createMultiWorldStore(dbPath);
    expect(store.loadEvents("legacy-world")).toHaveLength(1);
    expect(store.loadEvents("legacy-world")[0]!.eventId).toBe("legacy-event");
    expect(store.hasProcessedKey("legacy-world", "legacy-key")).toBe(true);
    expect(store.listWorlds()).toHaveLength(1);
    store.close();

    const reopened = new DatabaseSync(dbPath);
    expect(reopened.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    expect(reopened.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    // observer_checkpoints must exist after the chained v3→v4 migration
    const tables = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observer_checkpoints'").all() as { name: string }[];
    expect(tables.length).toBe(1);
    reopened.close();
  });

  it("direct v2-to-v3 migration adds world_creation_requests", () => {
    const dbPath = tmpDb();
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA user_version = 2");
    db.exec(`CREATE TABLE character_profiles (character_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, wound TEXT NOT NULL, promise TEXT NOT NULL, principle TEXT NOT NULL, profile_version INTEGER NOT NULL, created_at INTEGER NOT NULL) STRICT`);
    db.exec(`CREATE TABLE worlds (world_id TEXT PRIMARY KEY, save_label TEXT NOT NULL, template_id TEXT NOT NULL, character_id TEXT, character_name_snapshot TEXT, status TEXT NOT NULL CHECK (status IN ('active','archived','corrupt')), created_at INTEGER NOT NULL, last_played_at INTEGER) STRICT`);
    db.exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, event_id TEXT NOT NULL, type TEXT NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, timestamp INTEGER NOT NULL, causation_id TEXT, correlation_id TEXT, FOREIGN KEY (world_id) REFERENCES worlds(world_id), UNIQUE (world_id, event_id)) STRICT`);
    db.exec(`CREATE TABLE processed_requests (world_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_kind TEXT NOT NULL, correlation_id TEXT NOT NULL, FOREIGN KEY (world_id) REFERENCES worlds(world_id), PRIMARY KEY (world_id, idempotency_key)) STRICT`);
    db.close();

    const store = createMultiWorldStore(dbPath);
    store.close();

    const reopened = new DatabaseSync(dbPath);
    expect(reopened.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    // world_creation_requests table should exist (verify by reading schema)
    const tables = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_creation_requests'").all() as { name: string }[];
    expect(tables.length).toBe(1);
    reopened.close();
  });
});
