/**
 * Map State — state machine for Player Map (ADR-0019 §4).
 *
 * States: idle → loading → ready | stale | error | unavailable
 */

export const MAP_STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  STALE: "stale",
  ERROR: "error",
  UNAVAILABLE: "unavailable",
};

/**
 * Create initial map state.
 */
export function createMapState() {
  return Object.freeze({
    status: MAP_STATUS.IDLE,
    map: null,
    revision: null,
    error: null,
  });
}

/**
 * Transition to loading state.
 */
export function mapLoading(state) {
  return Object.freeze({
    ...state,
    status: MAP_STATUS.LOADING,
    error: null,
  });
}

/**
 * Transition to ready state with a new map DTO.
 * Ignores stale revisions (lower eventNumber than current).
 */
export function mapReady(state, map) {
  // Ignore stale revisions
  if (state.revision && map.revision && map.revision.eventNumber < state.revision.eventNumber) {
    return state;
  }
  return Object.freeze({
    status: MAP_STATUS.READY,
    map,
    revision: map.revision,
    error: null,
  });
}

/**
 * Transition to error state.
 */
export function mapError(state, error) {
  return Object.freeze({
    ...state,
    status: MAP_STATUS.ERROR,
    error: error?.message ?? String(error),
  });
}

/**
 * Transition to stale state (revision mismatch).
 */
export function mapStale(state) {
  return Object.freeze({
    ...state,
    status: MAP_STATUS.STALE,
  });
}

/**
 * Transition to unavailable state (no world).
 */
export function mapUnavailable(state) {
  return Object.freeze({
    status: MAP_STATUS.UNAVAILABLE,
    map: null,
    revision: null,
    error: null,
  });
}

/**
 * Clear state for world switch.
 */
export function mapClear() {
  return createMapState();
}
