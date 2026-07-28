// @ts-nocheck
import { describe, it, expect } from "vitest";
import { createInitialState, transition, APP, CMD, JOURNAL, DISCOVERIES, GUIDANCE } from "../public/client-state.js";

describe("client-state transitions", () => {
  it("initial state is booting", () => {
    const s = createInitialState();
    expect(s.application).toBe(APP.BOOTING);
    expect(s.command).toBe(CMD.IDLE);
  });

  it("BOOT_SUCCESS transitions to ready", () => {
    const s = createInitialState();
    const next = transition(s, "BOOT_SUCCESS", { turns: 1 });
    expect(next.application).toBe(APP.READY);
    expect(next.journal).toBe(JOURNAL.AVAILABLE);
  });

  it("BOOT_SUCCESS with zero turns sets journal EMPTY", () => {
    const s = createInitialState();
    const next = transition(s, "BOOT_SUCCESS", { turns: 0 });
    expect(next.journal).toBe(JOURNAL.EMPTY);
  });

  it("COMMAND_START sets PENDING and stores key/input", () => {
    const s = createInitialState();
    const next = transition(s, "COMMAND_START", { input: "move north", key: "k-1" });
    expect(next.command).toBe(CMD.PENDING);
    expect(next.pendingKey).toBe("k-1");
    expect(next.pendingInput).toBe("move north");
  });

  it("COMMAND_START is ignored during PENDING", () => {
    const s = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const next = transition(s, "COMMAND_START", { input: "b", key: "k2" });
    expect(next.pendingInput).toBe("a"); // unchanged
  });

  it("COMMAND_SUCCESS resets pending fields", () => {
    const s = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const next = transition(s, "COMMAND_SUCCESS");
    expect(next.command).toBe(CMD.SUCCEEDED);
    expect(next.pendingKey).toBeNull();
    expect(next.pendingInput).toBeNull();
  });

  it("COMMAND_REJECTED resets pending fields", () => {
    const s = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const next = transition(s, "COMMAND_REJECTED", { message: "no" });
    expect(next.command).toBe(CMD.REJECTED);
    expect(next.pendingKey).toBeNull();
  });

  it("COMMAND_TIMEOUT does not clear pending fields for retry", () => {
    const s = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const next = transition(s, "COMMAND_TIMEOUT");
    expect(next.command).toBe(CMD.TIMEOUT);
    expect(next.pendingKey).toBe("k1"); // preserved for retry
  });

  it("DUPLICATE does not clear pending fields", () => {
    const s = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const next = transition(s, "COMMAND_DUPLICATE");
    expect(next.command).toBe(CMD.DUPLICATE);
  });

  it("DISCONNECTED sets application state", () => {
    const s = transition(createInitialState(), "DISCONNECTED");
    expect(s.application).toBe(APP.DISCONNECTED);
  });

  it("RECONNECT_SUCCESS returns to READY", () => {
    const s = transition(createInitialState(), "RECONNECT_SUCCESS", { turns: 1 });
    expect(s.application).toBe(APP.READY);
  });

  it("SET_VIEW updates activeView", () => {
    const s = transition(createInitialState(), "SET_VIEW", "journal");
    expect(s.activeView).toBe("journal");
  });

  it("COMMAND_TRANSPORT_FAIL preserves pending fields for retry", () => {
    const s = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const next = transition(s, "COMMAND_TRANSPORT_FAIL");
    expect(next.command).toBe(CMD.TRANSPORT_FAILED);
    expect(next.pendingKey).toBe("k1");
    expect(next.pendingInput).toBe("a");
  });

  it("TIMEOUT preserves key (retry possible), REJECTED clears key (game rejection)", () => {
    const pending = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const timeout = transition(pending, "COMMAND_TIMEOUT");
    const rejected = transition(pending, "COMMAND_REJECTED");
    expect(timeout.pendingKey).toBe("k1");
    expect(rejected.pendingKey).toBeNull();
  });

  it("RECONNECT_SUCCESS resets command to IDLE", () => {
    const s = transition(createInitialState(), "COMMAND_START", { input: "a", key: "k1" });
    const reconnected = transition(s, "RECONNECT_SUCCESS", { turns: 1 });
    expect(reconnected.application).toBe(APP.READY);
    expect(reconnected.command).toBe(CMD.IDLE);
  });

  it("JOURNAL_LOADING transition", () => {
    const s = transition(createInitialState(), "JOURNAL_LOADING");
    expect(s.journal).toBe(JOURNAL.LOADING);
  });

  it("JOURNAL_STALE transition", () => {
    const s = transition(createInitialState(), "JOURNAL_STALE");
    expect(s.journal).toBe(JOURNAL.STALE);
  });

  it("JOURNAL_UNAVAILABLE transition", () => {
    const s = transition(createInitialState(), "JOURNAL_UNAVAILABLE");
    expect(s.journal).toBe(JOURNAL.UNAVAILABLE);
  });

  it("JOURNAL_AVAILABLE with zero turns sets EMPTY", () => {
    const s = transition(createInitialState(), "JOURNAL_AVAILABLE", { turns: 0 });
    expect(s.journal).toBe(JOURNAL.EMPTY);
  });

  it("SET_THREAD updates activeThread", () => {
    const s = transition(createInitialState(), "SET_THREAD", "movement");
    expect(s.activeThread).toBe("movement");
  });

  it("SET_MESSAGE updates lastPlayerMessage", () => {
    const s = transition(createInitialState(), "SET_MESSAGE", "Мир ответил.");
    expect(s.lastPlayerMessage).toBe("Мир ответил.");
  });

  it("DISCOVERIES_LOADING transition", () => {
    const s = transition(createInitialState(), "DISCOVERIES_LOADING");
    expect(s.discoveries).toBe(DISCOVERIES.LOADING);
  });

  it("DISCOVERIES_AVAILABLE with cards sets AVAILABLE", () => {
    const s = transition(createInitialState(), "DISCOVERIES_AVAILABLE", { cards: 1 });
    expect(s.discoveries).toBe(DISCOVERIES.AVAILABLE);
  });

  it("DISCOVERIES_AVAILABLE with 0 cards sets EMPTY", () => {
    const s = transition(createInitialState(), "DISCOVERIES_AVAILABLE", { cards: 0 });
    expect(s.discoveries).toBe(DISCOVERIES.EMPTY);
  });

  it("DISCOVERIES_STALE transition", () => {
    const s = transition(createInitialState(), "DISCOVERIES_STALE");
    expect(s.discoveries).toBe(DISCOVERIES.STALE);
  });

  it("DISCOVERIES_UNAVAILABLE transition", () => {
    const s = transition(createInitialState(), "DISCOVERIES_UNAVAILABLE");
    expect(s.discoveries).toBe(DISCOVERIES.UNAVAILABLE);
  });

  it("GUIDANCE_LOADING transition", () => {
    const s = transition(createInitialState(), "GUIDANCE_LOADING");
    expect(s.guidance).toBe(GUIDANCE.LOADING);
  });

  it("GUIDANCE_AVAILABLE transition", () => {
    const s = transition(createInitialState(), "GUIDANCE_AVAILABLE");
    expect(s.guidance).toBe(GUIDANCE.AVAILABLE);
  });

  it("GUIDANCE_FREE_PLAY transition", () => {
    const s = transition(createInitialState(), "GUIDANCE_FREE_PLAY");
    expect(s.guidance).toBe(GUIDANCE.FREE_PLAY);
  });

  it("GUIDANCE_STALE transition", () => {
    const s = transition(createInitialState(), "GUIDANCE_STALE");
    expect(s.guidance).toBe(GUIDANCE.STALE);
  });

  it("GUIDANCE_UNAVAILABLE transition", () => {
    const s = transition(createInitialState(), "GUIDANCE_UNAVAILABLE");
    expect(s.guidance).toBe(GUIDANCE.UNAVAILABLE);
  });
});
