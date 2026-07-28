// @ts-nocheck
import { describe, it, expect } from "vitest";
import { createInitialState, transition, APP, CMD, JOURNAL } from "../public/client-state.js";

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
});
