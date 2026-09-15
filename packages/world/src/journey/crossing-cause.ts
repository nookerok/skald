/**
 * Honest wording for a closed-crossing block (review P1).
 *
 * A `closed` crossing condition alone does not prove high water: the
 * relation may be shut for any reason. High water is claimed only when
 * the crossing's own watercourse reads `high` or `flood` in the same
 * world snapshot the rule decided on. Everything else gets the neutral
 * closed wording with the same remedy. Pure and total: no events, no
 * world access beyond the passed read view.
 */

import type { SpatialReadView } from "../region/types.js";

/**
 * True when the crossing's own watercourse reads high water in this
 * snapshot. False covers low/normal bands, missing river state and a
 * missing definition — none of which may be narrated as high water.
 */
export function highWaterAhead(spatial: SpatialReadView | null, relationId: string): boolean {
  if (!spatial) return false;
  const relation = spatial.travelRelations.get(relationId);
  if (!relation || relation.kind !== "crossing") return false;
  const states = spatial.crossingStates ?? new Map();
  const crossing = states.get(relation.id)
    ?? [...states.values()].find((state) => state.crossingId === relation.id);
  const crossingId = crossing?.crossingId ?? relation.id;
  const definitions = spatial.crossingDefinitions ?? new Map();
  const definition = definitions.get(relation.id)
    ?? [...definitions.values()].find((entry) => entry.crossingId === crossingId);
  const band = definition ? spatial.riverStates?.get(definition.watercourseId)?.band : undefined;
  return band === "high" || band === "flood";
}

/**
 * Player-facing block text for a closed crossing. The water remedy
 * ("дождаться спада") travels only with a proven high-water cause;
 * otherwise the remedy stays neutral.
 */
export function closedCrossingText(locationName: string, highWater: boolean): string {
  return highWater
    ? `Путь к «${locationName}» сейчас невозможен: переправа закрыта из-за высокой воды. Можно поискать обход или дождаться спада.`
    : `Путь к «${locationName}» сейчас невозможен: переправа закрыта. Можно поискать обход или переждать.`;
}
