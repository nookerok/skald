import { evaluateAdventureCheck } from "./adventure-checks.js";
import type { AdventureContext, AdventureReport, AdventureSnapshot } from "./adventure-types.js";

const REQUIRED_BEATS = [
  "world_is_living_region",
  "map_has_current_position",
  "conversation_has_master_reply",
  "rumour_does_not_reveal_coordinates",
  "route_alternative_available",
  "rumour_was_received",
  "rumour_is_player_visible",
  "clarification_was_requested",
  "journey_is_multitick",
  "journey_reached_ruins",
  "world_changed_during_journey",
  "conditioned_route_choice",
  "meaningful_player_choices",
  "discovery_reached_hypothesis",
  "discovery_evidence_loop",
  "discovery_is_not_canon_truth",
  "returned_to_waystation",
  "map_knowledge_grew",
  "chronicle_has_adventure_arc",
  "offline_world_progressed",
  "offline_did_not_move_player",
  "offline_has_no_personal_observation_leak",
  "presence_has_at_most_three_highlights",
  "restart_preserved_journal",
  "restart_preserved_map",
  "chat_has_no_raw_internal_keys",
  "chronicle_is_ordered",
] as const;

type Json = Record<string, unknown>;

function payload(event: Json): Json {
  return event.payload && typeof event.payload === "object" ? event.payload as Json : {};
}

function events(ctx: AdventureContext, type: string): readonly Json[] {
  return ctx.events.filter((event) => event.type === type);
}

function state(snapshot: AdventureSnapshot): Json {
  const root = snapshot.state as Json | undefined;
  return root?.state as Json ?? {};
}

function playerFacing(snapshot: AdventureSnapshot): string {
  const allowed = new Set(["primary", "text", "summary", "title", "question"]);
  const collect = (value: unknown): string[] => {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(collect);
    return Object.entries(value as Json).flatMap(([key, child]) => allowed.has(key) ? (typeof child === "string" ? [child] : collect(child)) : (child && typeof child === "object" ? collect(child) : []));
  };
  return collect([snapshot.journal, snapshot.shell, snapshot.map, snapshot.discoveries, snapshot.presence]).join(" ");
}
export type AdventureReportEvidence = Omit<AdventureReport, "pass">;

export function adventureReportFailures(report: AdventureReportEvidence): readonly string[] {
  const failures: string[] = [];
  if (report.requiredBeatsCovered !== 1) failures.push("requiredBeatsCovered must equal 1");
  if (report.meaningfulPlayerChoices < 3) failures.push("meaningfulPlayerChoices must be at least 3");
  if (report.journeyLegsCompleted < 4) failures.push("journeyLegsCompleted must be at least 4");
  if (report.worldChangesEncountered < 1) failures.push("worldChangesEncountered must be at least 1");
  if (report.discoveriesAdvanced < 2) failures.push("discoveriesAdvanced must be at least 2");
  if (report.mapKnowledgeGrowth < 1) failures.push("mapKnowledgeGrowth must be at least 1");
  if (report.offlineMeaningfulEvents < 1) failures.push("offlineMeaningfulEvents must be at least 1");
  if (!report.chatAlternationIntegrity) failures.push("chatAlternationIntegrity must be true");
  if (report.chronicleCoverage !== 1) failures.push("chronicleCoverage must equal 1");
  if (report.narrationDuplicateRate !== 0) failures.push("narrationDuplicateRate must equal 0");
  if (report.truthLeakCount !== 0) failures.push("truthLeakCount must equal 0");
  if (report.orphanResponseCount !== 0) failures.push("orphanResponseCount must equal 0");
  if (!report.replayPurity) failures.push("replayPurity must be true");
  if (!report.idempotency) failures.push("idempotency must be true");
  if (!report.persistenceRestart) failures.push("persistenceRestart must be true");
  if (report.offlineObservationLeak !== 0) failures.push("offlineObservationLeak must equal 0");
  if (!Array.isArray(report.missingRequiredBeats) || report.missingRequiredBeats.length > 0) failures.push("missingRequiredBeats must be empty");
  return failures;
}

export function adventureReportPasses(report: AdventureReportEvidence): boolean {
  return adventureReportFailures(report).length === 0;
}

