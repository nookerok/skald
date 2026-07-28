// Pure client-side state machine. All transitions are testable without DOM.

export const APP = { BOOTING: "booting", READY: "ready", DISCONNECTED: "disconnected", RECONNECTING: "reconnecting", FATAL: "fatal" };
export const CMD = { IDLE: "idle", PENDING: "pending", SUCCEEDED: "succeeded", REJECTED: "rejected", DUPLICATE: "duplicate", TRANSPORT_FAILED: "transport_failed", TIMEOUT: "timeout" };
export const JOURNAL = { LOADING: "loading", AVAILABLE: "available", EMPTY: "empty", STALE: "stale", UNAVAILABLE: "unavailable" };
export const DISCOVERIES = { LOADING: "loading", AVAILABLE: "available", EMPTY: "empty", STALE: "stale", UNAVAILABLE: "unavailable" };
export const GUIDANCE = { LOADING: "loading", AVAILABLE: "available", FREE_PLAY: "free_play", STALE: "stale", UNAVAILABLE: "unavailable" };

export function createInitialState() {
  return {
    application: APP.BOOTING,
    command: CMD.IDLE,
    journal: JOURNAL.LOADING,
    discoveries: DISCOVERIES.LOADING,
    guidance: GUIDANCE.LOADING,
    activeView: "game",
    activeThread: null,
    lastPlayerMessage: null,
    pendingInput: null,
    pendingKey: null,
  };
}

export function transition(state, action, payload) {
  switch (action) {
    case "BOOT_SUCCESS":
      return { ...state, application: APP.READY, journal: payload?.turns > 0 ? JOURNAL.AVAILABLE : JOURNAL.EMPTY };

    case "BOOT_FAILURE":
      return { ...state, application: APP.DISCONNECTED };

    case "COMMAND_START": {
      if (state.command === CMD.PENDING) return state;
      return { ...state, command: CMD.PENDING, pendingInput: payload.input, pendingKey: payload.key };
    }

    case "COMMAND_SUCCESS":
      return { ...state, command: CMD.SUCCEEDED, pendingInput: null, pendingKey: null };

    case "COMMAND_REJECTED":
      return { ...state, command: CMD.REJECTED, pendingInput: null, pendingKey: null };

    case "COMMAND_DUPLICATE":
      return { ...state, command: CMD.DUPLICATE };

    case "COMMAND_TRANSPORT_FAIL":
      return { ...state, command: CMD.TRANSPORT_FAILED };

    case "COMMAND_TIMEOUT":
      return { ...state, command: CMD.TIMEOUT };

    case "COMMAND_RESET":
      return { ...state, command: CMD.IDLE };

    case "DISCONNECTED":
      return { ...state, application: APP.DISCONNECTED };

    case "RECONNECT":
      return { ...state, application: APP.RECONNECTING };

    case "RECONNECT_SUCCESS":
      return { ...state, application: APP.READY, command: CMD.IDLE, journal: payload?.turns > 0 ? JOURNAL.AVAILABLE : JOURNAL.EMPTY };

    case "JOURNAL_LOADING":
      return { ...state, journal: JOURNAL.LOADING };

    case "JOURNAL_AVAILABLE":
      return { ...state, journal: payload?.turns > 0 ? JOURNAL.AVAILABLE : JOURNAL.EMPTY };

    case "JOURNAL_STALE":
      return { ...state, journal: JOURNAL.STALE };

    case "JOURNAL_UNAVAILABLE":
      return { ...state, journal: JOURNAL.UNAVAILABLE };

    case "DISCOVERIES_LOADING":
      return { ...state, discoveries: DISCOVERIES.LOADING };

    case "DISCOVERIES_AVAILABLE":
      return { ...state, discoveries: payload?.cards > 0 ? DISCOVERIES.AVAILABLE : DISCOVERIES.EMPTY };

    case "DISCOVERIES_STALE":
      return { ...state, discoveries: DISCOVERIES.STALE };

    case "DISCOVERIES_UNAVAILABLE":
      return { ...state, discoveries: DISCOVERIES.UNAVAILABLE };

    case "GUIDANCE_LOADING":
      return { ...state, guidance: GUIDANCE.LOADING };

    case "GUIDANCE_AVAILABLE":
      return { ...state, guidance: GUIDANCE.AVAILABLE };

    case "GUIDANCE_FREE_PLAY":
      return { ...state, guidance: GUIDANCE.FREE_PLAY };

    case "GUIDANCE_STALE":
      return { ...state, guidance: GUIDANCE.STALE };

    case "GUIDANCE_UNAVAILABLE":
      return { ...state, guidance: GUIDANCE.UNAVAILABLE };

    case "SET_VIEW":
      return { ...state, activeView: payload };

    case "SET_THREAD":
      return { ...state, activeThread: payload };

    case "SET_MESSAGE":
      return { ...state, lastPlayerMessage: payload };

    default:
      return state;
  }
}
