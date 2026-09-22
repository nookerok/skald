/**
 * Game director context (plan_9 §9).
 *
 * An observer-safe read-side composition over already-committed state:
 * the bounded scene, the bounded conversation memory and the background
 * adapter context. It changes nothing and authorizes nothing — Rules,
 * Projection and the Event Log never read it. Its only job is helping the
 * narration layer choose what observer-safe material is dramatically
 * alive right now (scene, goal, thread, routes, affordances, consequences,
 * rhythm).
 *
 * JSON-safe: plain data, bounded arrays, no internal ids, no coordinates,
 * no numeric relation values, no confidence, no sourceEventIds.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { MasterTurnSceneContext } from "../master-turn/observer-context.js";
import type { NarrativeAdapterContext } from "../setup/background-context.js";
import { consequenceLabel } from "../game-shell/player-facing.js";
import { buildSceneRhythm, type SceneRhythm } from "./scene-rhythm.js";
import { buildMasterBrief, type MasterBrief } from "./brief.js";

/** Bounds: the director window stays inside the 8–12 replica plan range. */
export const GAME_DIRECTOR_MAX_LIST = 8;
export const GAME_DIRECTOR_MAX_TURNS = 12;
export const GAME_DIRECTOR_MAX_TEXT = 500;

/** Observer-safe character background for the director prompt. */
export interface GameDirectorBackground {
  readonly name: string;
  readonly backgroundTitle: string;
  readonly formerRole: string;
  readonly rupture: string;
  readonly obligation: string;
}

/** Observer-safe current scene: location plus the observed situation. */
export interface GameDirectorScene {
  readonly locationName: string;
  readonly locationDescription: string;
  readonly situationTitle: string | null;
  readonly situationDescription: string | null;
}

/** One known contact: label only, never an internal id. */
export interface GameDirectorContact {
  readonly label: string;
}

/** One available route: label plus honest passability. */
export interface GameDirectorRoute {
  readonly label: string;
  readonly status: "open" | "difficult" | "closed";
}

/** One accessible item with its currently unblocked affordances. */
export interface GameDirectorItem {
  readonly label: string;
  readonly affordances: readonly string[];
}

/** One recent consequence: human label plus an honest detail line. */
export interface GameDirectorConsequence {
  readonly label: string;
  readonly detail: string | null;
}

/** One bounded replica inside the director window. */
export interface GameDirectorTurn {
  readonly speaker: "player" | "master";
  readonly text: string;
}

/** The player's stated goal: an interpretation, never World State. */
export interface GameDirectorGoal {
  readonly summary: string;
}

/** Read-side focus: why the master holds this thread now. */
export interface GameDirectorThread {
  readonly source: "pending_clarification" | "player_goal" | "observed_situation" | "personal_hook";
  readonly title: string;
}

/** An unresolved master question: the latest clarification turn. */
export interface GameDirectorClarification {
  readonly question: string;
  readonly options: readonly { readonly optionId: string; readonly label: string }[];
}

/**
 * Journey leg as a projection of existing events (plan_9 §4 target
 * shape). No new mutable gameplay state: planned/in_progress derive from
 * the stored JourneyState elapsed ticks, arrived from completed, cancelled
 * from interrupted, blocked from blocked, idle when no journey exists.
 */
export interface GameDirectorJourney {
  readonly status: "idle" | "planned" | "in_progress" | "blocked" | "arrived" | "cancelled";
  readonly from: string | null;
  readonly to: string | null;
  readonly elapsedTicks: number;
  readonly totalTicks: number;
  readonly text: string;
}

/**
 * Observer-safe game director context. Every list is bounded and frozen;
 * every string is player-safe prose.
 */
export interface GameDirectorContext {
  readonly characterBackground: GameDirectorBackground | null;
  readonly currentScene: GameDirectorScene;
  readonly activePlayerGoal: GameDirectorGoal | null;
  readonly currentDramaticThread: GameDirectorThread | null;
  readonly visibleSituation: readonly string[];
  readonly knownContacts: readonly GameDirectorContact[];
  readonly availableRoutes: readonly GameDirectorRoute[];
  readonly accessibleItemsAndAffordances: readonly GameDirectorItem[];
  readonly recentConsequences: readonly GameDirectorConsequence[];
  readonly knownFacts: readonly string[];
  readonly knownUncertainties: readonly string[];
  readonly lastTurns: readonly GameDirectorTurn[];
  readonly pendingClarification: GameDirectorClarification | null;
  readonly journeyState: GameDirectorJourney;
  readonly unresolvedPersonalHook: string | null;
  readonly sceneRhythm: SceneRhythm;
  /** Deterministic selection of what matters now (plan P2). */
  readonly masterBrief: MasterBrief;
}

