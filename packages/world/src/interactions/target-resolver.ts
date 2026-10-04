/**
 * Interaction Model v1 — unified Target Resolver (ADR-0013 §3).
 *
 * Runtime, offline classification and HTTP tests share this resolver. It
 * exposes only observer-visible candidates and never guesses an ambiguous
 * target. Items inside an accessible open container are visible to `take`.
 */

import type { Entity } from "../entities/types.js";
import type { ReadonlyWorld } from "../projection.js";
import { sameRussianStem } from "@skald/intent-parser";
import { isItemAccessible } from "../action-capability/capability.js";
import { observedRouteEndpoints } from "../journey/route-resolver.js";
import { targetFromEntity, targetFromObject } from "./target-view.js";
import type { InteractionTarget, PlayerFacingCandidate, TargetResolution } from "./types.js";

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/^[?!.,;:]+|[?!.,;:]+$/gu, "");
}

function isNearby(entity: Entity, world: ReadonlyWorld): boolean {
  return Math.abs(entity.x - world.player.x) + Math.abs(entity.y - world.player.y) <= 1;
}

type MatchLevel = "exact" | "stem" | "partial" | null;

function matchLevel(names: readonly string[], query: string): MatchLevel {
  if (!query) return null;
  for (const candidate of names) if (normalized(candidate) === query) return "exact";
  // Russian case inflection («воде» → «вода»): stem comparison rescues
  // declined surfaces. Exact equality always wins; see the pool rule below.
  const queryWords = query.split(/\s+/u);
  for (const candidate of names) {
    const nameWords = normalized(candidate).split(/\s+/u);
    if (queryWords.length > 0 && queryWords.length <= nameWords.length
      && queryWords.every((word, index) => {
        const nameWord = nameWords[index] ?? "";
        return word.length > 0 && (word === nameWord || sameRussianStem(word, nameWord));
      })) {
      return "stem";
    }
  }
  for (const candidate of names) {
    const name = normalized(candidate);
    if (name.includes(query) || query.includes(name)) return "partial";
  }
  return null;
}

