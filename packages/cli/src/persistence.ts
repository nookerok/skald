import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
import type { DomainEvent } from "@skald/event-bus";

export interface CommitOptions {
  readonly idempotencyKey: string | undefined;
  readonly requestKind: "command" | "wait" | undefined;
  readonly correlationId: string | undefined;
}

export interface PersistenceStore {
  loadAll(): DomainEvent[];
  loadProcessedKeys(): Set<string>;
  hasProcessedKey(key: string): boolean;
  commitBatch(events: readonly DomainEvent[], options?: CommitOptions): void;
  close(): void;
}

function validateEvent(raw: unknown, index: number): DomainEvent {
  if (!raw || typeof raw !== "object") throw new Error(`event ${index}: not an object`);
  const e = raw as Record<string, unknown>;
  if (typeof e.event_id !== "string") throw new Error(`event ${index}: missing event_id`);
  if (typeof e.type !== "string") throw new Error(`event ${index}: missing type`);
  if (typeof e.schema_version !== "number") throw new Error(`event ${index}: missing schema_version`);
  if (typeof e.timestamp !== "number" || !Number.isSafeInteger(e.timestamp))
    throw new Error(`event ${index}: invalid timestamp`);
  if (typeof e.correlation_id !== "string") throw new Error(`event ${index}: missing correlation_id`);
  let payload: unknown;
  try { payload = JSON.parse(e.payload as string); } catch { throw new Error(`event ${index}: invalid payload JSON`); }
  return {
    eventId: e.event_id as string,
    type: e.type as string,
    schemaVersion: e.schema_version as number,
    payload,
    timestamp: e.timestamp as number,
    correlationId: e.correlation_id as string,
    causationId: (e.causation_id as string | null) ?? null,
  };
}

export class DuplicateRequestError extends Error {
  readonly idempotencyKey: string;
  constructor(key: string) {
    super(`Duplicate request: ${key}`);
    this.name = "DuplicateRequestError";
    this.idempotencyKey = key;
  }
}

export function createSqliteStore(dbPath: string): PersistenceStore {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let DatabaseSync: any;
  try {
    DatabaseSync = (_require("node:sqlite") as any).DatabaseSync;
  } catch {
    throw new Error("node:sqlite is not available. Node.js 22.23.1+ required.");
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA user_version = 1");

  db.exec(`CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT
  ) STRICT`);

  db.exec(`CREATE TABLE IF NOT EXISTS processed_requests (
    idempotency_key TEXT PRIMARY KEY,
    request_kind TEXT NOT NULL,
    correlation_id TEXT NOT NULL
  ) STRICT`);

  const insertEvent = db.prepare(
    "INSERT INTO events (event_id, type, schema_version, payload, timestamp, correlation_id, causation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertKey = db.prepare(
    "INSERT INTO processed_requests (idempotency_key, request_kind, correlation_id) VALUES (?, ?, ?)",
  );
  const checkKey = db.prepare(
    "SELECT 1 FROM processed_requests WHERE idempotency_key = ?",
  );
  const loadEvents = db.prepare("SELECT * FROM events ORDER BY seq ASC");
  const loadKeys = db.prepare("SELECT idempotency_key FROM processed_requests");

  return {
    loadAll(): DomainEvent[] {
      const rows = loadEvents.all() as Record<string, unknown>[];
      return rows.map((r, i) => validateEvent(r, i));
    },

    loadProcessedKeys(): Set<string> {
      const rows = loadKeys.all() as { idempotency_key: string }[];
      return new Set(rows.map((r) => r.idempotency_key));
    },

    hasProcessedKey(key: string): boolean {
      const row = checkKey.get(key) as { 1: number } | undefined;
      return !!row;
    },

    commitBatch(events: readonly DomainEvent[], options?: CommitOptions): void {
      if (events.length === 0 && !options?.idempotencyKey) return;

      db.exec("BEGIN IMMEDIATE");
      try {
        for (const e of events) {
          try {
            insertEvent.run(
              e.eventId,
              e.type,
              e.schemaVersion,
              JSON.stringify(e.payload),
              e.timestamp,
              e.correlationId,
              e.causationId ?? null,
            );
          } catch (insErr: unknown) {
            const msg = String(insErr);
            if (msg.includes("UNIQUE constraint")) {
              throw Object.assign(new Error(`duplicate event: ${e.eventId}`), { code: "DUPLICATE_EVENT" });
            }
            throw insErr;
          }
        }
        if (options?.idempotencyKey && options?.correlationId) {
          try {
            insertKey.run(
              options.idempotencyKey,
              options.requestKind ?? "command",
              options.correlationId,
            );
          } catch (insErr: unknown) {
            const msg = String(insErr);
            if (msg.includes("UNIQUE constraint")) {
              throw new DuplicateRequestError(options.idempotencyKey);
            }
            throw insErr;
          }
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    close(): void {
      try { db.close(); } catch { /* ignore double close */ }
    },
  };
}
