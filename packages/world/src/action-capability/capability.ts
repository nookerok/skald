import type { ReadonlyWorld } from "../projection.js";
import type { ActionCapabilityReadView, CapabilityAssessment, CapabilityQuestion, ItemPlacement } from "./types.js";

export function getPlacement(model: ActionCapabilityReadView | null, itemId: string): ItemPlacement | undefined {
  return model?.placements.get(itemId);
}

export function getPossessor(model: ActionCapabilityReadView | null, itemId: string): string | undefined {
  return model?.owners.get(itemId);
}

export function getContainerContents(model: ActionCapabilityReadView | null, containerId: string): readonly string[] {
  if (!model) return [];
  return [...model.placements]
    .filter(([, placement]) => placement.kind === "container" && placement.containerId === containerId)
    .map(([itemId]) => itemId);
}

function isPlacementAccessible(
  world: ReadonlyWorld,
  subjectId: string,
  placement: ItemPlacement,
  visited: ReadonlySet<string>,
): boolean {
  if (placement.kind === "carried") return placement.holderId === subjectId;
  if (placement.kind === "location") return placement.locationId === world.currentLocationId;
  if (visited.has(placement.containerId)) return false;
  const container = world.objects.get(placement.containerId);
  if (!container || container.state.open !== true) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(placement.containerId);
  const containerPlacement = getPlacement(world.actionCapabilities, placement.containerId);
  return containerPlacement !== undefined && isPlacementAccessible(world, subjectId, containerPlacement, nextVisited);
}

export function isItemAccessible(world: ReadonlyWorld, subjectId: string, itemId: string): boolean {
  const placement = getPlacement(world.actionCapabilities, itemId);
  return placement !== undefined && isPlacementAccessible(world, subjectId, placement, new Set([itemId]));
}

/** Total mass of an item including all recursively nested container contents. */
export function getTotalMass(model: ActionCapabilityReadView | null, itemId: string, visited: ReadonlySet<string> = new Set()): number {
  if (!model) return 0;
  if (visited.has(itemId)) return 0;
  const definition = model.itemDefinitions.get(itemId);
  if (!definition) return 0;
  const nextVisited = new Set(visited);
  nextVisited.add(itemId);
  const nested = getContainerContents(model, itemId).reduce(
    (sum, contentId) => sum + getTotalMass(model, contentId, nextVisited),
    0,
  );
  return definition.mass + nested;
}

export function canContain(world: ReadonlyWorld, containerId: string, itemId: string, subjectId = "player"): boolean {
  const model = world.actionCapabilities;
  const container = world.objects.get(containerId);
  const definition = model?.itemDefinitions.get(containerId);
  const itemDefinition = model?.itemDefinitions.get(itemId);
  if (!container || !definition || !itemDefinition || definition.containerCapacityMass === null) return false;
  if (container.state.open !== true || !isItemAccessible(world, subjectId, containerId)) return false;
  if (containerId === itemId) return false;
  let ancestor: ItemPlacement | undefined = getPlacement(model, containerId);
  const visited = new Set<string>();
  while (ancestor?.kind === "container") {
    if (visited.has(ancestor.containerId)) return false;
    if (ancestor.containerId === itemId) return false;
    visited.add(ancestor.containerId);
    ancestor = getPlacement(model, ancestor.containerId);
  }
  const contents = getContainerContents(model, containerId);
  if (contents.includes(itemId)) return true;
  const usedMass = contents.reduce((sum, contentId) => sum + getTotalMass(model, contentId), 0);
  return usedMass + getTotalMass(model, itemId) <= definition.containerCapacityMass;
}

/** Answers one contextual capability question from event-derived facts. */
export function assessCapability(world: ReadonlyWorld, question: CapabilityQuestion): CapabilityAssessment {
  const model = world.actionCapabilities;
  if (!model) return Object.freeze({
    canAttempt: false,
    canPerform: false,
    canPerformReliably: false,
    reasons: Object.freeze(["capability_projection_unavailable"]),
  });

  const reasons: string[] = [];
  const item = model.itemDefinitions.get(question.instrumentId);
  if (!item?.affordances.includes(question.affordance)) reasons.push("missing_affordance");
  if (!isItemAccessible(world, question.subjectId, question.instrumentId)) reasons.push("instrument_inaccessible");

  const conditions = [...model.conditions.values()].filter((condition) => condition.subjectId === question.subjectId);
  if (conditions.some((condition) => condition.blockedAffordances.includes(question.affordance))) reasons.push("condition_blocks_affordance");
  const techniqueId = question.techniqueId;
  if (techniqueId && conditions.some((condition) => condition.unavailableTechniques.includes(techniqueId))) {
    reasons.push("technique_unavailable_in_condition");
  }

  const requiredKnowledgeId = question.requiredKnowledgeId;
  const knows = requiredKnowledgeId === undefined
    || model.knowledge.get(question.subjectId)?.has(requiredKnowledgeId) === true;
  if (!knows) reasons.push("required_knowledge_absent");

  const hardBlocks = ["missing_affordance", "instrument_inaccessible", "condition_blocks_affordance"];
  const canAttempt = !reasons.some((reason) => hardBlocks.includes(reason));
  const matching = model.proficiencyEvidence.filter((entry) =>
    entry.subjectId === question.subjectId &&
    entry.affordance === question.affordance &&
    entry.outcome === "achieved",
  );
  const contextual = matching.filter((entry) =>
    (question.contextTags ?? []).every((tag) => entry.contextTags.includes(tag)),
  );

  const techniqueBlocked = reasons.includes("technique_unavailable_in_condition");
  return Object.freeze({
    canAttempt,
    canPerform: canAttempt && knows && !techniqueBlocked && matching.length > 0,
    canPerformReliably: canAttempt && knows && contextual.length >= 2 && !reasons.includes("technique_unavailable_in_condition"),
    reasons: Object.freeze(reasons),
  });
}