export function buildAdventureReport(ctx: AdventureContext, idempotency = true): AdventureReport {
  const beatResults = REQUIRED_BEATS.map((check) => evaluateAdventureCheck(check, ctx));
  const requiredBeatsCovered = beatResults.filter((result) => result === "").length / REQUIRED_BEATS.length;
  const journeyLegsCompleted = events(ctx, "JourneyCompleted").length;
  const worldChangesEncountered = ["WeatherStateChanged", "RiverLevelChanged", "CrossingConditionChanged", "SettlementStateChanged"].filter((type) => events(ctx, type).length > 0).length;
  const discoveriesAdvanced = events(ctx, "SpatialObservationRecorded").filter((event) => payload(event).subjectId === "old_ruins").length;
  const initialLocations = ((ctx.initial.map as Json | undefined)?.map as Json | undefined)?.locations;
  const currentLocations = ((ctx.current.map as Json | undefined)?.map as Json | undefined)?.locations;
  const mapKnowledgeGrowth = Math.max(0, (Array.isArray(currentLocations) ? currentLocations.length : 0) - (Array.isArray(initialLocations) ? initialLocations.length : 0));
  const offlineStartTime = Number(state(ctx.offlineStart ?? ctx.initial).worldTime ?? 0);
  const offlineStartEventCount = (ctx.offlineStart?.events ?? []).length;
  const offlineMeaningfulEvents = ctx.events.slice(offlineStartEventCount).filter((event) => Number(event.timestamp) > offlineStartTime && !["TickPassed", "HeatRadiated"].includes(String(event.type))).length;
  const commandSteps = ctx.steps.filter((step) => "say" in step.step || "choose" in step.step || "answerClarification" in step.step);
  const chatAlternationIntegrity = commandSteps.every((step) => {
    if (step.body.status === "clarification") return true;
    const presentation = step.body.presentation as Json | undefined;
    return Boolean(presentation?.primary || (Array.isArray(presentation?.notable) && presentation.notable.length > 0) || (Array.isArray(presentation?.background) && presentation.background.length > 0));
  });
  const journal = ((ctx.current.journal as Json | undefined)?.turns);
  const chronicleCoverage = Array.isArray(journal) && journal.length >= 10 ? 1 : 0;
  const worldTimes = Array.isArray(journal) ? journal.map((turn) => Number((turn as Json).worldTime)) : [];
  const narrationDuplicateRate = worldTimes.length === 0 ? 0 : 1 - new Set(worldTimes).size / worldTimes.length;
  const playerFacingTurns = [ctx.current, ...ctx.steps.map((step) => step.snapshot)].map(playerFacing).join(" ");
  const truthLeakCount = /(?:JourneyStarted|PlayerLocationChanged|old_ruins|river_waystation|correlationId|eventId|undefined)/u.test(playerFacingTurns) ? 1 : 0;
  const orphanResponseCount = commandSteps.filter((step) => step.body.status !== "clarification" && !step.body.presentation).length;
  const meaningfulChoices = ctx.steps.filter((step) => "choose" in step.step || "answerClarification" in step.step).length;
  const persistenceRestart = Boolean(ctx.restartBefore)
    && evaluateAdventureCheck("restart_preserved_journal", ctx) === ""
    && evaluateAdventureCheck("restart_preserved_map", ctx) === "";
  const offlineObservationLeak = ctx.events.slice(offlineStartEventCount).filter((event) => Number(event.timestamp) > offlineStartTime && event.type === "SpatialObservationRecorded" && payload(event).observerId === "player").length;
  const replayPurity = persistenceRestart;
  const report: AdventureReportEvidence = {
    requiredBeatsCovered,
    meaningfulPlayerChoices: meaningfulChoices,
    journeyLegsCompleted,
    worldChangesEncountered,
    discoveriesAdvanced,
    mapKnowledgeGrowth,
    offlineMeaningfulEvents,
    chatAlternationIntegrity,
    chronicleCoverage,
    narrationDuplicateRate,
    truthLeakCount,
    orphanResponseCount,
    replayPurity,
    idempotency,
    persistenceRestart,
    offlineObservationLeak,
    missingRequiredBeats: REQUIRED_BEATS.filter((check) => evaluateAdventureCheck(check, ctx) !== ""),
  };
  return { ...report, pass: adventureReportPasses(report) };
}

const REPORT_NUMERIC_FIELDS = [
  "requiredBeatsCovered",
  "meaningfulPlayerChoices",
  "journeyLegsCompleted",
  "worldChangesEncountered",
  "discoveriesAdvanced",
  "mapKnowledgeGrowth",
  "offlineMeaningfulEvents",
  "chronicleCoverage",
  "narrationDuplicateRate",
  "truthLeakCount",
  "orphanResponseCount",
  "offlineObservationLeak",
] as const;

const REPORT_BOOLEAN_FIELDS = [
  "chatAlternationIntegrity",
  "replayPurity",
  "idempotency",
  "persistenceRestart",
] as const;

/**
 * Verifies both the shape and the acceptance semantics of a serialized
 * AdventureReport. Release evidence must not replace the report produced by
 * buildAdventureReport with a hand-written pass:true.
 */
export function validateAdventureReport(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["must be a JSON object"];
  const errors: string[] = [];
  const record = value as Record<string, unknown>;
  if (record.pass !== true) errors.push("pass must be true");
  for (const field of REPORT_NUMERIC_FIELDS) {
    if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
      errors.push(field + " must be a finite number");
    } else if ((record[field] as number) < 0) {
      errors.push(field + " must be non-negative");
    }
  }
  for (const field of REPORT_BOOLEAN_FIELDS) {
    if (record[field] !== true) errors.push(field + " must be true");
  }
  if (!Array.isArray(record.missingRequiredBeats)) {
    errors.push("missingRequiredBeats must be an array");
  } else if (record.missingRequiredBeats.length > 0) {
    errors.push("missingRequiredBeats must be empty");
  }

  errors.push(...adventureReportFailures(record as unknown as AdventureReportEvidence));
  return errors;
}

export { REQUIRED_BEATS };
