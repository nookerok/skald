/**
 * MasterBrief (plan P2: give the master a game-leading function).
 *
 * A pure, deterministic read-side selection of what matters RIGHT NOW, drawn
 * from the observer-safe director context: what just happened, what changed,
 * who is on stage to react, what is urgent, what stays uncertain, the leads
 * the player can pursue and the personal thread. The LLM only turns this brief
 * into the master's voice — it never decides outcomes, and every line is
 * already player-safe material.
 *
 * No world access, no events, no projection writes, no network, no LLM.
 */

import type { SceneRhythm } from "./scene-rhythm.js";

/** Longest brief string: one UI-bounded line. */
export const MASTER_BRIEF_MAX_CHARS = 220;
/** At most this many concrete leads are offered. */
export const MASTER_BRIEF_MAX_LEADS = 3;

/** Minimal observer-safe view of the journey leg. */
export interface MasterBriefJourney {
  readonly status: string;
  readonly to: string | null;
}

/** Minimal observer-safe labelled entry (contact, route or item). */
export interface MasterBriefLabel {
  readonly label: string;
}

/** Structural inputs for one brief. Every field is already observer-safe. */
export interface MasterBriefInput {
  readonly sceneRhythm: SceneRhythm;
  readonly journey: MasterBriefJourney;
  readonly knownContacts: readonly MasterBriefLabel[];
  readonly availableRoutes: readonly MasterBriefLabel[];
  readonly accessibleItems: readonly MasterBriefLabel[];
  readonly recentConsequences: readonly MasterBriefLabel[];
  readonly knownUncertainties: readonly string[];
  /** Latest master line already spoken, when the caller has one. */
  readonly lastMasterText?: string | null | undefined;
  /** Open master question, when one is pending. */
  readonly pendingQuestion?: string | null | undefined;
  /** Unresolved personal hook or obligation. */
  readonly personalHook?: string | null | undefined;
}

/** What the master should be conscious of this turn. All prose is player-safe. */
export interface MasterBrief {
  readonly whatJustHappened: string | null;
  readonly whatChanged: string | null;
  readonly whoReacted: string | null;
  readonly whatIsUrgent: string | null;
  readonly whatRemainsUncertain: string | null;
  readonly availableLeads: readonly string[];
  readonly personalConnection: string | null;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function clean(value: string | null | undefined, max: number = MASTER_BRIEF_MAX_CHARS): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/gu, " ");
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function firstLabel(entries: readonly MasterBriefLabel[]): string | null {
  return clean(entries[0]?.label ?? null, 120);
}

/**
 * Builds the brief. Deterministic and total: the same inputs always yield the
 * same brief, and every absent source stays null rather than inventing a hook.
 */
export function buildMasterBrief(input: MasterBriefInput): MasterBrief {
  const rhythm = input.sceneRhythm;

  const whatJustHappened = clean(rhythm.changeAfterActions) ?? clean(input.lastMasterText);
  const whatChanged = clean(rhythm.changeAfterActions)
    ?? (input.journey.status === "in_progress" || input.journey.status === "blocked" || input.journey.status === "arrived"
      ? clean(input.journey.to ? `Путь к «${input.journey.to}» изменился.` : null)
      : null);
  const whoReacted = firstLabel(input.knownContacts);
  const whatIsUrgent = clean(rhythm.pressure) ?? clean(rhythm.inactionCost);
  const whatRemainsUncertain = clean(input.knownUncertainties[0] ?? null) ?? clean(input.pendingQuestion);

  const leads: string[] = [];
  const push = (lead: string | null): void => {
    if (lead && !leads.includes(lead) && leads.length < MASTER_BRIEF_MAX_LEADS) leads.push(lead);
  };
  if (input.journey.status === "in_progress" && input.journey.to) push(`продолжить путь к «${input.journey.to}»`);
  if (input.journey.status === "blocked" && input.journey.to) push(`поискать обход к «${input.journey.to}»`);
  const contact = firstLabel(input.knownContacts);
  if (contact) push(`расспросить ${contact}`);
  const route = firstLabel(input.availableRoutes);
  if (route) push(`проверить путь к «${route}»`);
  const item = firstLabel(input.accessibleItems);
  if (item) push(`использовать ${item}`);

  return freeze({
    whatJustHappened,
    whatChanged,
    whoReacted,
    whatIsUrgent,
    whatRemainsUncertain,
    availableLeads: freeze(leads),
    personalConnection: clean(input.personalHook),
  });
}
