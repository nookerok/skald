// @ts-nocheck
import { describe, it, expect } from "vitest";
import {
  PHASE,
  ACTION,
  LOADING_TEXT,
  initialState,
  ackStorageKey,
  transitionPresenceEntry,
} from "../public/presence-entry-state.js";

const session = { revision: { worldTime: 4, eventNumber: 5 }, presence: { drift: { level: "low" } }, checkpointState: "missing" };
const summary = { schemaVersion: 1, worldId: "w", presenceStatus: "Ты ещё не входил в этот мир." };

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
    const s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    expect(s.phase).toBe(PHASE.REQUESTING_SESSION);
    expect(s.worldId).toBe("w");
  });

  it("SESSION_OK moves to the presence montage with the session stored", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    expect(s.phase).toBe(PHASE.PRESENCE);
    expect(s.session).toBe(session);
    expect(s.summary).toBe(summary);
    expect(s.error).toBeNull();
  });

  it("SESSION_FAIL is a retryable error, not a crash", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_FAIL, { message: "сеть" });
    expect(s.phase).toBe(PHASE.RETRYABLE_ERROR);
    expect(s.error.code).toBe("session_transport");
  });

  it("PRESENCE_RENDERED moves to the focus screen", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    expect(s.phase).toBe(PHASE.FOCUS);
  });

  it("ACK_START enters acknowledging and keeps the pending key", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    expect(s.phase).toBe(PHASE.ACKNOWLEDGING);
    expect(s.ackKey).toBe("ack-1");
  });

  it("ACK_SUCCESS is ready and clears the pending key", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.ACK_SUCCESS, { checkpoint: { worldId: "w" } });
    expect(s.phase).toBe(PHASE.READY);
    expect(s.ackKey).toBeNull();
    expect(s.checkpoint.worldId).toBe("w");
  });

  it("ACK_FAIL keeps the durable key for a same-key retry", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.ACK_FAIL, { message: "сеть" });
    expect(s.phase).toBe(PHASE.RETRYABLE_ERROR);
    expect(s.ackKey).toBe("ack-1");
    expect(s.error.code).toBe("ack_transport");
  });

  it("retrying after ack failure resumes with the same key", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.ACK_FAIL);
    s = transitionPresenceEntry(s, ACTION.ACK_START);
    expect(s.phase).toBe(PHASE.ACKNOWLEDGING);
    expect(s.ackKey).toBe("ack-1");
  });

  it("STALE_REVISION drops the pending key; no automatic re-ack", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.STALE_REVISION);
    expect(s.phase).toBe(PHASE.STALE_REVISION);
    expect(s.ackKey).toBeNull();
    expect(s.error.code).toBe("stale_revision");
  });

  it("DUPLICATE_REQUEST is a controlled error that also reloads, never re-uses the key", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.DUPLICATE_REQUEST);
    expect(s.phase).toBe(PHASE.STALE_REVISION);
    expect(s.ackKey).toBeNull();
    expect(s.error.code).toBe("duplicate_request");
  });

  it("RELOAD_SESSION re-requests the session after staleness", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.STALE_REVISION);
    s = transitionPresenceEntry(s, ACTION.RELOAD_SESSION);
    expect(s.phase).toBe(PHASE.REQUESTING_SESSION);
    expect(s.session).toBeNull();
  });

  it("UNAVAILABLE is a terminal phase with an honest message", () => {
    const s = transitionPresenceEntry(initialState(), ACTION.UNAVAILABLE);
    expect(s.phase).toBe(PHASE.UNAVAILABLE);
    expect(s.error.code).toBe("unavailable");
  });

  it("RESET returns to the idle state", () => {
    let s = transitionPresenceEntry(initialState(), ACTION.ENTER, { worldId: "w" });
    s = transitionPresenceEntry(s, ACTION.SESSION_OK, { session, summary });
    s = transitionPresenceEntry(s, ACTION.PRESENCE_RENDERED);
    s = transitionPresenceEntry(s, ACTION.ACK_START, { key: "ack-1" });
    s = transitionPresenceEntry(s, ACTION.RESET);
    expect(s).toEqual(initialState());
  });

  it("exposes the single truthful loading phrase", () => {
    expect(LOADING_TEXT).toBe("Восстанавливаем твоё присутствие…");
  });

  it("derives the durable storage key from the world id", () => {
    expect(ackStorageKey("world-x")).toBe("skald:presence-ack:1:world-x");
  });
});
