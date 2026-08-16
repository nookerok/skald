export type { CharacterBackground, CharacterPreset, WorldTemplate, RegionEntrypoint, PrologueDTO } from "./types.js";
export { CHARACTER_BACKGROUNDS, CHARACTER_PRESETS, getCharacterBackground, getCharacterPreset, listCharacterBackgrounds, listCharacterPresets } from "./character-presets.js";
export { WORLD_TEMPLATES, getWorldTemplate, listWorldTemplates } from "./world-templates.js";
export { buildBootstrapEvents } from "./bootstrap-builder.js";
export type { BootstrapSelection } from "./bootstrap-builder.js";
export { listRegionEntrypoints, getRegionEntrypoint, getDefaultRegionEntrypoint } from "./entrypoints.js";
export { buildPrologue } from "./prologue.js";

export { buildBackgroundNarrativeContext } from "./background-context.js";
export type { BackgroundNarrativeContext } from "./background-context.js";
