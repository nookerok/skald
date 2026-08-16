export type WorldId = string;
export type CharacterProfileId = string;
export type WorldTemplateId = string;

export interface WorldTemplate {
  id: WorldTemplateId;
  title: string;
  description: string;
}

export interface CharacterProfile {
  id: CharacterProfileId;
  displayName: string;
  wound: string;
  promise: string;
  principle: string;
  /** Selected origin package; null for legacy profiles. */
  backgroundId: string | null;
  profileVersion: number;
  createdAt: number;
}

export interface WorldRecord {
  worldId: WorldId;
  saveLabel: string;
  templateId: WorldTemplateId;
  /** Authored onboarding start; null for legacy stories. */
  entrypointId: string | null;
  characterId: CharacterProfileId | null;
  characterName: string | null;
  status: "active" | "archived" | "corrupt";
  createdAt: number;
  lastPlayedAt: number | null;
  worldTime: number;
  isPrimary: boolean;
  successorWorldId: string | null;
}

export const LEGACY_WORLD_ID = "legacy-world";

export const DEFAULT_TEMPLATE: WorldTemplate = {
  id: "legacy",
  title: "Первый мир",
  description: "Мир, который помнит.",
};
