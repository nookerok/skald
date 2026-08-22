import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import { ALL_TEMPLATES } from "./templates.js";
import type { PresentationCandidate, PresentationEntry, PresentationImportance, TurnPresentation, TurnResponse, TurnResponseKind } from "./types.js";

export interface PresentationSelectionOptions {
  readonly allowEmptyStateFallback?: boolean;
}

type BatchKind = "player_command" | "offline_tick" | "autonomous_world" | "empty_initial_state";

const TERMINAL_REJECTION_EVENTS = new Set(["ActionRejected", "CommandRejected", "ActionBlocked", "MovementBlocked", "JourneyBlocked"]);
const TERMINAL_OUTCOME_EVENTS = new Set(["ActionResolved", "MovementSucceeded", "JourneyStarted", "JourneyCompleted", "ObjectObserved", "EntityExamined", "SoundObserved", "ActionHadNoObservableEffect", "CriticalCheckResolved", "RelationChanged", "RumorHeard", "TestimonyReceived"]);
const PLAYER_COMMAND_EVENTS = new Set(["ActionAttempted", "ActionResolved", "ActionRejected", "CommandRejected", "ActionBlocked", "MovementSucceeded", "MovementBlocked", "JourneyRequested", "JourneyStarted", "JourneyBlocked", "JourneyCompleted", "ObjectObserved", "EntityExamined", "SoundObserved", "ActionHadNoObservableEffect", "RelationChanged", "RumorHeard", "TestimonyReceived"]);

function classifyBatch(events: readonly DomainEvent[]): BatchKind {
  if (events.length === 0) return "empty_initial_state";
  if (events.some((event) => PLAYER_COMMAND_EVENTS.has(event.type))) return "player_command";
  if (events.some((event) => event.type === "TickPassed" && (event.payload as { playerOffline?: boolean }).playerOffline === true)) return "offline_tick";
  return "autonomous_world";
}

function eventTypesFor(candidate: PresentationCandidate, byId: ReadonlyMap<string, string>): readonly string[] {
  return candidate.sourceEventIds.map((id) => byId.get(id)).filter((type): type is string => type !== undefined);
}

function isOneOf(candidate: PresentationCandidate, byId: ReadonlyMap<string, string>, types: ReadonlySet<string>): boolean {
  return eventTypesFor(candidate, byId).some((type) => types.has(type));
}

function toEntry(candidate: PresentationCandidate, importance: PresentationImportance): PresentationEntry {
  return {
    kind: candidate.kind, importance, discoveryMark: candidate.discoveryMark,
    epistemicClass: candidate.epistemicClass, text: candidate.text, timestamp: candidate.timestamp,
    sourceEventIds: candidate.sourceEventIds, threadKey: candidate.threadKey, threadLabel: candidate.threadLabel,
  };
}

function emptyStateEntry(world: ReadonlyWorld): PresentationEntry {
  const location = world.currentLocationId ? world.locations.get(world.currentLocationId) : undefined;
  return {
    kind: "world", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact",
    text: location ? location.description : "Ты находишься в точке (" + world.player.x + ", " + world.player.y + ").",
    timestamp: world.time, sourceEventIds: [], threadKey: null, threadLabel: null,
  };
}

function responseFor(candidate: PresentationCandidate, kind: TurnResponseKind): TurnResponse {
  return { kind, text: candidate.text, sourceEventIds: candidate.sourceEventIds };
}

const SUPPRESSED_EVENT_TYPES = new Set([
  "PlayerSpawned", "WallPlaced", "HeatSourcePlaced", "StrategySet",
  "MoveRequested", "GiveRequested", "ActionValidated", "GiveValidated", "ActionCompleted",
  // Iteration 15 — suppress bootstrap and location events from presentation
  "LocationDefined", "WorldObjectPlaced",
  // World Interaction Model gate and bootstrap events are not player-facing.
  "ObjectPlaced", "InteractionRequested", "InteractionTimeValidated", "TargetResolved", "InteractionValidated",
]);

function isSuppressed(event: DomainEvent): boolean {
  if (SUPPRESSED_EVENT_TYPES.has(event.type)) return true;
  return false;
}

