import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createMultiWorldStore } from "../src/persistence/index.js";
import type { AcknowledgeObserverCheckpointParams } from "../src/persistence/index.js";
import { bootstrapWorldEvents } from "@skald/world";

const require = createRequire(import.meta.url);
const DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => any }).DatabaseSync;

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "skald-checkpoint-"));
  return join(dir, "events.sqlite");
}

function createWorld(store: ReturnType<typeof createMultiWorldStore>, worldId: string, key: string): void {
  store.createWorld({
    worldId,
    idempotencyKey: key,
    requestHash: `hash-${key}`,
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

function ack(worldId: string, key: string, rev: number, time: number, eventNumber: number): AcknowledgeObserverCheckpointParams {
  return {
    worldId,
    idempotencyKey: key,
    requestHash: ackHash(time, eventNumber),
    correlationId: `corr-${key}`,
    observerId: "player",
    lastPresenceWorldTime: time,
    lastPresenceEventNumber: eventNumber,
    beliefRevision: rev,
  };
}

function ackHash(time: number, eventNumber: number): string {
  return `ack|${time}|${eventNumber}`;
}

describe("observer checkpoint persistence", () => {
  it("persists across restart", () => {
    const dbPath = tmpDb();
    let store = createMultiWorldStore(dbPath);
    createWorld(store, "w1", "create-1");
    const r = store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 42, 5, 8));
    expect(r.changed).toBe(true);
    expect(r.checkpoint.lastPresenceWorldTime).toBe(5);
    expect(r.checkpoint.lastPresenceEventNumber).toBe(8);
    expect(r.checkpoint.beliefRevision).toBe(42);
    store.close();

    store = createMultiWorldStore(dbPath);
    const cp = store.getObserverCheckpoint("w1", "player");
    expect(cp).not.toBeNull();
    expect(cp!.beliefRevision).toBe(42);
    expect(cp!.updatedAt).toBe(r.checkpoint.updatedAt);
    store.close();
  });

  it("returns null when no checkpoint exists", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    expect(store.getObserverCheckpoint("w1", "player")).toBeNull();
    store.close();
  });

  it("same key with the same body replays the original response", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    const first = store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 42, 5, 8));
    const replay = store.acknowledgeObserverCheckpoint({ ...ack("w1", "ack-1", 42, 5, 8), correlationId: "corr-replay" });
    expect(replay).toEqual(first);
    store.close();
  });

  it("replays the original result even after a later acknowledge moved the checkpoint", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    // ack key-A at revision A
    const firstA = store.acknowledgeObserverCheckpoint(ack("w1", "ack-A", 42, 5, 8));
    // ack key-B at revision B (moves the checkpoint)
    const secondB = store.acknowledgeObserverCheckpoint(ack("w1", "ack-B", 43, 9, 14));
    expect(secondB.changed).toBe(true);
    expect(store.getObserverCheckpoint("w1", "player")!.beliefRevision).toBe(43);
    // retry key-A with the same body -> the original first-A response
    const retryA = store.acknowledgeObserverCheckpoint({ ...ack("w1", "ack-A", 42, 5, 8), correlationId: "corr-retry" });
    expect(retryA).toEqual(firstA);
    store.close();
  });

  it("getAcknowledgeReplay returns the original result and request hash", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    const first = store.acknowledgeObserverCheckpoint(ack("w1", "ack-A", 42, 5, 8));
    const replay = store.getAcknowledgeReplay("w1", "ack-A");
    expect(replay).not.toBeNull();
    expect(replay!.requestHash).toBe(ackHash(5, 8));
    expect(replay!.result).toEqual(first);
    expect(store.getAcknowledgeReplay("w1", "unknown-key")).toBeNull();
    store.close();
  });

  it("same key with a different body conflicts", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 42, 5, 8));
    expect(() => store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 99, 6, 9)))
      .toThrowError(/duplicate request/i);
    store.close();
  });

  it("acknowledge rejects a key already used by a command", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    store.commitBatch("w1", [], { idempotencyKey: "shared-key", correlationId: "cmd-1", requestKind: "command" });
    expect(() => store.acknowledgeObserverCheckpoint(ack("w1", "shared-key", 42, 5, 8)))
      .toThrowError(/duplicate request/i);
    store.close();
  });

  it("same revision with a new key converges to the same checkpoint", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    const first = store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 42, 5, 8));
    const second = store.acknowledgeObserverCheckpoint(ack("w1", "ack-2", 42, 5, 8));
    expect(second.changed).toBe(false);
    expect(second.checkpoint).toEqual(first.checkpoint);
    store.close();
  });

  it("new revision advances the checkpoint and bumps updatedAt", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    const first = store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 42, 5, 8));
    const second = store.acknowledgeObserverCheckpoint(ack("w1", "ack-2", 43, 9, 14));
    expect(second.changed).toBe(true);
    expect(second.checkpoint.beliefRevision).toBe(43);
    expect(second.checkpoint.lastPresenceWorldTime).toBe(9);
    expect(second.checkpoint.lastPresenceEventNumber).toBe(14);
    expect(new Date(second.checkpoint.updatedAt).getTime()).toBeGreaterThan(
      new Date(first.checkpoint.updatedAt).getTime(),
    );
    store.close();
  });

  it("does not touch the Event Log", () => {
    const store = createMultiWorldStore(tmpDb());
    createWorld(store, "w1", "create-1");
    const before = store.loadEvents("w1").map((e) => JSON.stringify(e));
    store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 42, 5, 8));
    store.acknowledgeObserverCheckpoint(ack("w1", "ack-2", 43, 9, 14));
    expect(store.loadEvents("w1").map((e) => JSON.stringify(e))).toEqual(before);
    store.close();
  });

  it("v3 database migrates to v4 additively with integrity ok", () => {
    const dbPath = tmpDb();
    let store = createMultiWorldStore(dbPath);
    createWorld(store, "w1", "create-1");
    store.acknowledgeObserverCheckpoint(ack("w1", "ack-1", 42, 5, 8));
    const eventsBefore = store.loadEvents("w1");
    store.close();

    // Simulate a v3 database: drop the v4 table and rewind the version.
    const db = new DatabaseSync(dbPath);
    db.exec("DROP TABLE observer_checkpoints");
    db.exec("PRAGMA user_version = 3");
    db.close();

    store = createMultiWorldStore(dbPath);
    expect(store.getObserverCheckpoint("w1", "player")).toBeNull();
    const r = store.acknowledgeObserverCheckpoint(ack("w1", "ack-2", 43, 9, 14));
    expect(r.changed).toBe(true);
    expect(store.loadEvents("w1")).toEqual(eventsBefore);
    store.close();

    const reopened = new DatabaseSync(dbPath);
    expect(reopened.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    expect(reopened.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    reopened.close();
  });
});
