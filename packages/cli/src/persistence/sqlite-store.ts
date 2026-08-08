import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
import type { DomainEvent } from "@skald/event-bus";
import type { ObserverCheckpoint, TurnNarration } from "@skald/world";
import { configureDatabase, execSchemaV5 } from "./schema.js";
import { migrateV1ToV2, migrateV2ToV3, migrateV3ToV4, migrateV4ToV5, validateUserVersion, verifyIntegrity } from "./migrations.js";
import { LEGACY_WORLD_ID, type WorldId, type WorldRecord } from "./types.js";

export interface CommitOptions {
  readonly idempotencyKey: string | undefined;
  readonly requestKind: "command" | "wait" | undefined;
  readonly correlationId: string | undefined;
}

export interface CharacterProfileRecord {
  display_name: string;
  wound: string;
  promise: string;
  principle: string;
}

export interface MultiWorldStore {
  loadEvents(worldId: WorldId): DomainEvent[];
  loadProcessedKeys(worldId: WorldId): Set<string>;
  hasProcessedKey(worldId: WorldId, key: string): boolean;
  commitBatch(worldId: WorldId, events: readonly DomainEvent[], options?: CommitOptions): void;
  listWorlds(): WorldRecord[];
  getWorldRecord(worldId: WorldId): WorldRecord | null;
  getCharacterProfile(characterId: string): CharacterProfileRecord | null;
  createWorld(params: CreateWorldParams): CreateWorldResult;
  getObserverCheckpoint(worldId: WorldId, observerId: "player"): ObserverCheckpoint | null;
  acknowledgeObserverCheckpoint(
    params: AcknowledgeObserverCheckpointParams,
  ): AcknowledgeObserverCheckpointResult;
  /** Idempotency replay lookup: the original result of a processed acknowledge. */
  getAcknowledgeReplay(
    worldId: WorldId,
    idempotencyKey: string,
  ): { requestHash: string; result: AcknowledgeObserverCheckpointResult } | null;
  /** Persist one turn's non-authoritative literary narration (read-side). */
  saveTurnNarration(worldId: WorldId, worldTime: number, narration: TurnNarration): void;
  /** All stored narrations for a world, keyed by turn worldTime. Idempotent. */
  getTurnNarrations(worldId: WorldId): Map<number, TurnNarration>;
  close(): void;
}

export interface CreateWorldParams {
  readonly worldId: WorldId;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly saveLabel: string;
  readonly characterName: string;
  readonly characterPresetId: string;
  readonly worldTemplateId: string;
  readonly characterWound: string;
  readonly characterPromise: string;
  readonly characterPrinciple: string;
  readonly characterProfileVersion: number;
  readonly bootstrapEvents: readonly DomainEvent[];
}

export interface CreateWorldResult {
  created: boolean;
  worldRecord: WorldRecord;
}

export interface AcknowledgeObserverCheckpointParams {
  readonly worldId: WorldId;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly correlationId: string;
  readonly observerId: "player";
  readonly lastPresenceWorldTime: number;
  readonly lastPresenceEventNumber: number;
  readonly beliefRevision: number;
}