export function selectTurnPresentation(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  options: PresentationSelectionOptions = {},
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
    list.sort((a, b) => epistemicRank(a) - epistemicRank(b) || b.rank - a.rank || a.timestamp - b.timestamp);
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

  const batchKind = classifyBatch(events);
  const eventTypesById = new Map(events.map((event) => [event.eventId, event.type]));
  const rejectionCandidates = merged.filter((candidate) => isOneOf(candidate, eventTypesById, TERMINAL_REJECTION_EVENTS)).sort((a, b) => b.rank - a.rank || a.timestamp - b.timestamp);
  const outcomeCandidates = merged
    .filter((candidate) => isOneOf(candidate, eventTypesById, TERMINAL_OUTCOME_EVENTS) || candidate.templateId === "journey_waited")
    .sort((a, b) => b.rank - a.rank || a.timestamp - b.timestamp);

  let response: TurnResponse | null = null;
  let responseCandidate: PresentationCandidate | null = null;
  if (batchKind === "player_command") {
    responseCandidate = rejectionCandidates[0] ?? outcomeCandidates[0] ?? null;
    if (!responseCandidate) {
      const attempted = merged.find((candidate) => candidate.templateId === "action_attempted");
      responseCandidate = attempted
        ? { ...attempted, templateId: "command_neutral_outcome", text: "Ты начинаешь действовать, но пока не видишь заметного результата." }
        : {
            templateId: "command_neutral_outcome", kind: "action", defaultImportance: "primary", rank: 1,
            discoveryMark: null, epistemicClass: "established_fact",
            text: "Ты начинаешь действовать, но пока не видишь заметного результата.",
            timestamp: events[0]?.timestamp ?? world.time,
            sourceEventIds: events.filter((event) => PLAYER_COMMAND_EVENTS.has(event.type)).map((event) => event.eventId),
            groupKey: null, threadKey: null, threadLabel: null,
          };
    }
    const rejection = rejectionCandidates.includes(responseCandidate)
      || rejectionCandidates.some((candidate) => candidate.sourceEventIds.some((id) => responseCandidate!.sourceEventIds.includes(id)));
    response = responseFor(responseCandidate, rejection ? "action_rejection" : "action_outcome");
  } else if (batchKind === "empty_initial_state" && options.allowEmptyStateFallback === true) {
    const empty = emptyStateEntry(world);
    response = { kind: "empty_state", text: empty.text, sourceEventIds: [] };
  }

  let primary: PresentationEntry | null = null;
  let selectedPrimary: PresentationCandidate | null = responseCandidate;
  if (responseCandidate) {
    primary = toEntry(responseCandidate, "primary");
  } else if (primaryCandidates.length > 0) {
    selectedPrimary = primaryCandidates[0]!;
    primary = toEntry(selectedPrimary, "primary");
  } else if (batchKind === "empty_initial_state" && options.allowEmptyStateFallback === true) {
    primary = emptyStateEntry(world);
  }

  const remaining: PresentationCandidate[] = [];
  for (const candidate of [...primaryCandidates, ...nonPrimaryCandidates]) {
    if (selectedPrimary === candidate) continue;
    if (batchKind === "player_command" && responseCandidate && candidate.templateId === "action_attempted") continue;
    remaining.push(candidate);
  }

  // Classify remaining
  const notable: PresentationEntry[] = [];
  const background: PresentationEntry[] = [];

  for (const c of remaining) {
    const imp = c.defaultImportance;
    const entry: PresentationEntry = {
      kind: c.kind,
      importance: imp,
      epistemicClass: c.epistemicClass,
      discoveryMark: c.discoveryMark,
      text: c.text,
      timestamp: c.timestamp,
      sourceEventIds: c.sourceEventIds,
      threadKey: c.threadKey,
      threadLabel: c.threadLabel,
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
    response,
    primary,
    notable,
    background,
    suppressedEventCount: suppressed,
    worldTime: world.time,
    playerPosition: { x: world.player.x, y: world.player.y },
  };
}
const EPISTEMIC_ORDER: Readonly<Record<PresentationCandidate["epistemicClass"], number>> = {
  interpretation: 0,
  testimony: 1,
  inference: 2,
  observed_fact: 3,
  established_fact: 4,
};

function epistemicRank(candidate: PresentationCandidate): number {
  return EPISTEMIC_ORDER[candidate.epistemicClass];
}
