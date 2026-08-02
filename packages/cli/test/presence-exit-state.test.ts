// @ts-nocheck
import { describe, it, expect } from "vitest";
import {
  EXIT_PHASE,
  EXIT_ACTION,
  EXIT_LOADING_TEXT,
  EXIT_ERROR_TEXT,
  MAX_STALE_RETRIES,
  exitInitialState,
  exitStorageKey,
  parseExitPending,
  transitionExitState,
} from "../public/presence-exit-state.js";

function leaving(worldId = "w1") {
  return transitionExitState(exitInitialState(), EXIT_ACTION.LEAVE_START, { worldId });
}

function fetching(worldId = "w1") {
  return transitionExitState(leaving(worldId), EXIT_ACTION.REVISION_FETCHING);
}

function revising(worldId = "w1", key = "exit-1") {
  return transitionExitState(fetching(worldId), EXIT_ACTION.REVISION_OK, { key, worldTime: 42, eventNumber: 7 });
}

describe("presence-exit-state.js", () => {
  it("starts idle and only LEAVE_START begins the flow", () => {
    expect(exitInitialState().phase).toBe(EXIT_PHASE.IDLE);
    const s = leaving();
    expect(s.phase).toBe(EXIT_PHASE.LEAVE_REQUESTED);
    expect(s.worldId).toBe("w1");
  });

  it("REVISION_FETCHING is the honest session-sync phase", () => {
    const s = fetching();
    expect(s.phase).toBe(EXIT_PHASE.FETCHING_CURRENT_SESSION);
  });

  it("REVISION_OK pins the key and revision for the acknowledge", () => {
    const s = revising();
    expect(s.phase).toBe(EXIT_PHASE.ACKNOWLEDGING_EXIT);
    expect(s.idempotencyKey).toBe("exit-1");
    expect(s.revision).toEqual({ worldTime: 42, eventNumber: 7 });
  });

  it("REVISION_FAIL is a controlled error, never a crash", () => {
    const s = transitionExitState(fetching(), EXIT_ACTION.REVISION_FAIL);
    expect(s.phase).toBe(EXIT_PHASE.EXIT_ERROR);
    expect(s.error.stage).toBe("revision");
  });

  it("ACK_SUCCESS means the leave is ready; the lease is a controller concern", () => {
    const s = transitionExitState(revising(), EXIT_ACTION.ACK_SUCCESS);
    expect(s.phase).toBe(EXIT_PHASE.LEAVE_READY);
    expect(s.error).toBeNull();
  });

  it("ACK_TRANSPORT_FAIL keeps the key and revision for a same-body retry", () => {
    let s = transitionExitState(revising(), EXIT_ACTION.ACK_TRANSPORT_FAIL);
    expect(s.phase).toBe(EXIT_PHASE.EXIT_ERROR);
    expect(s.error.stage).toBe("ack");
    expect(s.idempotencyKey).toBe("exit-1");
    expect(s.revision).toEqual({ worldTime: 42, eventNumber: 7 });
    // RETRY restarts the fetch cycle, so the same revision is refetched fresh.
    s = transitionExitState(s, EXIT_ACTION.RETRY);
    expect(s.phase).toBe(EXIT_PHASE.LEAVE_REQUESTED);
    expect(s.worldId).toBe("w1");
    expect(s.revision).toBeNull();
  });

  it("STALE_REVISION auto-refetches at most once, then fails manually", () => {
    let s = transitionExitState(revising(), EXIT_ACTION.STALE_REVISION);
    expect(s.phase).toBe(EXIT_PHASE.LEAVE_REQUESTED);
    expect(s.staleRetries).toBe(1);
    expect(s.idempotencyKey).toBeNull();
    s = transitionExitState(transitionExitState(s, EXIT_ACTION.REVISION_FETCHING), EXIT_ACTION.REVISION_OK, { key: "exit-2", worldTime: 43, eventNumber: 8 });
    s = transitionExitState(s, EXIT_ACTION.STALE_REVISION);
    expect(s.phase).toBe(EXIT_PHASE.EXIT_ERROR);
    expect(s.error.stage).toBe("stale");
    // The counter only counts successful automatic retries; the second
    // staleness fails without consuming another retry.
    expect(s.staleRetries).toBe(1);
    expect(MAX_STALE_RETRIES).toBe(1);
  });

  it("CONFLICT is terminal and never reuses the key", () => {
    const s = transitionExitState(revising(), EXIT_ACTION.CONFLICT);
    expect(s.phase).toBe(EXIT_PHASE.EXIT_ERROR);
    expect(s.error.stage).toBe("conflict");
  });

  it("STAY cancels the flow from any in-flight phase", () => {
    const s = transitionExitState(revising(), EXIT_ACTION.STAY);
    expect(s).toEqual(exitInitialState());
    expect(transitionExitState(exitInitialState(), EXIT_ACTION.STAY).phase).toBe(EXIT_PHASE.IDLE);
  });

  it("maps honest loading phrases to their phases only", () => {
    expect(EXIT_LOADING_TEXT[EXIT_PHASE.FETCHING_CURRENT_SESSION]).toBe("Сверяем последнее состояние мира…");
    expect(EXIT_LOADING_TEXT[EXIT_PHASE.ACKNOWLEDGING_EXIT]).toBe("Сохраняем точку возвращения…");
    expect(EXIT_ERROR_TEXT).toBe("Не удалось зафиксировать точку возвращения.");
  });

  it("derives the durable exit key from the world id", () => {
    expect(exitStorageKey("w1")).toBe("skald:presence:exit-pending:1:w1");
  });

  it("parseExitPending accepts only valid schema-1 pending records", () => {
    const valid = { schemaVersion: 1, worldId: "w1", idempotencyKey: "k", worldTime: 3, eventNumber: 4 };
    expect(parseExitPending(JSON.stringify(valid))).toEqual(valid);
    expect(parseExitPending(null)).toBeNull();
    expect(parseExitPending("not json")).toBeNull();
    expect(parseExitPending(JSON.stringify({ ...valid, schemaVersion: 2 }))).toBeNull();
    expect(parseExitPending(JSON.stringify({ ...valid, worldId: "" }))).toBeNull();
    expect(parseExitPending(JSON.stringify({ ...valid, worldTime: -1 }))).toBeNull();
    expect(parseExitPending(JSON.stringify({ ...valid, idempotencyKey: "" }))).toBeNull();
  });
});