export interface AcknowledgeObserverCheckpointResult {
  /** Whether the checkpoint row changed (same revision converges to false). */
  readonly changed: boolean;
  readonly checkpoint: ObserverCheckpoint;
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
    execSchemaV5(db);
    // Create legacy world record so FK constraints are satisfied
    db.prepare(
      "INSERT OR IGNORE INTO worlds (world_id, save_label, template_id, character_id, character_name_snapshot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(LEGACY_WORLD_ID, "Первый мир", "legacy", null, null, "active", 0);
  } else if (versionAction === "migrate") {
    verifyIntegrity(db);
    const result = migrateV1ToV2(db);
    console.log(`[persistence] migrated v1→v2: ${result.eventCount} events, digest=${result.digestAfter.slice(0, 12)}`);
    verifyIntegrity(db);
    // Chain to v3 and v4
    migrateV2ToV3(db);
    console.log(`[persistence] migrated v2→v3: world_creation_requests table added`);
    migrateV3ToV4(db);
    console.log(`[persistence] migrated v3→v4: observer_checkpoints table added`);
    migrateV4ToV5(db);
    console.log(`[persistence] migrated v4→v5: turn_narrations table added`);
  } else if (versionAction === "migrateV3") {
    verifyIntegrity(db);
    migrateV2ToV3(db);
    console.log(`[persistence] migrated v2→v3: world_creation_requests table added`);
    migrateV3ToV4(db);
    console.log(`[persistence] migrated v3→v4: observer_checkpoints table added`);
    migrateV4ToV5(db);
    console.log(`[persistence] migrated v4→v5: turn_narrations table added`);
  } else if (versionAction === "migrateV4") {
    verifyIntegrity(db);
    migrateV3ToV4(db);
    console.log(`[persistence] migrated v3→v4: observer_checkpoints table added`);
    migrateV4ToV5(db);
    console.log(`[persistence] migrated v4→v5: turn_narrations table added`);
  } else if (versionAction === "migrateV5") {
    verifyIntegrity(db);
    migrateV4ToV5(db);
    console.log(`[persistence] migrated v4→v5: turn_narrations table added`);
  } else {
    // Already v5 — verify
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
  const getCheckpoint = db.prepare(
    "SELECT world_id, observer_id, last_presence_world_time, last_presence_event_number, belief_revision, updated_at FROM observer_checkpoints WHERE world_id = ? AND observer_id = ?",
  );
  const checkAcknowledgeKey = db.prepare(
    "SELECT 1 FROM processed_requests WHERE world_id = ? AND idempotency_key = ?",
  );
  const getAcknowledgeRequest = db.prepare(
    "SELECT world_id, idempotency_key, request_hash, changed, last_presence_world_time, last_presence_event_number, belief_revision, updated_at FROM acknowledge_requests WHERE world_id = ? AND idempotency_key = ?",
  );
  const insertAcknowledgeRequest = db.prepare(
    "INSERT INTO acknowledge_requests (world_id, idempotency_key, request_hash, correlation_id, changed, last_presence_world_time, last_presence_event_number, belief_revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const upsertTurnNarration = db.prepare(
    "INSERT INTO turn_narrations (world_id, world_time, text, model, used_fallback, latency_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(world_id, world_time) DO UPDATE SET text = excluded.text, model = excluded.model, used_fallback = excluded.used_fallback, latency_ms = excluded.latency_ms",
  );
  const listTurnNarrations = db.prepare(
    "SELECT world_time, text, model, used_fallback, latency_ms FROM turn_narrations WHERE world_id = ?",
  );

  function mapAcknowledgeReplay(r: Record<string, unknown>): {
    requestHash: string;
    result: AcknowledgeObserverCheckpointResult;
  } {
    return {
      requestHash: r["request_hash"] as string,
      result: {
        changed: (r["changed"] as number) === 1,
        checkpoint: {
          worldId: r["world_id"] as string,
          observerId: "player",
          lastPresenceWorldTime: r["last_presence_world_time"] as number,
          lastPresenceEventNumber: r["last_presence_event_number"] as number,
          beliefRevision: r["belief_revision"] as number,
          updatedAt: new Date(r["updated_at"] as number).toISOString(),
        },
      },
    };
  }

  function mapCheckpoint(r: Record<string, unknown>): ObserverCheckpoint {
    return {
      worldId: r["world_id"] as string,
      observerId: "player",
      lastPresenceWorldTime: r["last_presence_world_time"] as number,
      lastPresenceEventNumber: r["last_presence_event_number"] as number,
      beliefRevision: r["belief_revision"] as number,
      updatedAt: new Date(r["updated_at"] as number).toISOString(),
    };
  }

  // Caller must hold BEGIN IMMEDIATE. Returns whether content changed.
  function upsertCheckpointLocked(
    worldId: string,
    observerId: "player",
    lastPresenceWorldTime: number,
    lastPresenceEventNumber: number,
    beliefRevision: number,
  ): boolean {
    const existing = getCheckpoint.get(worldId, observerId) as Record<string, unknown> | undefined;
    if (
      existing &&
      existing["last_presence_world_time"] === lastPresenceWorldTime &&
      existing["last_presence_event_number"] === lastPresenceEventNumber &&
      existing["belief_revision"] === beliefRevision
    ) {
      return false;
    }
    // updated_at is an infra timestamp; keep it monotonic so a content change
    // always bumps it (a checkpoint updated twice within the same millisecond
    // must still advance, otherwise the persistence test flakes).
    const now = Math.max(Date.now(), ((existing?.["updated_at"] as number) ?? 0) + 1);
    if (!existing) {
      db.prepare(
        "INSERT INTO observer_checkpoints (world_id, observer_id, last_presence_world_time, last_presence_event_number, belief_revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(worldId, observerId, lastPresenceWorldTime, lastPresenceEventNumber, beliefRevision, now);
    } else {
      db.prepare(
        "UPDATE observer_checkpoints SET last_presence_world_time = ?, last_presence_event_number = ?, belief_revision = ?, updated_at = ? WHERE world_id = ? AND observer_id = ?",
      ).run(lastPresenceWorldTime, lastPresenceEventNumber, beliefRevision, now, worldId, observerId);
    }
    return true;
  }

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

    getCharacterProfile(characterId: string): CharacterProfileRecord | null {
      const row = db.prepare(
        "SELECT display_name, wound, promise, principle FROM character_profiles WHERE character_id = ?",
      ).get(characterId) as Record<string, string> | undefined;
      if (!row) return null;
      return {
        display_name: row["display_name"]!,
        wound: row["wound"]!,
        promise: row["promise"]!,
        principle: row["principle"]!,
      };
    },

    createWorld(params: CreateWorldParams): CreateWorldResult {
      const characterId = `char-${params.worldId}`;
      const now = Date.now();

      // Check idempotency first
      const existing = db.prepare("SELECT world_id, request_hash FROM world_creation_requests WHERE idempotency_key = ?").get(params.idempotencyKey) as Record<string, unknown> | undefined;
      if (existing) {
        if (existing["request_hash"] !== params.requestHash) {
          throw Object.assign(new Error("conflicting creation request for key"), { code: "CONFLICT" });
        }
        const record = getWorld.get(existing["world_id"]) as Record<string, unknown>;
        if (!record) throw new Error("existing creation record references missing world");
        return {
          created: false,
          worldRecord: {
            worldId: record["world_id"] as string,
            saveLabel: record["save_label"] as string,
            templateId: record["template_id"] as string,
            characterId: (record["character_id"] as string) ?? null,
            characterName: (record["character_name_snapshot"] as string) ?? null,
            status: record["status"] as "active",
            createdAt: record["created_at"] as number,
            lastPlayedAt: (record["last_played_at"] as number) ?? null,
            worldTime: 0,
          },
        };
      }

      // Check worldId uniqueness
      const existingWorld = getWorld.get(params.worldId) as Record<string, unknown> | undefined;
      if (existingWorld) {
        throw Object.assign(new Error("world already exists"), { code: "DUPLICATE_WORLD" });
      }

      db.exec("BEGIN IMMEDIATE");
      try {
        // 1. Insert character profile
        db.prepare(
          "INSERT INTO character_profiles (character_id, display_name, wound, promise, principle, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(characterId, params.characterName, params.characterWound, params.characterPromise, params.characterPrinciple, params.characterProfileVersion, now);

        // 2. Insert world record
        db.prepare(
          "INSERT INTO worlds (world_id, save_label, template_id, character_id, character_name_snapshot, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(params.worldId, params.saveLabel, params.worldTemplateId, characterId, params.characterName, "active", now);

        // 3. Insert bootstrap events
        for (const e of params.bootstrapEvents) {
          db.prepare(
            "INSERT INTO events (world_id, event_id, type, schema_version, payload_json, timestamp, causation_id, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(params.worldId, e.eventId, e.type, e.schemaVersion, JSON.stringify(e.payload), e.timestamp, e.causationId ?? null, e.correlationId);
        }

        // 4. Insert creation request
        db.prepare(
          "INSERT INTO world_creation_requests (idempotency_key, request_hash, world_id, created_at) VALUES (?, ?, ?, ?)",
        ).run(params.idempotencyKey, params.requestHash, params.worldId, now);

        db.exec("COMMIT");

        return {
          created: true,
          worldRecord: {
            worldId: params.worldId,
            saveLabel: params.saveLabel,
            templateId: params.worldTemplateId,
            characterId,
            characterName: params.characterName,
            status: "active",
            createdAt: now,
            lastPlayedAt: null,
            worldTime: 0,
          },
        };
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    getObserverCheckpoint(worldId: WorldId, observerId: "player"): ObserverCheckpoint | null {
      const row = getCheckpoint.get(worldId, observerId) as Record<string, unknown> | undefined;
      return row ? mapCheckpoint(row) : null;
    },

    acknowledgeObserverCheckpoint(
      params: AcknowledgeObserverCheckpointParams,
    ): AcknowledgeObserverCheckpointResult {
      // Acknowledge idempotency: the acknowledge_requests row (key + request hash
      // + the original result) is the replay record. A key reused with a
      // different body is a conflict; the same body always reproduces the
      // original response, even if a later acknowledge changed the checkpoint.
      const ackRow = getAcknowledgeRequest.get(params.worldId, params.idempotencyKey) as
        | Record<string, unknown>
        | undefined;
      if (ackRow) {
        if (ackRow["request_hash"] !== params.requestHash) {
          throw new DuplicateRequestError(params.idempotencyKey);
        }
        return mapAcknowledgeReplay(ackRow).result;
      }
      if (checkAcknowledgeKey.get(params.worldId, params.idempotencyKey)) {
        throw new DuplicateRequestError(params.idempotencyKey);
      }

      db.exec("BEGIN IMMEDIATE");
      let changed = false;
      try {
        changed = upsertCheckpointLocked(
          params.worldId, params.observerId,
          params.lastPresenceWorldTime, params.lastPresenceEventNumber,
          params.beliefRevision,
        );
        const freshRow = getCheckpoint.get(params.worldId, params.observerId) as Record<string, unknown>;
        try {
          insertAcknowledgeRequest.run(
            params.worldId, params.idempotencyKey,
            params.requestHash, params.correlationId,
            changed ? 1 : 0,
            params.lastPresenceWorldTime, params.lastPresenceEventNumber,
            params.beliefRevision, freshRow["updated_at"] as number,
          );
          insertKey.run(
            params.worldId, params.idempotencyKey,
            "acknowledge",
            params.correlationId,
          );
        } catch (insErr: unknown) {
          const msg = String(insErr);
          if (msg.includes("UNIQUE constraint")) {
            throw new DuplicateRequestError(params.idempotencyKey);
          }
          throw insErr;
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      const fresh = getCheckpoint.get(params.worldId, params.observerId) as Record<string, unknown>;
      return { changed, checkpoint: mapCheckpoint(fresh) };
    },

    getAcknowledgeReplay(
      worldId: WorldId,
      idempotencyKey: string,
    ): { requestHash: string; result: AcknowledgeObserverCheckpointResult } | null {
      const row = getAcknowledgeRequest.get(worldId, idempotencyKey) as Record<string, unknown> | undefined;
      return row ? mapAcknowledgeReplay(row) : null;
    },

    saveTurnNarration(worldId: WorldId, worldTime: number, narration: TurnNarration): void {
      upsertTurnNarration.run(
        worldId, worldTime, narration.text, narration.model,
        narration.usedFallback ? 1 : 0, narration.latencyMs,
      );
    },

    getTurnNarrations(worldId: WorldId): Map<number, TurnNarration> {
      const rows = listTurnNarrations.all(worldId) as Record<string, unknown>[];
      const map = new Map<number, TurnNarration>();
      for (const r of rows) {
        map.set(r["world_time"] as number, {
          text: r["text"] as string,
          model: r["model"] as string,
          usedFallback: (r["used_fallback"] as number) === 1,
          fallbackReason: null,
          latencyMs: r["latency_ms"] as number,
        });
      }
      return map;
    },

    close(): void {
      try { db.close(); } catch { /* ignore double close */ }
    },
  };
}
