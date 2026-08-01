// presence-entry-state.js — deterministic entry state machine for the
// "Return to a Living World" path. Pure reducer: no fetch, no timers, no
// storage side effects here. The controller drives it with actions and
// performs the I/O implied by each phase.

export const PHASE = {
  IDLE: "idle",
  REQUESTING_SESSION: "requesting_session",
  PRESENCE: "presence",
  FOCUS: "focus",
  ACKNOWLEDGING: "acknowledging",
  READY: "ready",
  RETRYABLE_ERROR: "retryable_error",
  STALE_REVISION: "stale_revision",
  UNAVAILABLE: "unavailable",
};

export const ACTION = {
  ENTER: "ENTER",
  SESSION_OK: "SESSION_OK",
  SESSION_FAIL: "SESSION_FAIL",
  PRESENCE_RENDERED: "PRESENCE_RENDERED",
  ACK_START: "ACK_START",
  ACK_SUCCESS: "ACK_SUCCESS",
  ACK_FAIL: "ACK_FAIL",
  STALE_REVISION: "STALE_REVISION",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  RELOAD_SESSION: "RELOAD_SESSION",
  UNAVAILABLE: "UNAVAILABLE",
  RESET: "RESET",
};

/** The single truthful loading phrase used on every entry wait. */
export const LOADING_TEXT = "Восстанавливаем твоё присутствие…";

export function initialState() {
  return {
    phase: PHASE.IDLE,
    worldId: null,
    session: null,
    summary: null,
    error: null,
    ackKey: null,
    checkpoint: null,
  };
}

export function ackStorageKey(worldId) {
  return `skald:presence-ack:1:${worldId}`;
}

export function transitionPresenceEntry(state, action, payload = {}) {
  switch (action) {
    case ACTION.ENTER:
      return { ...initialState(), phase: PHASE.REQUESTING_SESSION, worldId: payload.worldId || null };

    case ACTION.SESSION_OK:
      if (state.phase !== PHASE.REQUESTING_SESSION) return state;
      return {
        ...state,
        phase: PHASE.PRESENCE,
        session: payload.session || null,
        summary: payload.summary || null,
        error: null,
      };

    case ACTION.SESSION_FAIL:
      if (state.phase !== PHASE.REQUESTING_SESSION) return state;
      return { ...state, phase: PHASE.RETRYABLE_ERROR, error: { code: "session_transport", message: payload.message || "Не удалось восстановить присутствие." } };

    case ACTION.PRESENCE_RENDERED:
      if (state.phase !== PHASE.PRESENCE) return state;
      return { ...state, phase: PHASE.FOCUS };

    case ACTION.ACK_START:
      if (state.phase === PHASE.ACKNOWLEDGING) return state;
      return { ...state, phase: PHASE.ACKNOWLEDGING, ackKey: payload.key || state.ackKey, error: null };

    case ACTION.ACK_SUCCESS:
      if (state.phase !== PHASE.ACKNOWLEDGING) return state;
      return { ...state, phase: PHASE.READY, ackKey: null, checkpoint: payload.checkpoint || null, error: null };

    case ACTION.ACK_FAIL:
      if (state.phase !== PHASE.ACKNOWLEDGING) return state;
      return { ...state, phase: PHASE.RETRYABLE_ERROR, error: { code: "ack_transport", message: payload.message || "Не удалось подтвердить присутствие." } };

    case ACTION.STALE_REVISION:
      return { ...state, phase: PHASE.STALE_REVISION, ackKey: null, error: { code: "stale_revision", message: payload.message || "Мир успел измениться." } };

    case ACTION.DUPLICATE_REQUEST:
      return { ...state, phase: PHASE.STALE_REVISION, ackKey: null, error: { code: "duplicate_request", message: payload.message || "Запрос уже был обработан." } };

    case ACTION.RELOAD_SESSION:
      if (state.phase !== PHASE.STALE_REVISION && state.phase !== PHASE.RETRYABLE_ERROR) return state;
      return { ...state, phase: PHASE.REQUESTING_SESSION, session: null, summary: null, error: null };

    case ACTION.UNAVAILABLE:
      return { ...state, phase: PHASE.UNAVAILABLE, error: { code: "unavailable", message: payload.message || "Мир сейчас недоступен." } };

    case ACTION.RESET:
      return initialState();

    default:
      return state;
  }
}
