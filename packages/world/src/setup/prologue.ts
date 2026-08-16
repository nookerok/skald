import type { FirstEntryDTO } from "../presence/types.js";
import type { CharacterBackground, PrologueDTO, RegionEntrypoint } from "./types.js";

function sentenceList(values: readonly (string | null | undefined)[]): string {
  return values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean).join(" ");
}

/** Compatibility presentation adapter for the canonical first-entry scene. */
export function buildPrologueFromFirstEntry(entry: FirstEntryDTO): PrologueDTO {
  const contact = entry.knownContact
    ? "Первым к тебе подходит " + entry.knownContact.name + ": " + entry.knownContact.description
    : "";
  const sensory = entry.sensoryContext.join(" ");
  return Object.freeze({
    title: "История " + entry.character.name,
    paragraphs: Object.freeze([
      entry.character.name + " — " + entry.background.summary,
      sentenceList([entry.startingLocation.title + ".", entry.startingLocation.description, sensory]),
      sentenceList([entry.reasonForArrival, entry.personalHook]),
      sentenceList([contact, entry.visibleSituation]),
    ].filter(Boolean)),
    backgroundReminder: entry.personalHook,
    locationTitle: entry.startingLocation.title,
    openingHook: entry.personalHook,
  });
}

/** Pure, non-authoritative onboarding adapter retained for legacy clients. */
export function buildPrologue(input: {
  readonly characterName: string;
  readonly background: CharacterBackground;
  readonly entrypoint: RegionEntrypoint;
}): PrologueDTO {
  const name = input.characterName.trim();
  const background = input.background;
  const entrypoint = input.entrypoint;
  const firstEntry: FirstEntryDTO = Object.freeze({
    schemaVersion: 1,
    character: Object.freeze({ name }),
    background: Object.freeze({
      title: background.title,
      summary: sentenceList([background.history, background.formerRole, background.rupture]),
    }),
    startingLocation: Object.freeze({
      title: entrypoint.title,
      description: entrypoint.description,
    }),
    reasonForArrival: sentenceList([
      background.reasonInRegion,
      entrypoint.backgroundConnections.find((connection) => connection.backgroundId === background.id)?.arrivalHook
        ?? entrypoint.backgroundBridges[background.id]
        ?? entrypoint.openingSituation,
    ]),
    visibleSituation: sentenceList([entrypoint.openingSituation, entrypoint.openingProblem]),
    sensoryContext: Object.freeze([entrypoint.arrivalScene, entrypoint.atmosphere]),
    knownContact: Object.freeze({
      name: entrypoint.localContact.name,
      description: entrypoint.localContact.description,
    }),
    personalHook: sentenceList([
      background.openingHook,
      background.obligation,
      background.startingItem,
    ]),
  });
  return buildPrologueFromFirstEntry(firstEntry);
}
