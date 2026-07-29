import type { CharacterView } from "./types.js";

interface CharacterRecord {
  display_name: string;
  wound: string;
  promise: string;
  principle: string;
}

export function buildCharacterView(profile: CharacterRecord | null): CharacterView {
  if (!profile) {
    return {
      displayName: "Неизвестный странник",
      presetTitle: "Наследие",
      wound: "Прошлое скрыто туманом.",
      promise: "Найти своё место в этом мире.",
      principle: "Не проходить мимо чужой беды.",
      consequences: [],
      relations: [],
    };
  }

  return {
    displayName: profile.display_name,
    presetTitle: "Наследие",
    wound: profile.wound,
    promise: profile.promise,
    principle: profile.principle,
    consequences: [],
    relations: [],
  };
}
