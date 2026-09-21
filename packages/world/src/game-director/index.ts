/**
 * Game director read-side model (plan_9 §§9–11, quality guard §13).
 *
 * Pure observer-safe derivations only: scene rhythm, director context,
 * continuation momentum and the narration quality guard. Nothing here
 * emits Domain Events, writes Projection, touches the network or calls
 * an LLM. Simulation Core stays the single source of truth; this model
 * only helps the narration layer choose emphasis among facts the player
 * already knows.
 */

export {
  buildSceneRhythm,
  rhythmCompletion,
  rhythmInactionCost,
  rhythmOpportunity,
  rhythmPressure,
  rhythmQuestion,
} from "./scene-rhythm.js";
export type { RhythmConsequence, SceneRhythm, SceneRhythmInput } from "./scene-rhythm.js";
export {
  GAME_DIRECTOR_MAX_LIST,
  GAME_DIRECTOR_MAX_TEXT,
  GAME_DIRECTOR_MAX_TURNS,
  buildGameDirectorContext,
  directorJourneyState,
  directorRecentConsequences,
} from "./context.js";
export type {
  GameDirectorBackground,
  GameDirectorClarification,
  GameDirectorConsequence,
  GameDirectorContact,
  GameDirectorContext,
  GameDirectorConversationSlice,
  GameDirectorGoal,
  GameDirectorItem,
  GameDirectorJourney,
  GameDirectorRoute,
  GameDirectorScene,
  GameDirectorThread,
  GameDirectorTurn,
  GameDirectorContextInput,
} from "./context.js";
export {
  CONTINUATION_MAX_CHARS,
  buildContinuationHint,
  ensureGameMomentum,
  hasGameMomentum,
} from "./continuation.js";
export { buildMasterBrief, MASTER_BRIEF_MAX_CHARS, MASTER_BRIEF_MAX_LEADS } from "./brief.js";
export type { MasterBrief, MasterBriefInput, MasterBriefJourney, MasterBriefLabel } from "./brief.js";
export {
  GAME_NARRATION_MAX_CHARS,
  GAME_NARRATION_MAX_SENTENCES,
  GAME_NARRATION_MIN_WORD,
  verifyGameNarration,
} from "./narration-quality.js";
export type {
  GameNarrationQualityInput,
  GameNarrationQualityReason,
  GameNarrationQualityResult,
} from "./narration-quality.js";
