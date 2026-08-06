/**
 * Invariant auditor (packages/cli/src/eval/auditor.ts).
 *
 * Runs after every scenario and verifies the canonical guarantees that make the
 * simulation safe for an external tester to drive:
 *   - Projection Purity: replaying the Event Log rebuilds the identical world.
 *   - worldTime strictly advances each turn.
 *   - Idempotency: replaying a completed command key creates no new events.
 *   - No internal truth leaks into the observer-scoped player DTOs.
 *   - Player-facing presentation does not expose raw internal keys.
 * All checks are deterministic and read-only.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { rebuildProjection } from "@skald/world";
import type { AuditResult } from "./types.js";

/** Internal world-state keys that must never appear in a player-facing DTO. */
export const FORBIDDEN_DTO_TOKENS = [
  '"weatherProcesses"',
  '"weatherStates"',
  '"riverProcesses"',
  '"riverStates"',
  '"crossingDefinitions"',
  '"crossingStates"',
  '"heatProcesses"',
  '"thermalStates"',
  '"settlements"',
  '"pendingChecks"',
  '"travelRelations"',
  '"eventLog"',
] as const;

/** Raw internal keys that must never leak into player-facing presentation text. */
export const FORBIDDEN_PRESENTATION_TOKENS = [
  "forest_fire",
  "wall_caution",
  "risk_taken",
  "world_reaction_fear",
  "edge_awareness",
  "impatience",
] as const;

function comparableWorld(world: ReadonlyWorld): string {
  const sorted = (map: ReadonlyMap<string, unknown>): Array<[string, unknown]> => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return JSON.stringify({
    player: world.player,
    walls: [...world.walls].sort(),
    observations: sorted(world.observations),
    consequences: sorted(world.consequences),
    firedConsequences: sorted(world.firedConsequences),
    activeSituations: sorted(world.activeSituations),
    burnedTrees: world.burnedTrees,
    relations: sorted(world.relations),
    heatSources: sorted(world.heatSources),
    heatMap: sorted(world.heatMap),
    lastActionTick: world.lastActionTick,
    strategy: world.strategy,
    eventNumber: world.eventNumber,
    time: world.time,
    objects: sorted(world.objects),
    locations: sorted(world.locations),
    currentLocationId: world.currentLocationId,
    entities: sorted(world.entities),
    journeys: sorted(world.journeys),
    activeJourneyId: world.activeJourneyId,
    spatial: world.spatial
      ? {
          riverProcesses: sorted(world.spatial.riverProcesses),
          riverStates: sorted(world.spatial.riverStates),
          crossingDefinitions: sorted(world.spatial.crossingDefinitions),
          crossingStates: sorted(world.spatial.crossingStates),
          travelRelations: sorted(world.spatial.travelRelations),
        }
      : null,
    weather: world.weather
      ? { weatherProcesses: sorted(world.weather.weatherProcesses), weatherStates: sorted(world.weather.weatherStates) }
      : null,
    heat: world.heat
      ? { heatProcesses: sorted(world.heat.heatProcesses), thermalStates: sorted(world.heat.thermalStates) }
      : null,
    settlement: world.settlement ? { settlements: sorted(world.settlement.settlements) } : null,
  });
}

export interface AuditInput {
  readonly allEvents: readonly DomainEvent[];
  readonly liveWorld: ReadonlyWorld;
  readonly worldTimes: readonly number[];
  readonly idempotencyProbe: { readonly duplicateRejected: boolean; readonly noNewEvents: boolean } | null;
  readonly transcriptJsons: readonly string[];
  readonly presentationTexts: readonly string[];
}

export function audit(input: AuditInput): AuditResult {
  const notes: string[] = [];

  const replayed = comparableWorld(rebuildProjection([...input.allEvents]).getSnapshot());
  const live = comparableWorld(input.liveWorld);
  const purity = replayed === live;
  if (!purity) notes.push("projection purity violated: replay differs from live world");

  const worldTimeMonotonic = input.worldTimes.every((t, i) => i === 0 || t > input.worldTimes[i - 1]!);
  if (!worldTimeMonotonic) notes.push("worldTime did not strictly advance every turn");

  const idempotency = input.idempotencyProbe === null
    ? true
    : input.idempotencyProbe.duplicateRejected && input.idempotencyProbe.noNewEvents;
  if (!idempotency) notes.push("idempotency violated: duplicate key created events");

  const dtoBlob = input.transcriptJsons.join("");
  const leaked = FORBIDDEN_DTO_TOKENS.filter((token) => dtoBlob.includes(token));
  const noTruthLeak = leaked.length === 0;
  if (!noTruthLeak) notes.push(`player DTO leaks internal state: ${leaked.join(", ")}`);

  const textBlob = input.presentationTexts.join(" ");
  const rawKeys = FORBIDDEN_PRESENTATION_TOKENS.filter((token) => textBlob.includes(token));
  const presentationHonest = rawKeys.length === 0;
  if (!presentationHonest) notes.push(`presentation leaks raw internal keys: ${rawKeys.join(", ")}`);

  return {
    purity,
    worldTimeMonotonic,
    idempotency,
    noTruthLeak,
    presentationHonest,
    notes,
  };
}
