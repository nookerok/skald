import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSqliteStore } from "../src/persistence.js";

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "skald-test-"));
  return join(dir, "events.sqlite");
}

const testEvent = {
  eventId: "e-1",
  type: "TestEvent",
  schemaVersion: 1,
  payload: { key: "value", num: 42 },
  timestamp: 5,
  correlationId: "cmd-1",
  causationId: null,
};

describe("PersistenceStore", () => {
  it("empty DB loads empty events", () => {
    const store = createSqliteStore(tmpDb());
    expect(store.loadAll()).toEqual([]);
    store.close();
  });

  it("roundtrip single event", () => {
    const db = tmpDb();
    let store = createSqliteStore(db);
    store.commitBatch([testEvent]);
    store.close();

    store = createSqliteStore(db);
    const all = store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.eventId).toBe("e-1");
    expect(all[0]!.payload).toEqual({ key: "value", num: 42 });
    store.close();
  });

  it("preserves null causationId", () => {
    const db = tmpDb();
    const store = createSqliteStore(db);
    store.commitBatch([testEvent]);
    const all = store.loadAll();
    expect(all[0]!.causationId).toBeNull();
    store.close();
  });

  it("stored order matches insertion order", () => {
    const db = tmpDb();
    const store = createSqliteStore(db);
    store.commitBatch([
      { ...testEvent, eventId: "e-1" },
      { ...testEvent, eventId: "e-2" },
    ]);
    const all = store.loadAll();
    expect(all[0]!.eventId).toBe("e-1");
    expect(all[1]!.eventId).toBe("e-2");
    store.close();
  });

  it("duplicate eventId throws", () => {
    const db = tmpDb();
    const store = createSqliteStore(db);
    store.commitBatch([testEvent]);
    expect(() => store.commitBatch([testEvent])).toThrow();
    store.close();
  });

  it("empty batch is a no-op", () => {
    const db = tmpDb();
    const store = createSqliteStore(db);
    store.commitBatch([]);
    expect(store.loadAll()).toEqual([]);
    store.close();
  });

  it("processed request key roundtrip", () => {
    const db = tmpDb();
    const store = createSqliteStore(db);
    store.commitBatch([testEvent], { idempotencyKey: "key-1", requestKind: "command", correlationId: "cmd-1" });
    expect(store.hasProcessedKey("key-1")).toBe(true);
    expect(store.hasProcessedKey("unknown")).toBe(false);
    store.close();
  });

  it("reopen preserves processed key", () => {
    const db = tmpDb();
    let store = createSqliteStore(db);
    store.commitBatch([testEvent], { idempotencyKey: "key-1", requestKind: "command", correlationId: "cmd-1" });
    store.close();

    store = createSqliteStore(db);
    expect(store.hasProcessedKey("key-1")).toBe(true);
    store.close();
  });

  it("loadProcessedKeys returns set of keys", () => {
    const db = tmpDb();
    const store = createSqliteStore(db);
    store.commitBatch([testEvent], { idempotencyKey: "key-a", requestKind: "command", correlationId: "cmd-1" });
    store.commitBatch([{ ...testEvent, eventId: "e-2" }], { idempotencyKey: "key-b", requestKind: "wait", correlationId: "cmd-2" });
    const keys = store.loadProcessedKeys();
    expect(keys.has("key-a")).toBe(true);
    expect(keys.has("key-b")).toBe(true);
    expect(keys.size).toBe(2);
    store.close();
  });

  it("close does not throw on repeated call", () => {
    const store = createSqliteStore(tmpDb());
    store.close();
    store.close();
  });
});
