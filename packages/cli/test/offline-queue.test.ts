// @ts-nocheck
import { describe, it, expect } from "vitest";
import {
  parseStoredQueue,
  trimQueue,
  readQueue,
  writeQueue,
  enqueueOfflineIntent,
  removeProcessed,
  countQueued,
  storageKey,
  MAX_QUEUED_INTENTS,
} from "../public/offline-queue.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function envelope(input, idempotencyKey, baseRevision) {
  return { input, idempotencyKey, baseRevision };
}

describe("offline-queue storage helpers", () => {
  it("parses empty or corrupt storage as an empty queue", () => {
    expect(parseStoredQueue(null)).toEqual([]);
    expect(parseStoredQueue("")).toEqual([]);
    expect(parseStoredQueue("not json")).toEqual([]);
    expect(parseStoredQueue('{"a":1}')).toEqual([]);
  });

  it("drops malformed envelopes during parsing", () => {
    const raw = JSON.stringify([
      { input: "examine cart", idempotencyKey: "k1", baseRevision: 6 },
      { input: "", idempotencyKey: "k2", baseRevision: 6 },
      { input: "examine cart", idempotencyKey: "", baseRevision: 6 },
      { input: "examine cart", idempotencyKey: "k3", baseRevision: -1 },
      { input: "examine cart", idempotencyKey: "k4", baseRevision: 1.5 },
      "junk",
    ]);
    expect(parseStoredQueue(raw).map((i) => i.idempotencyKey)).toEqual(["k1"]);
  });

  it("keeps only the newest envelopes when trimming", () => {
    const q = [envelope("a", "k1", 1), envelope("b", "k2", 2), envelope("c", "k3", 3)];
    expect(trimQueue(q, 2).map((i) => i.idempotencyKey)).toEqual(["k2", "k3"]);
    expect(trimQueue(q).length).toBe(3);
  });

  it("enqueues and reads back via injected storage", () => {
    const store = memoryStorage();
    enqueueOfflineIntent("w1", envelope("examine cart", "k1", 6), store);
    expect(readQueue("w1", store).map((i) => i.input)).toEqual(["examine cart"]);
    expect(countQueued("w1", store)).toBe(1);
    expect(writeQueue("w1", [], store)).toBe(true);
    expect(countQueued("w1", store)).toBe(0);
  });

  it("replaces an envelope with the same idempotency key", () => {
    const store = memoryStorage();
    enqueueOfflineIntent("w1", envelope("examine cart", "k1", 6), store);
    enqueueOfflineIntent("w1", envelope("examine cart", "k1", 9), store);
    const queue = readQueue("w1", store);
    expect(queue).toHaveLength(1);
    expect(queue[0].baseRevision).toBe(9);
  });

  it("bounds the queue at MAX_QUEUED_INTENTS, dropping the oldest", () => {
    const store = memoryStorage();
    for (let i = 0; i < MAX_QUEUED_INTENTS + 3; i++) {
      enqueueOfflineIntent("w1", envelope(`intent-${i}`, `k-${i}`, i), store);
    }
    const queue = readQueue("w1", store);
    expect(queue).toHaveLength(MAX_QUEUED_INTENTS);
    expect(queue[0].idempotencyKey).toBe("k-3");
  });

  it("removes processed keys only", () => {
    const store = memoryStorage();
    enqueueOfflineIntent("w1", envelope("a", "k1", 1), store);
    enqueueOfflineIntent("w1", envelope("b", "k2", 2), store);
    removeProcessed("w1", ["k1"], store);
    expect(readQueue("w1", store).map((i) => i.idempotencyKey)).toEqual(["k2"]);
    expect(readQueue("w2", store)).toEqual([]);
  });

  it("degrades gracefully without localStorage", () => {
    expect(readQueue("w1", null)).toEqual([]);
    expect(writeQueue("w1", [envelope("a", "k1", 1)], null)).toBe(false);
    expect(countQueued("w1", null)).toBe(0);
  });

  it("uses a per-world storage key", () => {
    expect(storageKey("w1")).toBe("skald:offline-queue:w1");
    expect(storageKey("w2")).not.toBe(storageKey("w1"));
  });
});
