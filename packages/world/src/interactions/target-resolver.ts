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

/**
 * The connection destination a raw target names in the current location,
 * or null — the verbatim connection-name comparison historically inlined in
 * `interactionMovement`, now shared so the approach routing, the command
 * preflight and the contextual validator all ask ONE question (npc-close-
 * approach phase 1, ADR-0013 amendment).
 */
export function locationConnectionDestination(world: ReadonlyWorld, rawTarget: string): string | null {
  const locationId = world.currentLocationId;
  if (!locationId) return null;
  const location = world.locations.get(locationId);
  if (!location) return null;
  const targetRaw = rawTarget.trim().toLowerCase();
  if (!targetRaw) return null;
  for (const [connName, connTarget] of Object.entries(location.connections)) {
    if (targetRaw.includes(connName) || targetRaw.includes(connTarget)) return connTarget;
  }
  return null;
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
  | { readonly kind: "contact"; readonly name: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "other" };

export function resolveApproachTarget(world: ReadonlyWorld, rawTarget: string): ApproachTarget {
  if (locationConnectionDestination(world, rawTarget)) return { kind: "other" };
  const resolution = resolveInteractionTarget(world, "approach", rawTarget);
  if (resolution.kind === "resolved") {
    const entity = world.entities.get(resolution.target.id);
    const contact = entity?.components.contact;
    if (contact && contact.locationId === world.currentLocationId) {
      return { kind: "contact", name: resolution.target.name };
    }
    return { kind: "other" };
  }
  // Not resolvable here: a target that NAMES a contact known anywhere is a
  // person not present in this location («подойти к перевозчику» from the
  // city) — absence, not a passage problem. Anything else (roads, places,
  // unknown names — living-region connections are empty, so movement keeps
  // its historical `no_passage` wording for them) stays `other`.
  if (resolution.kind === "ambiguous") return { kind: "unavailable" };
  for (const entity of world.entities.values()) {
    const contact = entity.components.contact;
    if (!contact) continue;
    if (matchLevel([entity.name, ...entity.aliases], rawTarget.trim().toLowerCase()) !== null) {
      return { kind: "unavailable" };
    }
  }
  return { kind: "other" };
}
