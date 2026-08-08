// @ts-nocheck
import { describe, it, expect } from "vitest";
import {
  PHASE,
  ACTION,
  LOADING_TEXT,
  ACK_LOADING_TEXT,
  loadingTextForPhase,
  initialState,
  ackStorageKey,
  transitionPresenceEntry,
} from "../public/presence-entry-state.js";

const session = { revision: { worldTime: 4, eventNumber: 5 }, presence: { drift: { level: "low" } }, checkpointState: "missing" };
const summary = { schemaVersion: 1, worldId: "w", presenceStatus: "Мир кажется таким, каким ты его помнишь." };

function entered(s = initialState(), worldId = "w") {
  return transitionPresenceEntry(s, ACTION.ENTER, { worldId });
}

function onPresence() {
  return transitionPresenceEntry(entered(), ACTION.SESSION_OK, { session, summary });
}


describe("presence-entry-state.js", () => {
  it("starts idle with no entry artifacts", () => {
    const s = initialState();
    expect(s.phase).toBe(PHASE.IDLE);
    expect(s.worldId).toBeNull();
    expect(s.session).toBeNull();
    expect(s.ackKey).toBeNull();
    expect(s.error).toBeNull();
  });

  it("ENTER starts requesting the observer session for the world", () => {
    const s = entered();
    expect(s.phase).toBe(PHASE.REQUESTING_SESSION);
    expect(s.worldId).toBe("w");
  });

  it("SESSION_OK moves to the presence montage with the session stored", () => {
    const s = onPresence();
    expect(s.phase).toBe(PHASE.PRESENCE);
    expect(s.session).toBe(session);
    expect(s.summary).toBe(summary);
    expect(s.error).toBeNull();
  });

  it("SESSION_FAIL is a retryable error, not a crash", () => {
    const s = transitionPresenceEntry(entered(), ACTION.SESSION_FAIL, { message: "сеть" });
    expect(s.phase).toBe(PHASE.RETRYABLE_ERROR);
    expect(s.error.code).toBe("session_transport");
  });

  it("the unified presence surface accepts the primary acknowledge action", () => {
    const s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    expect(s.phase).toBe(PHASE.ACKNOWLEDGING_ENTRY);
    expect(s.ackKey).toBe("ack-1");
  });

  it("ACK_START enters acknowledging and keeps the pending key", () => {
    const s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    expect(s.phase).toBe(PHASE.ACKNOWLEDGING_ENTRY);
    expect(s.ackKey).toBe("ack-1");
  });

  it("ACK_START can resume a durable pending acknowledge during a reload", () => {
    const s = transitionPresenceEntry(entered(), ACTION.ACK_START, { key: "ack-1" });
    expect(s.phase).toBe(PHASE.ACKNOWLEDGING_ENTRY);
    expect(s.ackKey).toBe("ack-1");
  });

  it("ACK_START re-acknowledges with the same durable key after a transport failure", () => {
    let s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.ACK_FAIL, { message: "сеть" });
    expect(s.phase).toBe(PHASE.RETRYABLE_ERROR);
    expect(s.ackKey).toBe("ack-1");
    s = transitionPresenceEntry(s, ACTION.ACK_START);
    expect(s.phase).toBe(PHASE.ACKNOWLEDGING_ENTRY);
    expect(s.ackKey).toBe("ack-1");
  });

  it("ACK_SUCCESS is ready, clears the pending key and keeps the checkpoint", () => {
    let s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.ACK_SUCCESS, { checkpoint: { worldId: "w" } });
    expect(s.phase).toBe(PHASE.READY);
    expect(s.ackKey).toBeNull();
    expect(s.checkpoint.worldId).toBe("w");
  });

  it("ACK_FAIL keeps the durable key for a same-key retry", () => {
    let s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.ACK_FAIL, { message: "сеть" });
    expect(s.phase).toBe(PHASE.RETRYABLE_ERROR);
    expect(s.ackKey).toBe("ack-1");
    expect(s.error.code).toBe("ack_transport");
  });

  it("STALE_REVISION drops the pending key; no automatic re-ack", () => {
    let s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.STALE_REVISION);
    expect(s.phase).toBe(PHASE.STALE_REVISION);
    expect(s.ackKey).toBeNull();
    expect(s.error.code).toBe("stale_revision");
  });

  it("DUPLICATE_REQUEST is a controlled error that also reloads, never re-uses the key", () => {
    let s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.DUPLICATE_REQUEST);
    expect(s.phase).toBe(PHASE.STALE_REVISION);
    expect(s.ackKey).toBeNull();
    expect(s.error.code).toBe("duplicate_request");
  });

  it("RELOAD_SESSION re-requests the session after staleness", () => {
    let s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.STALE_REVISION);
    s = transitionPresenceEntry(s, ACTION.RELOAD_SESSION);
    expect(s.phase).toBe(PHASE.REQUESTING_SESSION);
    expect(s.session).toBeNull();
    expect(s.summary).toBeNull();
  });

  it("UNAVAILABLE is a terminal phase with an honest message", () => {
    const s = transitionPresenceEntry(initialState(), ACTION.UNAVAILABLE);
    expect(s.phase).toBe(PHASE.UNAVAILABLE);
    expect(s.error.code).toBe("unavailable");
  });

  it("RESET returns to the idle state", () => {
    let s = transitionPresenceEntry(onPresence(), ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.RESET);
    expect(s).toEqual(initialState());
  });

  it("exposes the two honest loading phrases mapped to phases", () => {
    expect(LOADING_TEXT).toBe("Восстанавливаем твои наблюдения…");
    expect(ACK_LOADING_TEXT).toBe("Подтверждаем твоё присутствие…");
    expect(loadingTextForPhase(PHASE.REQUESTING_SESSION)).toBe(LOADING_TEXT);
    expect(loadingTextForPhase(PHASE.ACKNOWLEDGING_ENTRY)).toBe(ACK_LOADING_TEXT);
    expect(loadingTextForPhase(PHASE.PRESENCE)).toBe(LOADING_TEXT);
  });

  it("derives the durable storage key from the world id", () => {
    expect(ackStorageKey("world-x")).toBe("skald:presence-ack:1:world-x");
  });
});
