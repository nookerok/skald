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
      r["seq"],
      r["event_id"],
      r["type"],
      r["schema_version"],
      r["payload"] ?? r["payload_json"],
      r["timestamp"],
      r["causation_id"],
      r["correlation_id"],
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
  const oldEvents = getRows(db, "SELECT * FROM events ORDER BY seq ASC");
  const oldKeys = getRows(db, "SELECT * FROM processed_requests");
  const digestBefore = eventDigest(oldEvents);

  db.exec("BEGIN EXCLUSIVE");
  try {
    db.exec("DROP INDEX IF EXISTS events_world_seq");
    db.exec("DROP INDEX IF EXISTS events_world_time");

    // Keep the v1 tables available as migration sources while creating v2.
    db.exec("ALTER TABLE events RENAME TO events_legacy");
    db.exec("ALTER TABLE processed_requests RENAME TO processed_requests_legacy");

    execSchemaV2(db);

    db.prepare(
      "INSERT INTO worlds (world_id, save_label, template_id, character_id, character_name_snapshot, status, created_at, last_played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      LEGACY_WORLD_ID,
      "\u041f\u0435\u0440\u0432\u044b\u0439 \u043c\u0438\u0440",
      "legacy",
      null,
      null,
      "active",
      0,
      0,
    );

    const insertEv = db.prepare(
      "INSERT INTO events (seq, world_id, event_id, type, schema_version, payload_json, timestamp, causation_id, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const r of oldEvents) {
      insertEv.run(
        r["seq"],
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

    const insertKey = db.prepare(
      "INSERT INTO processed_requests (world_id, idempotency_key, request_kind, correlation_id) VALUES (?, ?, ?, ?)",
    );
    for (const r of oldKeys) {
      insertKey.run(
        LEGACY_WORLD_ID,
        r["idempotency_key"],
        r["request_kind"] ?? "command",
        r["correlation_id"] ?? "",
      );
    }

    const newEventCount = (db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;
    if (newEventCount !== oldEvents.length) {
      throw new Error(`event count mismatch: ${oldEvents.length} old vs ${newEventCount} new`);
    }

    const newEventRows = getRows(db, "SELECT * FROM events ORDER BY seq ASC");
    const digestAfter = eventDigest(newEventRows);
    if (digestBefore !== digestAfter) {
      throw new Error(`event digest mismatch: ${digestBefore} old vs ${digestAfter} new`);
    }

    db.exec("DROP TABLE events_legacy");
    db.exec("DROP TABLE processed_requests_legacy");
    db.exec("PRAGMA user_version = 2");
    db.exec("COMMIT");

    return {
      migrated: true,
      digestBefore,
      digestAfter,
      eventCount: newEventCount,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function validateUserVersion(db: SqliteHandle): "fresh" | "migrate" | "migrateV3" | "migrateV4" | "migrateV5" | "migrateV6" | "migrateV7" | "migrateV8" | "open" {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const v = row?.user_version ?? 0;

  if (v === 0) return "fresh";
  if (v === 1) return "migrate";
  if (v === 2) return "migrateV3";
  if (v === 3) return "migrateV4";
  if (v === 4) return "migrateV5";
  if (v === 5) return "migrateV6";
  if (v === 6) return "migrateV7";
  if (v === 7) return "migrateV8";
  if (v === 8) return "open";

  throw new Error(`Unknown PRAGMA user_version=${v}. Expected 0-8.`);
}

export function migrateV6ToV7(db: SqliteHandle): void {
  verifyIntegrity(db);
  db.exec("BEGIN EXCLUSIVE");
  try {
    const columns = db.prepare("PRAGMA table_info(worlds)").all() as { name?: string }[];
    if (!columns.some((column) => column.name === "entrypoint_id")) db.exec("ALTER TABLE worlds ADD COLUMN entrypoint_id TEXT");
    db.exec("PRAGMA user_version = 7");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  verifyIntegrity(db);
}

export function migrateV5ToV6(db: SqliteHandle): void {
  verifyIntegrity(db);
  db.exec("BEGIN EXCLUSIVE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS world_entrypoints (
      entrypoint TEXT PRIMARY KEY CHECK (entrypoint = 'primary'),
      world_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (world_id) REFERENCES worlds(world_id)
    ) STRICT`);
    db.exec(`CREATE TABLE IF NOT EXISTS world_successions (
      from_world_id TEXT PRIMARY KEY,
      to_world_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (from_world_id) REFERENCES worlds(world_id),
      FOREIGN KEY (to_world_id) REFERENCES worlds(world_id),
      CHECK (from_world_id <> to_world_id)
    ) STRICT`);
    db.exec("PRAGMA user_version = 6");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  verifyIntegrity(db);
}

export function migrateV4ToV5(db: SqliteHandle): void {
  verifyIntegrity(db);

  db.exec("BEGIN EXCLUSIVE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS turn_narrations (
      world_id      TEXT NOT NULL,
      world_time    INTEGER NOT NULL,
      text          TEXT NOT NULL,
      model         TEXT NOT NULL,
      used_fallback INTEGER NOT NULL,
      latency_ms    INTEGER NOT NULL,
      FOREIGN KEY (world_id) REFERENCES worlds(world_id),
      PRIMARY KEY (world_id, world_time)
    ) STRICT`);
    db.exec("PRAGMA user_version = 5");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  verifyIntegrity(db);
}

export function migrateV3ToV4(db: SqliteHandle): void {
  verifyIntegrity(db);

  db.exec("BEGIN EXCLUSIVE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS observer_checkpoints (
      world_id                   TEXT NOT NULL,
      observer_id                TEXT NOT NULL,
      last_presence_world_time   INTEGER NOT NULL,
      last_presence_event_number INTEGER NOT NULL,
      belief_revision            INTEGER NOT NULL,
      updated_at                 INTEGER NOT NULL,
      FOREIGN KEY (world_id) REFERENCES worlds(world_id),
      PRIMARY KEY (world_id, observer_id)
    ) STRICT`);
    db.exec(`CREATE TABLE IF NOT EXISTS acknowledge_requests (
      world_id                   TEXT NOT NULL,
      idempotency_key            TEXT NOT NULL,
      request_hash               TEXT NOT NULL,
      correlation_id             TEXT NOT NULL,
      changed                    INTEGER NOT NULL,
      last_presence_world_time   INTEGER NOT NULL,
      last_presence_event_number INTEGER NOT NULL,
      belief_revision            INTEGER NOT NULL,
      updated_at                 INTEGER NOT NULL,
      FOREIGN KEY (world_id) REFERENCES worlds(world_id),
      PRIMARY KEY (world_id, idempotency_key)
    ) STRICT`);
    db.exec("PRAGMA user_version = 4");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  verifyIntegrity(db);
}

export function migrateV2ToV3(db: SqliteHandle): void {
  verifyIntegrity(db);

  db.exec("BEGIN EXCLUSIVE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS world_creation_requests (
      idempotency_key TEXT PRIMARY KEY,
      request_hash    TEXT NOT NULL,
      world_id        TEXT NOT NULL UNIQUE,
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (world_id) REFERENCES worlds(world_id)
    ) STRICT`);
    db.exec("PRAGMA user_version = 3");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  verifyIntegrity(db);
}

export function verifyIntegrity(db: SqliteHandle): void {
  const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (result.integrity_check !== "ok") {
    throw new Error(`SQLite integrity check failed: ${result.integrity_check}`);
  }
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) {
    throw new Error(`Foreign key check failed: ${JSON.stringify(foreignKeys)}`);
  }
}


export function migrateV7ToV8(db: SqliteHandle): void {
  verifyIntegrity(db);
  db.exec("BEGIN EXCLUSIVE");
  try {
    const columns = db.prepare("PRAGMA table_info(character_profiles)").all() as { name?: string }[];
    if (!columns.some((column) => column.name === "background_id")) db.exec("ALTER TABLE character_profiles ADD COLUMN background_id TEXT");
    db.exec("PRAGMA user_version = 8");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  verifyIntegrity(db);
}
