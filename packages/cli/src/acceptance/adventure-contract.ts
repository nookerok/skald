import type { AdventureScenario, AdventureStep } from "./adventure-types.js";

export const MIN_ADVENTURE_COMMANDS = 20;
export const MAX_ADVENTURE_COMMANDS = 35;
export const MIN_MEANINGFUL_CHOICES = 3;
export const MIN_OFFLINE_TICKS = 24;
export const MAX_OFFLINE_TICKS = 48;

const REQUIRED_CHECKS = [
  "world_is_living_region",
  "conversation_has_master_reply",
  "rumour_was_received",
  "clarification_was_requested",
  "journey_is_multitick",
  "world_changed_during_journey",
  "discovery_evidence_loop",
  "returned_to_waystation",
  "map_knowledge_grew",
  "offline_world_progressed",
  "offline_did_not_move_player",
  "restart_preserved_journal",
  "restart_preserved_map",
] as const;

function commandText(step: AdventureStep): string | null {
  if ("say" in step) return step.say;
  if ("choose" in step) return step.choose;
  if ("answerClarification" in step) return step.answerClarification;
  return null;
}

function commandSteps(scenario: AdventureScenario): readonly AdventureStep[] {
  return scenario.turns.filter((step) => commandText(step) !== null);
}

function assertChecks(scenario: AdventureScenario): ReadonlySet<string> {
  const checks = new Set<string>();
  for (const step of scenario.turns) {
    if ("assert" in step) for (const check of step.assert) checks.add(check);
  }
  return checks;
}

/**
 * Validates the shape of the canonical adventure before it can be executed.
 * This protects the release gate from silently shrinking to a short smoke.
 */
export function validateAdventureScenario(scenario: AdventureScenario): readonly string[] {
  const errors: string[] = [];
  if (scenario.worldTemplateId !== "living_region") errors.push("worldTemplateId must be living_region");

  const commands = commandSteps(scenario);
  if (commands.length < MIN_ADVENTURE_COMMANDS || commands.length > MAX_ADVENTURE_COMMANDS) {
    errors.push(`command count must be between ${MIN_ADVENTURE_COMMANDS} and ${MAX_ADVENTURE_COMMANDS}`);
  }

  const meaningfulChoices = scenario.turns.filter((step) => "choose" in step || "answerClarification" in step).length;
  if (meaningfulChoices < MIN_MEANINGFUL_CHOICES) errors.push(`at least ${MIN_MEANINGFUL_CHOICES} meaningful choices are required`);

  const journeyCommands = commands.filter((step) => /идти|верн|переправ|дорог/u.test(commandText(step) ?? ""));
  if (journeyCommands.length < 4) errors.push("at least four journey intent commands are required");

  const inspections = commands.filter((step) => /осмотр/u.test(commandText(step) ?? ""));
  if (inspections.length < 3 || !inspections.some((step) => /каменн/u.test(commandText(step) ?? ""))) {
    errors.push("the scenario must contain repeated inspection and a targeted masonry observation");
  }

  const offlineSteps = scenario.turns.filter((step): step is { readonly offlineTicks: number } => "offlineTicks" in step);
  if (offlineSteps.length !== 1) errors.push("exactly one offline period is required");
  else if (offlineSteps[0].offlineTicks < MIN_OFFLINE_TICKS || offlineSteps[0].offlineTicks > MAX_OFFLINE_TICKS) {
    errors.push(`offline ticks must be between ${MIN_OFFLINE_TICKS} and ${MAX_OFFLINE_TICKS}`);
  }

  if (scenario.turns.filter((step) => "acknowledge" in step).length !== 1) errors.push("exactly one Presence acknowledgement is required");
  if (!scenario.turns.some((step) => "disconnect" in step)) errors.push("disconnect step is required");
  if (!scenario.turns.some((step) => "restartServer" in step)) errors.push("restartServer step is required");
  if (!scenario.turns.some((step) => "reconnect" in step)) errors.push("reconnect step is required");

  const checks = assertChecks(scenario);
  for (const check of REQUIRED_CHECKS) if (!checks.has(check)) errors.push(`required check ${check} is missing`);
  return errors;
}

export { REQUIRED_CHECKS };
