import type { DomainEvent } from "@skald/event-bus";
import {
  createMultiWorldStore,
  DuplicateRequestError,
} from "./persistence/sqlite-store.js";
import type { MultiWorldStore } from "./persistence/sqlite-store.js";
import { LEGACY_WORLD_ID } from "./persistence/types.js";

// Backward-compatible types and functions for existing tests

export interface PersistenceStore {
  loadAll(): DomainEvent[];
  loadProcessedKeys(): Set<string>;
  hasProcessedKey(key: string): boolean;
  commitBatch(events: readonly DomainEvent[], options?: CommitOptions): void;
  close(): void;
}

export interface CommitOptions {
  readonly idempotencyKey: string | undefined;
  readonly requestKind: "command" | "wait" | undefined;
  readonly correlationId: string | undefined;
}

function adaptStore(store: MultiWorldStore, worldId: string): PersistenceStore {
  return {
    loadAll(): DomainEvent[] {
      return store.loadEvents(worldId);
    },
    loadProcessedKeys(): Set<string> {
      return store.loadProcessedKeys(worldId);
    },
    hasProcessedKey(key: string): boolean {
      return store.hasProcessedKey(worldId, key);
    },
    commitBatch(events: readonly DomainEvent[], options?: CommitOptions): void {
      store.commitBatch(worldId, events, options ? {
        idempotencyKey: options.idempotencyKey,
        requestKind: options.requestKind,
        correlationId: options.correlationId,
      } : undefined);
    },
    close(): void {
      store.close();
    },
  };
}

export function createSqliteStore(dbPath: string): PersistenceStore {
  const store = createMultiWorldStore(dbPath);
  return adaptStore(store, LEGACY_WORLD_ID);
}

// Re-export new types
export type {
  WorldId,
  WorldRecord,
  CharacterProfile,
  WorldTemplate,
} from "./persistence/types.js";
export { DEFAULT_TEMPLATE, LEGACY_WORLD_ID } from "./persistence/types.js";
export { DuplicateRequestError };

// Also export raw store for new code paths
export { createMultiWorldStore };
export type { MultiWorldStore };
