// presence-entry-state.js — one unified entry surface for a living world.
export const PHASE = {
  IDLE: "idle",
  REQUESTING_SESSION: "requesting_session",
  PRESENCE: "presence",
  FOCUS: "focus",
  ACKNOWLEDGING_ENTRY: "acknowledging_entry",
  READY: "ready",
  RETRYABLE_ERROR: "retryable_error",
  STALE_REVISION: "stale_revision",
  UNAVAILABLE: "unavailable",
};
export const ACTION = {
  ENTER: "ENTER",
  SESSION_OK: "SESSION_OK",
  SESSION_FAIL: "SESSION_FAIL",
  PRESENCE_CONTINUE: "PRESENCE_CONTINUE",
  ACK_START: "ACK_START",
  ACK_SUCCESS: "ACK_SUCCESS",
  ACK_FAIL: "ACK_FAIL",
  STALE_REVISION: "STALE_REVISION",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  RELOAD_SESSION: "RELOAD_SESSION",
  UNAVAILABLE: "UNAVAILABLE",
  RESET: "RESET",
};
export const LOADING_TEXT = "Восстанавливаем твои наблюдения…";
export const ACK_LOADING_TEXT = "Подтверждаем твоё присутствие…";
export function loadingTextForPhase(phase) {
  return phase === PHASE.ACKNOWLEDGING_ENTRY ? ACK_LOADING_TEXT : LOADING_TEXT;
}
export function initialState() {
  return { phase: PHASE.IDLE, worldId: null, session: null, summary: null, error: null, ackKey: null, checkpoint: null };
}
export function ackStorageKey(worldId) {
  return "skald:presence-ack:1:" + worldId;
}
export function transitionPresenceEntry(state, action, payload = {}) {
  switch (action) {
    case ACTION.ENTER:
      return { ...initialState(), phase: PHASE.REQUESTING_SESSION, worldId: payload.worldId || null };
    case ACTION.SESSION_OK:
      if (state.phase !== PHASE.REQUESTING_SESSION) return state;
      return { ...state, phase: PHASE.PRESENCE, session: payload.session || null, summary: payload.summary || null, error: null };
    case ACTION.SESSION_FAIL:
      if (state.phase !== PHASE.REQUESTING_SESSION) return state;
      return { ...state, phase: PHASE.RETRYABLE_ERROR, error: { code: "session_transport", message: payload.message || "Не удалось открыть мир." } };
    // Kept as a compatibility action for old callers; the unified screen never dispatches it.
    case ACTION.PRESENCE_CONTINUE:
      return state;
    // The unified return screen acknowledges directly from its single primary action.
    case ACTION.ACK_START:
      if (state.phase !== PHASE.PRESENCE && state.phase !== PHASE.REQUESTING_SESSION) {
        const ackRetry = state.phase === PHASE.RETRYABLE_ERROR && state.error?.code === "ack_transport";
        if (!ackRetry) return state;
      }
      return { ...state, phase: PHASE.ACKNOWLEDGING_ENTRY, ackKey: payload.key || state.ackKey, error: null };
    case ACTION.ACK_SUCCESS:
      if (state.phase !== PHASE.ACKNOWLEDGING_ENTRY) return state;
      return { ...state, phase: PHASE.READY, ackKey: null, checkpoint: payload.checkpoint || null, error: null };
    case ACTION.ACK_FAIL:
      if (state.phase !== PHASE.ACKNOWLEDGING_ENTRY) return state;
      return { ...state, phase: PHASE.RETRYABLE_ERROR, error: { code: "ack_transport", message: payload.message || "Не удалось подтвердить вход." } };
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