function collectCandidates(world: ReadonlyWorld, query: string, verb: string): InteractionTarget[] {
  const byId = new Map<string, InteractionTarget>();
  const locationId = world.currentLocationId;
  const location = locationId ? world.locations.get(locationId) : undefined;

  for (const id of location?.objectIds ?? []) {
    const object = world.objects.get(id);
    if (object && matchLevel([object.name, ...object.aliases], query) !== null) byId.set(id, targetFromObject(object));
  }

  // A contained item is a valid `take` target only when its full placement is
  // accessible; hidden or closed-container contents never leak to the UI.
  if (verb === "take" || verb === "give") {
    for (const [id, placement] of world.actionCapabilities?.placements ?? []) {
      if (verb === "take" && placement.kind !== "container") continue;
      if (!isItemAccessible(world, "player", id)) continue;
      const object = world.objects.get(id);
      if (object && matchLevel([object.name, ...object.aliases], query) !== null) byId.set(id, targetFromObject(object));
    }
  }

  // For `place` the object to place is carried; for `use` the instrument is
  // carried. Both must be visible to the resolver or the canonical chain
  // rejects a carried target as missing.
  if (verb === "place" || verb === "use") {
    for (const [id, placement] of world.actionCapabilities?.placements ?? []) {
      if (placement.kind !== "carried") continue;
      if (!isItemAccessible(world, "player", id)) continue;
      const object = world.objects.get(id);
      if (object && matchLevel([object.name, ...object.aliases], query) !== null) byId.set(id, targetFromObject(object));
    }
  }

  for (const entity of world.entities.values()) {
    if (world.objects.has(entity.id)) continue;
    // Presence must agree with what the observer context shows: a contact is
    // present where `buildVisibleContacts` shows it — by contact location,
    // not by coordinates. Canon-placed contacts (e.g. «Староста южного
    // посада» at 9500,5000) never share the player's spawn grid (0,0), so a
    // coordinate-only check silently made every region NPC untargetable:
    // the master answered «рядом стоит староста» while «я подхожу к
    // старосте» died in the advisory resolver as «не удаётся связать с тем,
    // что видно» (live playtest). Grid NPCs without a contact component
    // keep the coordinate rule.
    const contact = entity.components.contact;
    const present = contact
      ? contact.locationId === world.currentLocationId
      : isNearby(entity, world);
    if (!present) continue;
    if (matchLevel([entity.name, ...entity.aliases], query) !== null) byId.set(entity.id, targetFromEntity(entity));
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function toCandidates(targets: readonly InteractionTarget[]): readonly PlayerFacingCandidate[] {
  // Do not deduplicate by display name: two physical targets may share a
  // name, and collapsing them would make the clarification impossible. The
  // player-facing adapter omits internal ids but preserves each description.
  return targets.map((target) => ({ name: target.name, description: target.description }));
}

/** Resolves one target from the observer-scoped world snapshot. */
export function resolveInteractionTarget(world: ReadonlyWorld, verb: string, query: string): TargetResolution {
  const object = normalized(query);
  if (object.length === 0) {
    if (verb === "observe" || verb === "listen") {
      const locationId = world.currentLocationId;
      if (locationId) return { kind: "environment", locationId };
      if (world.entities.has("old-cart")) return { kind: "environment", locationId: "legacy_overworld" };
    }
    return { kind: "missing" };
  }

  const candidates = collectCandidates(world, object, verb);
  const exact = candidates.filter((target) => matchLevel([target.name, ...target.aliases], object) === "exact");
  const stem = exact.length === 0
    ? candidates.filter((target) => matchLevel([target.name, ...target.aliases], object) === "stem")
    : [];
  const pool = exact.length > 0 ? exact : stem.length > 0 ? stem : candidates;
  if (pool.length === 0) {
    // Observing where you stand is always legitimate: a perception target
    // naming the current location ("осмотреть переправу" at the crossing)
    // resolves to the environment instead of an "unknown target" rejection.
    // inspect stays strict: close examination still needs the object.
    if ((verb === "observe" || verb === "listen") && matchesCurrentLocation(world, object)) {
      const locationId = world.currentLocationId;
      if (locationId) return { kind: "environment", locationId };
    }
    // Named water is observer-safe ambience for observe, mirroring listen:
    // "наблюдаю за водой" names its object (the local water), so it
    // resolves to the environment instead of an "unknown target"
    // rejection. This deliberately extends the earlier listen-only
    // ambience rule: live play showed a scored-zero core river verb
    // there, and the object requirement stays satisfied by the named
    // water itself. inspect stays strict.
    if (verb === "observe" && isWaterSurface(object)) {
      const locationId = world.currentLocationId;
      if (locationId) return { kind: "environment", locationId };
    }
    return { kind: "missing" };
  }
  if (pool.length === 1) return { kind: "resolved", target: pool[0]! };
  return { kind: "ambiguous", candidates: toCandidates(pool) };
}

/** Water/river vocabulary shared with the environmental-indication inquiry. */
const WATER_SURFACE_WORDS: readonly string[] = [
  "вода", "река", "течение", "волна", "ручей",
];

/** Prepositions carrying no referent meaning in a target surface. */
const TARGET_STOP_WORDS: ReadonlySet<string> = new Set([
  "к", "ко", "в", "во", "на", "за", "у", "о", "об", "с", "со", "под", "над",
]);

/** True when every query word is a water word (any declension). */
function isWaterSurface(query: string): boolean {
  const words = query.split(/\s+/u).filter((word) => word.length > 0 && !TARGET_STOP_WORDS.has(word));
  if (words.length === 0) return false;
  return words.every((word) =>
    WATER_SURFACE_WORDS.some((keyword) => word === keyword || sameRussianStem(word, keyword)),
  );
}

/**
 * True when every word of the query stem-matches a word of the current
 * location name ("переправу" meets "Переправа у Чёрного леса"). Word-wise
 * and unordered: location names carry filler words ("у") the player omits.
 * Shared stemmer, same conservatism as object matching.
 */
function matchesCurrentLocation(world: ReadonlyWorld, query: string): boolean {
  const locationId = world.currentLocationId;
  const location = locationId ? world.locations.get(locationId) : undefined;
  if (!location) return false;
  const queryWords = query.split(/\s+/u).filter((word) => word.length > 0);
  if (queryWords.length === 0) return false;
  const nameWords = normalized(location.name).split(/\s+/u).filter((word) => word.length > 0);
  return queryWords.every((queryWord) =>
    nameWords.some((nameWord) => queryWord === nameWord || sameRussianStem(queryWord, nameWord)),
  );
}

/** Player-facing connection-name words. Internal ids are never a search surface. */
function connectionNameWords(name: string): string[] {
  return name.toLowerCase().replace(/_/gu, " ").split(/\s+/u).filter((word) => word.length > 0);
}

/**
 * Rank one query against one connection NAME (never its internal destination
 * id). Exact-full-label (4) beats all-content-words (3), which beats one exact
 * word (2), which beats one shared stem (1); 0 is no match. So «ворота»
 * prefers the exact «Ворота» over «Северные ворота», while a declined
 * «северным воротам» still prefers «Северные ворота» over «Старые ворота».
 */
function connectionRank(queryWords: readonly string[], nameWords: readonly string[]): number {
  if (nameWords.length === 0) return 0;
  const exactLabel = queryWords.length === nameWords.length
    && queryWords.every((word) => nameWords.includes(word));
  if (exactLabel) return 4;
  let anyExact = false;
  let anyStem = false;
  let allMatch = queryWords.length > 0;
  for (const queryWord of queryWords) {
    let wordMatched = false;
    for (const nameWord of nameWords) {
      if (queryWord === nameWord) { anyExact = true; wordMatched = true; }
      else if (sameRussianStem(queryWord, nameWord)) { anyStem = true; wordMatched = true; }
    }
    if (!wordMatched) allMatch = false;
  }
  if (allMatch) return 3;
  if (anyExact) return 2;
  if (anyStem) return 1;
  return 0;
}

/**
 * Every connection the raw target names at the top rank, observer-safe
 * (ADR-0039/T9): only the player-facing connection NAME is matched, never the
 * internal destination id, so knowing an internal id cannot address an
 * unobserved route. Morphological, and returns ALL ties so callers can ask
 * instead of silently choosing the first.
 */
export function locationConnectionMatches(
  world: ReadonlyWorld,
  rawTarget: string,
): ReadonlyArray<{ readonly connectionName: string; readonly destinationId: string }> {
  const locationId = world.currentLocationId;
  if (!locationId) return [];
  const location = world.locations.get(locationId);
  if (!location) return [];
  const queryWords = rawTarget.trim().toLowerCase().split(/\s+/u)
    .filter((word) => word.length > 0 && !TARGET_STOP_WORDS.has(word));
  if (queryWords.length === 0) return [];
  const scored: Array<{ connectionName: string; destinationId: string; rank: number }> = [];
  for (const [connectionName, destinationId] of Object.entries(location.connections)) {
    const rank = connectionRank(queryWords, connectionNameWords(connectionName));
    if (rank > 0) scored.push({ connectionName, destinationId, rank });
  }
  if (scored.length === 0) return [];
  const topRank = Math.max(...scored.map((entry) => entry.rank));
  return scored
    .filter((entry) => entry.rank === topRank)
    .map(({ connectionName, destinationId }) => ({ connectionName, destinationId }));
}

/** The first connection match, for the authoritative movement rule path. */
export function locationConnectionMatch(
  world: ReadonlyWorld,
  rawTarget: string,
): { readonly connectionName: string; readonly destinationId: string } | null {
  return locationConnectionMatches(world, rawTarget)[0] ?? null;
}

/**
 * Observer-safe connection candidates for the preflight/gateway (ADR-0039,
 * T10): reuses the existing observer-scoped spatial read model
 * (`observedRouteEndpoints`) so a connection whose destination the player has
 * not observed is invisible to preflight. A legacy world without a spatial
 * model keeps its authored location graph (there is no knowledge model to
 * filter against). The authoritative movement Rule still reads the full
 * snapshot through `locationConnectionDestination`.
 */
export function observerSafeConnectionMatches(
  world: ReadonlyWorld,
  rawTarget: string,
): ReadonlyArray<{ readonly connectionName: string; readonly destinationId: string }> {
  const matches = locationConnectionMatches(world, rawTarget);
  if (matches.length === 0 || !world.spatial) return matches;
  const known = new Set(
    observedRouteEndpoints(world.spatial, world.spatialKnowledge, world.currentLocationId).map((endpoint) => endpoint.id),
  );
  return matches.filter((match) => known.has(match.destinationId));
}

/**
 * The connection destination a raw target names in the current location, or
 * null — the shared question asked by the approach routing, the command
 * preflight and the contextual validator (npc-close-approach phase 1,
 * ADR-0013 amendment; morphological since ADR-0039/T9).
 */
export function locationConnectionDestination(world: ReadonlyWorld, rawTarget: string): string | null {
  return locationConnectionMatch(world, rawTarget)?.destinationId ?? null;
}

/**
 * Who owns the outcome of `mode: relocate, operation: approach` for one raw
 * target (npc-close-approach phase 1): exactly one of the three — the
 * contact-approach rule, the movement rule, or a pre-execution refusal —
 * so a player never sees both an approach outcome and `no_passage`.
 *
 * - `contact`: the target resolves to a contact PRESENT in the current
 *   location (the same presence rule as the observer context);
 * - `other`: a location connection, a non-contact target (object/route),
 *   or a name that matches no contact anywhere — the existing
 *   movement/connection path keeps ownership and its historical wording;
 * - `unavailable`: a contact that exists but is not present here, or a
 *   mid-flight ambiguity — ambiguity is asked BEFORE execution (command
 *   preflight / contextual validation); at rule level it reports absence
 *   rather than picking the first candidate.
 */
export type ApproachTarget =
  | { readonly kind: "contact"; readonly name: string; readonly ref: string }
  | { readonly kind: "unavailable"; readonly name?: string }
  | { readonly kind: "other" };

export function resolveApproachTarget(world: ReadonlyWorld, rawTarget: string): ApproachTarget {
  const resolution = resolveInteractionTarget(world, "approach", rawTarget);
  if (resolution.kind === "resolved") {
    const entity = world.entities.get(resolution.target.id);
    const contact = entity?.components.contact;
    if (contact && contact.locationId === world.currentLocationId) {
      return { kind: "contact", name: resolution.target.name, ref: resolution.target.id };
    }
    return { kind: "other" };
  }
  // Ambiguity is asked BEFORE execution (command preflight / contextual
  // validation); at rule level it reports absence rather than picking one.
  if (resolution.kind === "ambiguous") return { kind: "unavailable" };
  // Not resolvable as a present target: a connection is movement, and a name
  // that matches a contact known anywhere is a person not present in this
  // location («подойти к перевозчику» from the city) — absence, not a passage
  // problem. Anything else (roads, places, unknown names) stays `other`.
  if (locationConnectionDestination(world, rawTarget)) return { kind: "other" };
  for (const entity of world.entities.values()) {
    const contact = entity.components.contact;
    if (!contact) continue;
    if (matchLevel([entity.name, ...entity.aliases], rawTarget.trim().toLowerCase()) !== null) {
      return { kind: "unavailable", name: entity.name };
    }
  }
  return { kind: "other" };
}

/** Operation-aware classification of one movement intent (ADR-0039 §2). */
export type MovementTarget =
  | { readonly kind: "grid_direction"; readonly direction: string }
  | { readonly kind: "connected_location"; readonly locationId: string; readonly connectionId: string }
  | { readonly kind: "present_contact"; readonly contactRef: string; readonly locationId: string | null }
  | { readonly kind: "remote_location"; readonly surface: string }
  | { readonly kind: "unavailable_contact"; readonly surface: string; readonly name: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] }
  | { readonly kind: "unknown"; readonly surface: string };

/** The intent fields `resolveMovementTarget` reads. */
export interface MovementIntentView {
  readonly type?: string | null | undefined;
  readonly operation?: string | null | undefined;
  readonly mode?: string | null | undefined;
  readonly target?: { readonly raw?: string | null | undefined } | null | undefined;
  readonly destination?: { readonly raw?: string | null | undefined } | null | undefined;
}

const COMPASS_DIRECTIONS: ReadonlySet<string> = new Set(["north", "south", "east", "west"]);

/**
 * Classify one movement intent into its single owner (ADR-0039 §2). The order
 * is operation-aware: an `approach` prefers a PRESENT CONTACT over a location
 * connection (an NPC whose name collides with a place stays approachable),
 * while `enter` and `travel`/`journey` prefer the connection/route. A compass
 * target is grid movement only when no location is active.
 */
export function resolveMovementTarget(intent: MovementIntentView, world: ReadonlyWorld): MovementTarget {
  if (intent.type === "JourneyIntent") {
    return { kind: "remote_location", surface: intent.destination?.raw?.trim() ?? "" };
  }

  const operation = intent.operation ?? null;
  const raw = intent.target?.raw?.trim() ?? "";
  const lowered = raw.toLowerCase();
  const matches = observerSafeConnectionMatches(world, raw);
  // Several equal connection names must ask, never silently pick the first.
  const connectionTarget = (): MovementTarget =>
    matches.length > 1
      ? { kind: "ambiguous", candidates: matches.map((match) => match.connectionName) }
      : { kind: "connected_location", locationId: matches[0]!.destinationId, connectionId: matches[0]!.connectionName };

  if (operation === "enter") {
    return matches.length > 0 ? connectionTarget() : { kind: "unknown", surface: raw };
  }

  if (operation === "approach") {
    const approach = resolveApproachTarget(world, raw);
    if (approach.kind === "contact") {
      return { kind: "present_contact", contactRef: approach.name, locationId: world.currentLocationId ?? null };
    }
    if (matches.length > 0) return connectionTarget();
    if (!world.currentLocationId && COMPASS_DIRECTIONS.has(lowered)) {
      return { kind: "grid_direction", direction: lowered };
    }
    if (approach.kind === "unavailable") {
      return { kind: "unavailable_contact", surface: raw, name: approach.name ?? raw };
    }
    return { kind: "unknown", surface: raw };
  }

  if (COMPASS_DIRECTIONS.has(lowered)) return { kind: "grid_direction", direction: lowered };
  if (matches.length > 0) return connectionTarget();
  return { kind: "unknown", surface: raw };
}
