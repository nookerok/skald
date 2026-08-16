import type { CharacterPreset, PrologueDTO, RegionEntrypoint } from "./types.js";

/** Pure, non-authoritative onboarding prose assembled from accepted content. */
export function buildPrologue(input: {
  readonly characterName: string;
  readonly background: CharacterPreset;
  readonly entrypoint: RegionEntrypoint;
}): PrologueDTO {
  const name = input.characterName.trim();
  const background = input.background;
  const entrypoint = input.entrypoint;
  return Object.freeze({
    title: `История ${name}`,
    paragraphs: Object.freeze([
      `${name} — ${background.history}`,
      `${entrypoint.title}. ${entrypoint.description} ${entrypoint.atmosphere}`,
      `${background.startingKnowledge} ${entrypoint.openingSituation}`,
    ]),
    backgroundReminder: background.promise,
    locationTitle: entrypoint.title,
    openingHook: `${background.openingHook} Теперь этот след начинается здесь.`,
  });
}
