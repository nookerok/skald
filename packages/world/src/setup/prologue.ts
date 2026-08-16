import type { CharacterBackground, PrologueDTO, RegionEntrypoint } from "./types.js";

/** Pure, non-authoritative onboarding prose assembled from accepted content. */
export function buildPrologue(input: {
  readonly characterName: string;
  readonly background: CharacterBackground;
  readonly entrypoint: RegionEntrypoint;
}): PrologueDTO {
  const name = input.characterName.trim();
  const background = input.background;
  const entrypoint = input.entrypoint;
  return Object.freeze({
    title: `История ${name}`,
    paragraphs: Object.freeze([
      `${name} — ${background.history} ${background.formerRole} ${background.rupture}`,
      `${entrypoint.title}. ${entrypoint.description} ${entrypoint.atmosphere}`,
      `${background.reasonInRegion} ${background.knownConnection} ${entrypoint.openingSituation}`,
    ]),
    backgroundReminder: background.obligation,
    locationTitle: entrypoint.title,
    openingHook: `${background.openingHook} ${background.obligation} Теперь этот след начинается здесь.`,
  });
}
