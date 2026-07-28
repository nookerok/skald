import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
import type { DomainEvent } from "@skald/event-bus";
import { configureDatabase, execSchemaV2 } from "./schema.js";
import { migrateV1ToV2, validateUserVersion, verifyIntegrity } from "./migrations.js";
import { LEGACY_WORLD_ID, type WorldId, type WorldRecord } from "./types.js";

export interface CommitOptions {
  readonly idempotencyKey: string | undefined;
  readonly requestKind: "command" | "wait" | undefined;
  readonly correlationId: string | undefined;
}

export interface MultiWorldStore {
  loadEvents(worldId: WorldId): DomainEvent[];
  loadProcessedKeys(worldId: WorldId): Set<string>;
  hasProcessedKey(worldId: WorldId, key: string): boolean;
  commitBatch(worldId: WorldId, events: readonly DomainEvent[], options?: CommitOptions): void;
  listWorlds(): WorldRecord[];
  getWorldRecord(worldId: WorldId): WorldRecord | null;
  close(): void;
}

interface SqliteHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown | undefined;
  };
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
  try { payload = JSON.parse(e.payload_json as string); } catch { throw new Error(`event ${index}: invalid payload JSON`); }
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

export function createMultiWorldStore(dbPath: string): MultiWorldStore {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let DatabaseSync: any;
  try {
    DatabaseSync = (_require("node:sqlite") as any).DatabaseSync;
  } catch {
    throw new Error("node:sqlite is not available. Node.js 22.23.1+ required.");
  }
  const db = new DatabaseSync(dbPath) as SqliteHandle;
  configureDatabase(db);

  // Version-aware open
  const versionAction = validateUserVersion(db);

  if (versionAction === "fresh") {
    execSchemaV2(db);
    // Create legacy world record so FK constraints are satisfied
    db.prepare(
      "INSERT OR IGNORE INTO worlds (world_id, save_label, template_id, character_id, character_name_snapshot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(LEGACY_WORLD_ID, "Первый мир", "legacy", null, null, "active", 0);
  } else if (versionAction === "migrate") {
    verifyIntegrity(db);
    const result = migrateV1ToV2(db);
    console.log(`[persistence] migrated v1→v2: ${result.eventCount} events, digest=${result.digestAfter.slice(0, 12)}`);
    verifyIntegrity(db);
  } else {
    // Already v2 — verify
    verifyIntegrity(db);
  }

  // Prepared statements
  const loadEvents = db.prepare("SELECT * FROM events WHERE world_id = ? ORDER BY seq ASC");
  const loadKeys = db.prepare("SELECT idempotency_key FROM processed_requests WHERE world_id = ?");
  const checkKey = db.prepare("SELECT 1 FROM processed_requests WHERE world_id = ? AND idempotency_key = ?");
  const insertEvent = db.prepare(
    "INSERT INTO events (world_id, event_id, type, schema_version, payload_json, timestamp, causation_id, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertKey = db.prepare(
    "INSERT INTO processed_requests (world_id, idempotency_key, request_kind, correlation_id) VALUES (?, ?, ?, ?)",
  );
  const updateLastPlayed = db.prepare(
    "UPDATE worlds SET last_played_at = ? WHERE world_id = ?",
  );
  const listWorlds = db.prepare(
    "SELECT w.world_id, w.save_label, w.template_id, w.character_id, w.character_name_snapshot, w.status, w.created_at, w.last_played_at, (SELECT MAX(timestamp) FROM events WHERE world_id = w.world_id) AS world_time FROM worlds w ORDER BY w.last_played_at DESC NULLS LAST, w.created_at DESC",
  );
  const getWorld = db.prepare(
    "SELECT w.world_id, w.save_label, w.template_id, w.character_id, w.character_name_snapshot, w.status, w.created_at, w.last_played_at, (SELECT MAX(timestamp) FROM events WHERE world_id = w.world_id) AS world_time FROM worlds w WHERE w.world_id = ?",
  );

  return {
    loadEvents(worldId: WorldId): DomainEvent[] {
      const rows = loadEvents.all(worldId) as Record<string, unknown>[];
      return rows.map((r, i) => validateEvent(r, i));
    },

    loadProcessedKeys(worldId: WorldId): Set<string> {
      const rows = loadKeys.all(worldId) as { idempotency_key: string }[];
      return new Set(rows.map((r) => r.idempotency_key));
    },

    hasProcessedKey(worldId: WorldId, key: string): boolean {
      const row = checkKey.get(worldId, key) as { 1: number } | undefined;
      return !!row;
    },

    commitBatch(worldId: WorldId, events: readonly DomainEvent[], options?: CommitOptions): void {
      if (events.length === 0 && !options?.idempotencyKey) return;

      db.exec("BEGIN IMMEDIATE");
      try {
        for (const e of events) {
          try {
            insertEvent.run(
              worldId, e.eventId, e.type, e.schemaVersion,
              JSON.stringify(e.payload), e.timestamp,
              e.causationId ?? null, e.correlationId,
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
              worldId, options.idempotencyKey,
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
        // Update last_played_at
        updateLastPlayed.run(Date.now(), worldId);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    listWorlds(): WorldRecord[] {
      const rows = listWorlds.all() as Record<string, unknown>[];
      return rows.map((r) => ({
        worldId: r["world_id"] as string,
        saveLabel: r["save_label"] as string,
        templateId: r["template_id"] as string,
        characterId: (r["character_id"] as string) ?? null,
        characterName: (r["character_name_snapshot"] as string) ?? null,
        status: r["status"] as "active" | "archived" | "corrupt",
        createdAt: r["created_at"] as number,
        lastPlayedAt: (r["last_played_at"] as number) ?? null,
        worldTime: (r["world_time"] as number) ?? 0,
      }));
    },

    getWorldRecord(worldId: WorldId): WorldRecord | null {
      const r = getWorld.get(worldId) as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        worldId: r["world_id"] as string,
        saveLabel: r["save_label"] as string,
        templateId: r["template_id"] as string,
        characterId: (r["character_id"] as string) ?? null,
        characterName: (r["character_name_snapshot"] as string) ?? null,
        status: r["status"] as "active" | "archived" | "corrupt",
        createdAt: r["created_at"] as number,
        lastPlayedAt: (r["last_played_at"] as number) ?? null,
        worldTime: (r["world_time"] as number) ?? 0,
      };
    },

    close(): void {
      try { db.close(); } catch { /* ignore double close */ }
    },
  };
}
