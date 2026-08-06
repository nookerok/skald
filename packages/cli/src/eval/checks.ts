/**
 * Scenario assertion vocabulary (packages/cli/src/eval/checks.ts).
 *
 * Pure, deterministic checks over the canonical event log and the observer-
 * scoped transcript. Every check returns either "" (passed) or a reason.
 */

import type { Check, CheckContext } from "./types.js";

function describe(check: Check): string {
  return JSON.stringify(check);
}

function presentationText(transcript: CheckContext["transcript"]): string {
  const presentation = transcript.presentation as {
    primary?: { text?: string };
    notable?: Array<{ text?: string }>;
    background?: Array<{ text?: string }>;
  } | null;
  if (!presentation) return "";
  const parts: string[] = [];
  if (presentation.primary?.text) parts.push(presentation.primary.text);
  for (const entry of presentation.notable ?? []) if (entry.text) parts.push(entry.text);
  for (const entry of presentation.background ?? []) if (entry.text) parts.push(entry.text);
  return parts.join(" ");
}

export function evaluateCheck(check: Check, ctx: CheckContext): string {
  switch (check.kind) {
    case "eventTypeSeen":
      return ctx.allEvents.some((e) => e.type === check.type)
        ? ""
        : `${describe(check)}: event ${check.type} never occurred`;

    case "eventTypeSeenSinceLast":
      return ctx.lastStepEvents.some((e) => e.type === check.type)
        ? ""
        : `${describe(check)}: event ${check.type} not emitted in the last step`;

    case "eventTypeCountAtLeast": {
      const count = ctx.allEvents.filter((e) => e.type === check.type).length;
      return count >= check.value
        ? ""
        : `${describe(check)}: event ${check.type} occurred ${count} times < ${check.value}`;
    }

    case "eventTypeAbsent":
      return ctx.allEvents.some((e) => e.type === check.type)
        ? `${describe(check)}: event ${check.type} occurred but must stay absent`
        : "";

    case "worldTime":
      return ctx.worldTime === check.value
        ? ""
        : `${describe(check)}: worldTime ${ctx.worldTime} !== ${check.value}`;

    case "playerAt":
      return ctx.world.player.x === check.x && ctx.world.player.y === check.y
        ? ""
        : `${describe(check)}: player at (${ctx.world.player.x},${ctx.world.player.y}) !== (${check.x},${check.y})`;

    case "observationAtLeast": {
      const value = ctx.world.observations.get(check.key) ?? 0;
      return value >= check.value
        ? ""
        : `${describe(check)}: observation ${check.key} = ${value} < ${check.value}`;
    }

    case "consequenceActive":
      return ctx.world.consequences.size > 0
        ? ""
        : `${describe(check)}: no active consequence`;

    case "situationActive":
      return ctx.world.activeSituations.has(check.situationId)
        ? ""
        : `${describe(check)}: situation ${check.situationId} not active`;

    case "presentationContains": {
      const text = presentationText(ctx.transcript);
      return text.includes(check.text)
        ? ""
        : `${describe(check)}: presentation does not contain "${check.text}"`;
    }

    case "beliefCountMin": {
      const belief = JSON.parse(ctx.beliefJson) as { beliefs?: unknown[] };
      const count = Array.isArray(belief.beliefs) ? belief.beliefs.length : 0;
      return count >= check.value
        ? ""
        : `${describe(check)}: belief.beliefs ${count} < ${check.value}`;
    }

    case "observerMapPresent": {
      const map = ctx.transcript.observerMap as { __evalError?: string } | null | undefined;
      if (!map || map.__evalError) return `${describe(check)}: observer map missing`;
      return "";
    }

    case "observerMapHasLocations": {
      const map = ctx.transcript.observerMap as { locations?: unknown[] } | null | undefined;
      const count = Array.isArray(map?.locations) ? map.locations.length : 0;
      return count >= check.value
        ? ""
        : `${describe(check)}: observer map has ${count} locations < ${check.value}`;
    }

    case "observerMapHasRoutes": {
      const map = ctx.transcript.observerMap as { routes?: unknown[] } | null | undefined;
      const count = Array.isArray(map?.routes) ? map.routes.length : 0;
      return count >= check.value
        ? ""
        : `${describe(check)}: observer map has ${count} routes < ${check.value}`;
    }

    case "heatMapAtLeast": {
      const state = JSON.parse(ctx.stateJson) as { heatMap?: Record<string, number> };
      const value = state.heatMap?.[`${check.x},${check.y}`] ?? 0;
      return value >= check.value
        ? ""
        : `${describe(check)}: heatMap at (${check.x},${check.y}) = ${value} < ${check.value}`;
    }

    case "relationValueAtLeast": {
      const relation = ctx.world.relations.get(`${check.from}>${check.to}:${check.relationKind}`);
      const value = relation?.value ?? 0;
      return value >= check.value
        ? ""
        : `${describe(check)}: relation ${check.from}>${check.to}:${check.relationKind} = ${value} < ${check.value}`;
    }

    default:
      return `${describe(check)}: unknown check kind`;
  }
}
