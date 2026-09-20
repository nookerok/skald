import { setComposerBusy } from "./ui-state.js";

/**
 * Single composer state machine (plan_9 §8).
 *
 * One source owns every composer-affecting DOM write in a single synchronous
 * render cycle: the busy flags plus disabled state of input/send/retry/voice
 * (via the atomic ui-state setter) and the retry button visibility. No other
 * module may toggle these elements; status text stays with the existing
 * status/connection renderers.
 *
 * States:
 * - idle: composer usable, retry hidden.
 * - submitting: HTTP request in flight, everything locked, retry hidden.
 * - waiting_for_narration: HTTP answered, narration still enriching. The
 *   composer stays usable by design (narration is detached and can take tens
 *   of seconds); only the retry stays hidden.
 * - retryable_failure: transport failed or timed out. Composer usable, retry
 *   shown so the same intent can be re-sent with its idempotency key.
 */
export const COMPOSER = {
  IDLE: "idle",
  SUBMITTING: "submitting",
  WAITING_FOR_NARRATION: "waiting_for_narration",
  RETRYABLE_FAILURE: "retryable_failure",
};

const KNOWN = new Set([COMPOSER.IDLE, COMPOSER.SUBMITTING, COMPOSER.WAITING_FOR_NARRATION, COMPOSER.RETRYABLE_FAILURE]);

/**
 * Status line owned by each composer state (plan_9 §8). Idle returns null so
 * the composer machine never overwrites a reducer/shell message that already
 * explains the last outcome ("Ход записан", a rejection reason, a connection
 * error). Non-idle states own their text; this is the single writer for
 * «МАСТЕР отвечает…».
 */
const COMPOSER_STATUS = {
  [COMPOSER.SUBMITTING]: "МАСТЕР отвечает…",
  [COMPOSER.WAITING_FOR_NARRATION]: "МАСТЕР дополняет эту запись…",
  [COMPOSER.RETRYABLE_FAILURE]: "Ответ задерживается — можно повторить.",
};

/** Status text for a composer state, or null when the state owns none. */
export function composerStatusText(state) {
  return COMPOSER_STATUS[state] ?? null;
}

/**
 * Pure policy: maps a finished submit to the next composer state.
 * Transport failure or timeout always lands retryable; a successful answer
 * that arms narration polling waits for it; everything else idles.
 */
export function composerStateAfterSubmit(outcome) {
  if (!outcome || typeof outcome !== "object") return COMPOSER.IDLE;
  if (outcome.transportFailed) return COMPOSER.RETRYABLE_FAILURE;
  if (outcome.ok && outcome.armsNarration) return COMPOSER.WAITING_FOR_NARRATION;
  return COMPOSER.IDLE;
}

/** Applies one composer state atomically. Unknown states fall back to idle. */
export function setComposerState(state) {
  const normalized = KNOWN.has(state) ? state : COMPOSER.IDLE;
  setComposerBusy(normalized === COMPOSER.SUBMITTING);
  const retry = typeof document !== "undefined" && document.getElementById
    ? document.getElementById("retry-btn")
    : null;
  if (retry) retry.hidden = normalized !== COMPOSER.RETRYABLE_FAILURE;
  const status = composerStatusText(normalized);
  const statusEl = status && typeof document !== "undefined" && document.getElementById
    ? document.getElementById("status-text")
    : null;
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.setAttribute("aria-live", "assertive");
  }
  return normalized;
}
