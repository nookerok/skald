/**
 * Continuation momentum (plan_9 §10, fourth part of the answer).
 *
 * Every master answer must leave the game moving: a reaction to the
 * replica, a result (or an honest reason), a scene change or telling
 * detail, and a natural continuation — never a command menu and never a
 * technical demand. This module builds only the fourth part, from
 * observer-safe affordances the player already knows: an active journey
 * leg, a known contact, a known route, an accessible item. It never
 * invents entities, routes or threats.
 *
 * Pure and total: no world access, no events, no network. The composer
 * decides whether the assembled answer already carries momentum (it ends
 * with a question) and appends the hint only then missing.
 */

import type { GameDirectorContext } from "./context.js";

/** Longest continuation hint: a UI-bounded single line, never a menu. */
export const CONTINUATION_MAX_CHARS = 220;

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/gu, " ");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Builds one natural continuation line from the director context.
 * Priority is deterministic: an active journey leg first, then one known
 * contact, then one known route, then one accessible item. Returns null
 * when nothing observer-safe can continue the scene — silence instead of
 * an invented hook. Pure and total.
 */
export function buildContinuationHint(
  director: Pick<GameDirectorContext, "journeyState" | "knownContacts" | "availableRoutes" | "accessibleItemsAndAffordances" | "pendingClarification">,
): string | null {
  if (director.pendingClarification) return null;
  const journey = director.journeyState;
  if (journey.status === "in_progress" && journey.to) {
    return freeze(`Можно продолжить путь к «${journey.to}» или осмотреться перед следующим переходом.`);
  }
  if (journey.status === "planned" && journey.to) {
    return freeze(`Можно отправиться в путь к «${journey.to}» или сначала расспросить местных.`);
  }
  if (journey.status === "blocked" && journey.to) {
    return freeze(`Путь к «${journey.to}» перекрыт. Можно поискать обход или переждать.`);
  }
  const contact = director.knownContacts[0]?.label ?? null;
  const route = director.availableRoutes[0]?.label ?? null;
  if (contact && route) {
    return freeze(`Можно расспросить ${contact} или проверить путь к «${route}».`);
  }
  if (contact) {
    return freeze(`Можно расспросить ${contact} о том, что изменилось.`);
  }
  if (route) {
    return freeze(`Можно проверить путь к «${route}» или осмотреться здесь.`);
  }
  const item = director.accessibleItemsAndAffordances[0]?.label ?? null;
  if (item) {
    return freeze(`Можно использовать ${item} или осмотреться вокруг.`);
  }
  return null;
}

/**
 * True when the assembled answer already moves the game: it ends with a
 * question or names a concrete next step. Pure and total.
 */
export function hasGameMomentum(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith("?")) return true;
  const lowered = trimmed.toLowerCase();
  return (
    lowered.includes("можно ") ||
    lowered.includes("стоит ") ||
    lowered.includes("попроб") ||
    lowered.includes("расспроси")
  );
}

/**
 * Ensures the four-part shape: when the text already carries momentum it
 * is returned unchanged; otherwise the observer-safe hint is appended as
 * the final line (bounded, single sentence). Never invents when the hint
 * is null. Pure and total.
 */
export function ensureGameMomentum(text: string, hint: string | null): string {
  const base = text.trim();
  if (base.length === 0) return clean(hint) ?? "";
  if (hasGameMomentum(base)) return base;
  const line = clean(hint);
  if (!line) return base;
  const bounded = line.length > CONTINUATION_MAX_CHARS ? `${line.slice(0, CONTINUATION_MAX_CHARS - 1).trimEnd()}…` : line;
  return `${base} ${bounded}`;
}
