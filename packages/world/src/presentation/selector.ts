import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import { ALL_TEMPLATES } from "./templates.js";
import type { PresentationCandidate, PresentationEntry, TurnPresentation } from "./types.js";

const SUPPRESSED_EVENT_TYPES = new Set([
  "PlayerSpawned", "WallPlaced", "HeatSourcePlaced", "StrategySet",
  "MoveRequested", "GiveRequested", "ActionValidated", "GiveValidated", "ActionCompleted",
]);

function isSuppressed(event: DomainEvent): boolean {
  if (SUPPRESSED_EVENT_TYPES.has(event.type)) return true;
  return false;
}

export function selectTurnPresentation(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
): TurnPresentation {
  const candidates: PresentationCandidate[] = [];
  let suppressed = 0;

  for (const event of events) {
    if (isSuppressed(event)) { suppressed++; continue; }

    let matched = false;
    for (const tpl of ALL_TEMPLATES) {
      if (!tpl.listens.includes(event.type)) continue;
      const c = tpl.present(event, world);
      if (c !== null) {
        candidates.push(c);
        matched = true;
        break; // first matching template wins
      }
    }
    if (!matched) suppressed++;
  }

  // Group by groupKey
  const groupMap = new Map<string, PresentationCandidate[]>();
  const ungrouped: PresentationCandidate[] = [];
  for (const c of candidates) {
    if (c.groupKey) {
      const list = groupMap.get(c.groupKey) ?? [];
      list.push(c);
      groupMap.set(c.groupKey, list);
    } else {
      ungrouped.push(c);
    }
  }

  const merged: PresentationCandidate[] = [];
  for (const [, list] of groupMap) {
    // Use the highest rank candidate's text; merge sourceEventIds
    list.sort((a, b) => b.rank - a.rank || 0);
    const best = list[0]!;
    const ids = [...new Set(list.flatMap((c) => c.sourceEventIds))];
    merged.push({ ...best, sourceEventIds: ids });
  }
  merged.push(...ungrouped);

  // Separate primary-importance candidates from the rest
  const primaryCandidates = merged.filter((c) => c.defaultImportance === "primary");
  const nonPrimaryCandidates = merged.filter((c) => c.defaultImportance !== "primary");

  // Sort by rank descending, then by timestamp
  primaryCandidates.sort((a, b) => b.rank - a.rank || a.timestamp - b.timestamp);
  nonPrimaryCandidates.sort((a, b) => b.rank - a.rank || a.timestamp - b.timestamp);

  // Pick primary: first among primary-importance candidates
  let primary: PresentationEntry | null = null;
  const remaining: PresentationCandidate[] = [];

  if (primaryCandidates.length > 0) {
    const top = primaryCandidates[0]!;
    primary = {
      kind: top.kind,
      importance: "primary",
      discoveryMark: top.discoveryMark,
      text: top.text,
      timestamp: top.timestamp,
      sourceEventIds: top.sourceEventIds,
    };
    // Rest of primaryCandidates go to remaining (will be demoted)
    for (let i = 1; i < primaryCandidates.length; i++) remaining.push(primaryCandidates[i]!);
  }
  // All non-primary candidates go to remaining
  for (const c of nonPrimaryCandidates) remaining.push(c);

  // No primary candidates → fallback projection-derived entry
  if (!primary) {
    primary = {
      kind: "world",
      importance: "primary",
      discoveryMark: null,
      text: `Ты находишься в точке (${world.player.x}, ${world.player.y}). Мир вокруг продолжает меняться.`,
      timestamp: world.time,
      sourceEventIds: [],
    };
  }

  // Classify remaining
  const notable: PresentationEntry[] = [];
  const background: PresentationEntry[] = [];

  for (const c of remaining) {
    const imp = c.defaultImportance;
    const entry: PresentationEntry = {
      kind: c.kind,
      importance: imp,
      discoveryMark: c.discoveryMark,
      text: c.text,
      timestamp: c.timestamp,
      sourceEventIds: c.sourceEventIds,
    };

    if (imp === "primary") {
      // extra primary → notable
      if (notable.length < 3) notable.push({ ...entry, importance: "notable" });
      else background.push({ ...entry, importance: "background" });
    } else if (imp === "notable") {
      if (notable.length < 3) notable.push(entry);
      else background.push({ ...entry, importance: "background" });
    } else {
      background.push(entry);
    }
  }

  return {
    primary,
    notable,
    background,
    suppressedEventCount: suppressed,
    worldTime: world.time,
    playerPosition: { x: world.player.x, y: world.player.y },
  };
}
