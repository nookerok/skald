import { createHash } from "node:crypto";
import { LEGACY_WORLD_ID } from "./types.js";
import { execSchemaV2 } from "./schema.js";

interface SqliteHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown | undefined;
  };
  close(): void;
}

function getRows(db: SqliteHandle, sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

function eventDigest(rows: Record<string, unknown>[]): string {
  const h = createHash("sha256");
  for (const r of rows) {
    h.update(JSON.stringify([
      r["seq"], r["event_id"], r["type"], r["schema_version"],
      r["payload"], r["timestamp"], r["causation_id"], r["correlation_id"],
    ]));
  }
  return h.digest("hex");
}

interface MigrationResult {
  migrated: boolean;
  digestBefore: string;
  digestAfter: string;
  eventCount: number;
}

export function migrateV1ToV2(db: SqliteHandle): MigrationResult {
  // Snapshot old data
  const oldEvents = getRows(db, "SELECT * FROM events ORDER BY seq ASC");
  const oldKeys = getRows(db, "SELECT * FROM processed_requests");
  const digestBefore = eventDigest(oldEvents);

  // BEGIN EXCLUSIVE transaction
  db.exec("BEGIN EXCLUSIVE");
  try {
    // Drop old indexes if they exist
    try { db.exec("DROP INDEX IF EXISTS events_world_seq"); } catch { /* ignore */ }
    try { db.exec("DROP INDEX IF EXISTS events_world_time"); } catch { /* ignore */ }

    // Create v2 tables under temp names
    db.exec(`CREATE TABLE events_v2 (
      seq            INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id       TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      type           TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload_json   TEXT NOT NULL,
      timestamp      INTEGER NOT NULL,
      causation_id   TEXT,
      correlation_id TEXT,
      UNIQUE (world_id, event_id)
    ) STRICT`);

    db.exec(`CREATE TABLE processed_requests_v2 (
      world_id        TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_kind    TEXT NOT NULL,
      correlation_id  TEXT NOT NULL,
      PRIMARY KEY (world_id, idempotency_key)
    ) STRICT`);

    // Create v2 tables
    execSchemaV2(db);

    // Create legacy world record
    db.prepare(
      "INSERT OR IGNORE INTO worlds (world_id, save_label, template_id, character_id, character_name_snapshot, status, created_at, last_played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      LEGACY_WORLD_ID,
      "Первый мир",
      "legacy",
      null,
      null,
      "active",
      0,
      0,
    );

    // Copy events with world_id
    const insertEv = db.prepare(
      "INSERT INTO events (world_id, event_id, type, schema_version, payload_json, timestamp, causation_id, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const r of oldEvents) {
      insertEv.run(
        LEGACY_WORLD_ID,
        r["event_id"],
        r["type"],
        r["schema_version"],
        r["payload"],
        r["timestamp"],
        r["causation_id"] ?? null,
        r["correlation_id"],
      );
    }

    // Copy processed keys
    const insertKey = db.prepare(
      "INSERT OR IGNORE INTO processed_requests (world_id, idempotency_key, request_kind, correlation_id) VALUES (?, ?, ?, ?)",
    );
    for (const r of oldKeys) {
      insertKey.run(
        LEGACY_WORLD_ID,
        r["idempotency_key"],
        r["request_kind"] ?? "command",
        r["correlation_id"] ?? "",
      );
    }

    // Verify row counts
    const newEventCount = (db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;
    if (newEventCount !== oldEvents.length) {
      throw new Error(`event count mismatch: ${oldEvents.length} old vs ${newEventCount} new`);
    }

    // Verify digest
    const newEventRows = getRows(db, "SELECT * FROM events ORDER BY seq ASC");
    const digestAfter = eventDigest(newEventRows);

    // Drop old tables
    db.exec("DROP TABLE IF EXISTS events_v2");
    db.exec("DROP TABLE IF EXISTS processed_requests_v2");

    // Set version
    db.exec(`PRAGMA user_version = 2`);

    db.exec("COMMIT");

    return {
      migrated: true,
      digestBefore,
      digestAfter,
      eventCount: newEventCount,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    // Drop temp tables if they exist
    try { db.exec("DROP TABLE IF EXISTS events_v2"); } catch { /* ignore */ }
    try { db.exec("DROP TABLE IF EXISTS processed_requests_v2"); } catch { /* ignore */ }
    throw err;
  }
}

export function validateUserVersion(db: SqliteHandle): "fresh" | "migrate" | "open" {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const v = row?.user_version ?? 0;

  if (v === 0) return "fresh";
  if (v === 1) return "migrate";
  if (v === 2) return "open";

  throw new Error(`Unknown PRAGMA user_version=${v}. Expected 0, 1, or 2.`);
}

export function verifyIntegrity(db: SqliteHandle): void {
  const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (result.integrity_check !== "ok") {
    throw new Error(`SQLite integrity check failed: ${result.integrity_check}`);
  }
  try {
    db.prepare("PRAGMA foreign_key_check").all();
  } catch (err) {
    throw new Error(`Foreign key check failed: ${String(err)}`);
  }
}