/**
 * Conversation slice feeding the director. Shaped structurally so the
 * world package never imports CLI conversation types: callers map their
 * bounded MasterConversationContext into this slice verbatim.
 */
export interface GameDirectorConversationSlice {
  readonly lastTurns: readonly GameDirectorTurn[];
  readonly activePlayerGoal: GameDirectorGoal | null;
  readonly currentDramaticThread: GameDirectorThread | null;
  readonly knownFacts: readonly string[];
  readonly knownUncertainties: readonly string[];
  readonly pendingClarification: GameDirectorClarification | null;
}

/** Inputs for one director build. All inputs are already observer-safe. */
export interface GameDirectorContextInput {
  readonly scene: MasterTurnSceneContext;
  readonly narrativeContext?: NarrativeAdapterContext | null | undefined;
  readonly conversation?: GameDirectorConversationSlice | null | undefined;
  /** Last deterministic outcome prose, for the rhythm change line. */
  readonly lastOutcome?: string | null | undefined;
  /** Explicit honest opportunity line; null lets the builder list affordances. */
  readonly opportunityCandidate?: string | null | undefined;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function clean(value: unknown, max: number = GAME_DIRECTOR_MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/gu, " ");
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function take<T>(items: readonly T[], max: number): readonly T[] {
  return freeze(items.slice(0, Math.max(0, max)));
}

/**
 * Maps the stored journey projection onto the director status vocabulary.
 * Pure: planned means a live journey that has not ticked yet, in_progress
 * a live journey with elapsed ticks. No new state is introduced.
 */
export function directorJourneyState(world: ReadonlyWorld): GameDirectorJourney {
  const active = world.activeJourneyId ? world.journeys.get(world.activeJourneyId) : undefined;
  const journeys = [...world.journeys.values()].sort((a, b) => a.startedAt - b.startedAt);
  const journey = active ?? journeys.at(-1);
  if (!journey) {
    return freeze({
      status: "idle" as const,
      from: null,
      to: null,
      elapsedTicks: 0,
      totalTicks: 0,
      text: "Путешествие начнётся, когда ты выберешь путь.",
    });
  }
  const from = world.locations.get(journey.fromLocationId)?.name ?? null;
  const to = world.locations.get(journey.toLocationId)?.name ?? null;
  if (journey.status === "blocked") {
    const cause = journey.blockedReason === "crossing_closed" ? "переправа закрыта" : "путь перекрыт";
    return freeze({
      status: "blocked" as const,
      from,
      to,
      elapsedTicks: journey.elapsedTicks,
      totalTicks: journey.plannedTicks,
      text: to ? `Путь к «${to}» перекрыт: ${cause}.` : "Путь перекрыт.",
    });
  }
  if (journey.status === "completed") {
    return freeze({
      status: "arrived" as const,
      from,
      to,
      elapsedTicks: journey.plannedTicks,
      totalTicks: journey.plannedTicks,
      text: to ? `Ты добрался до «${to}».` : "Путешествие завершено.",
    });
  }
  if (journey.status === "interrupted") {
    return freeze({
      status: "cancelled" as const,
      from,
      to,
      elapsedTicks: journey.elapsedTicks,
      totalTicks: journey.plannedTicks,
      text: "Путь прерван. Ты сохранил знание только о пройденном участке.",
    });
  }
  if (journey.elapsedTicks <= 0) {
    return freeze({
      status: "planned" as const,
      from,
      to,
      elapsedTicks: journey.elapsedTicks,
      totalTicks: journey.plannedTicks,
      text: to ? `Путь к «${to}» намечен.` : "Путь намечен.",
    });
  }
  return freeze({
    status: "in_progress" as const,
    from,
    to,
    elapsedTicks: journey.elapsedTicks,
    totalTicks: journey.plannedTicks,
    text: to ? `Ты в пути к «${to}».` : "Ты в пути.",
  });
}

/**
 * Recent consequences as observer-safe lines, newest first. The source is
 * the committed Event Log, never the world consequence map: a merely
 * created consequence is an internal schedule the player has never seen
 * (presentation contract: Created is hidden, Fired surfaces — e.g. a
 * noise_attention consequence from a sound the player never heard).
 *
 * Firing alone is still not observation proof: ConsequenceFired carries
 * no observerId, so an unheard NPC firing must stay out of the narration
 * prompt as well. A firing qualifies only with explicit player scope —
 * an AudacityTriggered aimed at the player from the same expiry event.
 * Future consequence types need their own player-scope evidence to enter
 * the prompt; journal surfacing alone never suffices.
 *
 * Labels come from the closed player-facing vocabulary; internal ids
 * never cross. Pure and total.
 */
export function directorRecentConsequences(events: readonly DomainEvent[]): readonly GameDirectorConsequence[] {
  const playerScopedExpiry = new Set<string>();
  for (const event of events) {
    if (event.type !== "AudacityTriggered") continue;
    const payload = event.payload as { target?: unknown };
    if (payload.target !== "player") continue;
    if (typeof event.causationId === "string" && event.causationId.length > 0) {
      playerScopedExpiry.add(event.causationId);
    }
  }
  const fired = new Map<string, { label: string; at: number }>();
  for (const event of events) {
    if (event.type !== "ConsequenceFired") continue;
    // Same expiry event as the player-targeted trigger, or the firing
    // stays out of the prompt.
    if (typeof event.causationId !== "string" || !playerScopedExpiry.has(event.causationId)) continue;
    const payload = event.payload as { consequenceId?: unknown; consequenceType?: unknown; firedAt?: unknown };
    if (typeof payload.consequenceId !== "string") continue;
    if (!fired.has(payload.consequenceId)) {
      fired.set(payload.consequenceId, {
        label: consequenceLabel(typeof payload.consequenceType === "string" ? payload.consequenceType : ""),
        at: typeof payload.firedAt === "number" ? payload.firedAt : event.timestamp,
      });
    }
  }
  const list = [...fired.values()].sort((a, b) => b.at - a.at);
  return take(
    list.map((entry) => freeze({
      label: entry.label,
      detail: clean(`проявилось на ходе ${entry.at}`, 120),
    })),
    GAME_DIRECTOR_MAX_LIST,
  );
}

/**
 * Builds the observer-safe game director context. Pure and read-only:
 * emits no Domain Events, writes no Projection, performs no network
 * calls. The same events/world/inputs always yield the same context, so
 * a reload changes nothing.
 */
export function buildGameDirectorContext(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  input: GameDirectorContextInput,
): GameDirectorContext {
  const scene = input.scene;
  const narrative = input.narrativeContext ?? null;
  const conversation = input.conversation ?? null;

  const characterBackground = narrative
    ? freeze({
      name: clean(narrative.character.name, 120) ?? "путник",
      backgroundTitle: clean(narrative.character.backgroundTitle, 200) ?? "",
      formerRole: clean(narrative.character.formerRole, 300) ?? "",
      rupture: clean(narrative.character.rupture, 300) ?? "",
      obligation: clean(narrative.character.obligation, 300) ?? "",
    })
    : null;

  const currentScene = freeze({
    locationName: clean(scene.currentLocation.name, 160) ?? "",
    locationDescription: clean(scene.currentLocation.description) ?? "",
    situationTitle: clean(scene.currentSituation?.title ?? null, 160),
    situationDescription: clean(scene.currentSituation?.description),
  });

  const visibleLines: string[] = [];
  for (const fact of narrative?.visibleSituation.facts ?? []) {
    const line = clean(fact.text, 300);
    if (line) visibleLines.push(line);
  }
  for (const fact of narrative?.visibleSituation.sensoryContext ?? []) {
    const line = clean(fact.text, 300);
    if (line) visibleLines.push(line);
  }
  if (visibleLines.length === 0 && scene.currentSituation) {
    const fallback = clean(scene.currentSituation.description, 300);
    if (fallback) visibleLines.push(fallback);
  }
  const visibleSituation = take(visibleLines, GAME_DIRECTOR_MAX_LIST);

  const knownContacts = take(
    scene.knownPeople.map((entry) => freeze({ label: clean(entry.label, 120) ?? "" })).filter((entry) => entry.label !== ""),
    GAME_DIRECTOR_MAX_LIST,
  );
  const availableRoutes = take(
    scene.knownRoutes.map((entry) => freeze({
      label: clean(entry.label, 120) ?? "",
      status: entry.status ?? "open",
    })).filter((entry) => entry.label !== ""),
    GAME_DIRECTOR_MAX_LIST,
  );
  const accessibleItemsAndAffordances = take(
    scene.accessibleItems.map((entry) => freeze({
      label: clean(entry.label, 120) ?? "",
      affordances: freeze(entry.affordances.slice(0, 6)),
    })).filter((entry) => entry.label !== ""),
    GAME_DIRECTOR_MAX_LIST,
  );

  const recentConsequences = directorRecentConsequences(events);
  const journeyState = directorJourneyState(world);

  const lastTurns = take(
    (conversation?.lastTurns ?? []).map((turn) => freeze({
      speaker: turn.speaker,
      text: clean(turn.text) ?? "",
    })).filter((turn) => turn.text !== ""),
    GAME_DIRECTOR_MAX_TURNS,
  );
  const knownFacts = take(
    (conversation?.knownFacts ?? []).map((line) => clean(line, 300)).filter((line): line is string => line !== null),
    GAME_DIRECTOR_MAX_LIST,
  );
  const knownUncertainties = take(
    (conversation?.knownUncertainties ?? []).map((line) => clean(line, 300)).filter((line): line is string => line !== null),
    GAME_DIRECTOR_MAX_LIST,
  );

  const activePlayerGoal = conversation?.activePlayerGoal
    ? freeze({ summary: clean(conversation.activePlayerGoal.summary, 200) ?? "" })
    : null;
  const goal = activePlayerGoal && activePlayerGoal.summary !== "" ? activePlayerGoal : null;
  const currentDramaticThread = conversation?.currentDramaticThread
    ? freeze({ source: conversation.currentDramaticThread.source, title: clean(conversation.currentDramaticThread.title, 200) ?? "" })
    : null;
  const thread = currentDramaticThread && currentDramaticThread.title !== "" ? currentDramaticThread : null;
  const pendingClarification = conversation?.pendingClarification
    ? freeze({
      question: clean(conversation.pendingClarification.question) ?? "",
      options: freeze(conversation.pendingClarification.options.slice(0, 6).map((option) => freeze({ ...option }))),
    })
    : null;
  const pending = pendingClarification && pendingClarification.question !== "" ? pendingClarification : null;

  const unresolvedPersonalHook = clean(narrative?.arrival.personalHook ?? null, 300);

  const opportunityCandidate = clean(input.opportunityCandidate ?? null, 300)
    ?? (availableRoutes[0] ? `Открыт путь к «${availableRoutes[0].label}».` : null)
    ?? (accessibleItemsAndAffordances[0] ? `Доступно: ${accessibleItemsAndAffordances[0].label}.` : null);

  const sceneRhythm = buildSceneRhythm({
    situation: scene.currentSituation,
    journey: {
      status: journeyState.status === "in_progress" || journeyState.status === "planned"
        ? "traveling"
        : journeyState.status === "arrived"
          ? "completed"
          : journeyState.status === "cancelled"
            ? "interrupted"
            : journeyState.status === "blocked"
              ? "blocked"
              : "idle",
      from: journeyState.from,
      to: journeyState.to,
      elapsedTicks: journeyState.elapsedTicks,
      totalTicks: journeyState.totalTicks,
      text: journeyState.text,
    },
    recentConsequences: recentConsequences.map((entry) => ({ label: entry.label, ...(entry.detail ? { detail: entry.detail } : {}) })),
    ...(goal ? { activeGoal: goal.summary } : {}),
    ...(pending ? { pendingQuestion: pending.question } : {}),
    ...(clean(input.lastOutcome ?? null, 500) ? { lastOutcome: clean(input.lastOutcome ?? null, 500)! } : {}),
    ...(opportunityCandidate ? { opportunityCandidate } : {}),
  });

  const masterBrief = buildMasterBrief({
    sceneRhythm,
    journey: journeyState,
    knownContacts,
    availableRoutes,
    accessibleItems: accessibleItemsAndAffordances,
    recentConsequences,
    knownUncertainties,
    lastMasterText: lastTurns.filter((turn) => turn.speaker === "master").at(-1)?.text ?? null,
    pendingQuestion: pending?.question ?? null,
    personalHook: unresolvedPersonalHook,
    activeGoal: goal?.summary ?? null,
  });

  return freeze({
    characterBackground,
    currentScene,
    activePlayerGoal: goal,
    currentDramaticThread: thread,
    visibleSituation,
    knownContacts,
    availableRoutes,
    accessibleItemsAndAffordances,
    recentConsequences,
    knownFacts,
    knownUncertainties,
    lastTurns,
    pendingClarification: pending,
    journeyState,
    unresolvedPersonalHook,
    sceneRhythm,
    masterBrief,
  });
}
