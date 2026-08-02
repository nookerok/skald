// presence-exit-state.js — deterministic graceful-return state machine.
// Pure reducer: no fetch, no storage, no timers. The exit controller
// performs the I/O implied by each phase.

export const EXIT_PHASE = {
  IDLE: "idle",
  LEAVE_REQUESTED: "leave_requested",
  FETCHING_CURRENT_SESSION: "fetching_current_session",
  ACKNOWLEDGING_EXIT: "acknowledging_exit",
  LEAVE_READY: "leave_ready",
  EXIT_ERROR: "exit_error",
  KNOWN_WORLDS: "known_worlds",
};

export const EXIT_ACTION = {
  LEAVE_START: "LEAVE_START",
  REVISION_FETCHING: "REVISION_FETCHING",
  REVISION_OK: "REVISION_OK",
  REVISION_FAIL: "REVISION_FAIL",
  ACK_START: "ACK_START",
  ACK_SUCCESS: "ACK_SUCCESS",
  ACK_TRANSPORT_FAIL: "ACK_TRANSPORT_FAIL",
  STALE_REVISION: "STALE_REVISION",
  CONFLICT: "CONFLICT",
  RETRY: "RETRY",
  STAY: "STAY",
  RESET: "RESET",
};

/** Honest loading phrases; each maps to exactly one reducer phase. */
export const EXIT_LOADING_TEXT = {
  [EXIT_PHASE.FETCHING_CURRENT_SESSION]: "Сверяем последнее состояние мира…",
  [EXIT_PHASE.ACKNOWLEDGING_EXIT]: "Сохраняем точку возвращения…",
};

export const EXIT_ERROR_TEXT = "Не удалось зафиксировать точку возвращения.";

/** Maximum number of automatic stale-revision refetches before manual retry. */
export const MAX_STALE_RETRIES = 1;

export function exitStorageKey(worldId) {
  return `skald:presence:exit-pending:1:${worldId}`;
}

export function parseExitPending(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.schemaVersion !== 1) return null;
  if (typeof parsed.worldId !== "string" || parsed.worldId.length === 0) return null;
  if (typeof parsed.idempotencyKey !== "string" || parsed.idempotencyKey.length === 0) return null;
  if (!Number.isSafeInteger(parsed.worldTime) || parsed.worldTime < 0) return null;
  if (!Number.isSafeInteger(parsed.eventNumber) || parsed.eventNumber < 0) return null;
  return parsed;
}

export function exitInitialState() {
  return {
    phase: EXIT_PHASE.IDLE,
    worldId: null,
    revision: null,
    idempotencyKey: null,
    staleRetries: 0,
    error: null,
  };
}

export function transitionExitState(state, action, payload = {}) {
  switch (action) {
    case EXIT_ACTION.LEAVE_START:
      if (state.phase !== EXIT_PHASE.IDLE && state.phase !== EXIT_PHASE.EXIT_ERROR) return state;
      return {
        ...exitInitialState(),
        phase: EXIT_PHASE.LEAVE_REQUESTED,
        worldId: payload.worldId || state.worldId,
      };

    case EXIT_ACTION.REVISION_FETCHING:
      if (state.phase !== EXIT_PHASE.LEAVE_REQUESTED) return state;
      return { ...state, phase: EXIT_PHASE.FETCHING_CURRENT_SESSION, error: null };

    case EXIT_ACTION.REVISION_OK:
      if (state.phase !== EXIT_PHASE.FETCHING_CURRENT_SESSION) return state;
      return {
        ...state,
        phase: EXIT_PHASE.ACKNOWLEDGING_EXIT,
        revision: {
          worldTime: payload.worldTime,
          eventNumber: payload.eventNumber,
        },
        idempotencyKey: payload.key || null,
        error: null,
      };

    case EXIT_ACTION.REVISION_FAIL:
      if (state.phase !== EXIT_PHASE.FETCHING_CURRENT_SESSION) return state;
      return {
        ...state,
        phase: EXIT_PHASE.EXIT_ERROR,
        error: { stage: "revision", message: payload.message || EXIT_ERROR_TEXT },
      };

    case EXIT_ACTION.ACK_START:
      if (state.phase !== EXIT_PHASE.ACKNOWLEDGING_EXIT) return state;
      return { ...state, error: null };

    case EXIT_ACTION.ACK_SUCCESS:
      if (state.phase !== EXIT_PHASE.ACKNOWLEDGING_EXIT) return state;
      return { ...state, phase: EXIT_PHASE.LEAVE_READY, error: null };

    case EXIT_ACTION.ACK_TRANSPORT_FAIL:
      if (state.phase !== EXIT_PHASE.ACKNOWLEDGING_EXIT) return state;
      // Keep the key and revision: the retry must reuse the same body.
      return { ...state, phase: EXIT_PHASE.EXIT_ERROR, error: { stage: "ack", message: payload.message || EXIT_ERROR_TEXT } };

    case EXIT_ACTION.STALE_REVISION:
      if (state.phase !== EXIT_PHASE.ACKNOWLEDGING_EXIT) return state;
      if (state.staleRetries < MAX_STALE_RETRIES) {
        return {
          ...state,
          phase: EXIT_PHASE.LEAVE_REQUESTED,
          revision: null,
          idempotencyKey: null,
          staleRetries: state.staleRetries + 1,
        };
      }
      return { ...state, phase: EXIT_PHASE.EXIT_ERROR, error: { stage: "stale", message: EXIT_ERROR_TEXT } };

    case EXIT_ACTION.CONFLICT:
      if (state.phase !== EXIT_PHASE.ACKNOWLEDGING_EXIT) return state;
      return { ...state, phase: EXIT_PHASE.EXIT_ERROR, error: { stage: "conflict", message: EXIT_ERROR_TEXT } };

    case EXIT_ACTION.RETRY:
      if (state.phase !== EXIT_PHASE.EXIT_ERROR) return state;
      return { ...exitInitialState(), phase: EXIT_PHASE.LEAVE_REQUESTED, worldId: state.worldId };

    case EXIT_ACTION.STAY:
      if (state.phase === EXIT_PHASE.IDLE || state.phase === EXIT_PHASE.LEAVE_READY) return state;
      return exitInitialState();

    case EXIT_ACTION.RESET:
      return exitInitialState();

    default:
      return state;
  }
}
