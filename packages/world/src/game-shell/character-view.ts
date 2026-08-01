import type { ReadonlyWorld } from "../projection.js";
import type { CharacterView } from "./types.js";
import { consequenceLabel, relationKindLabel, relationTargetLabel } from "./player-facing.js";

interface CharacterProfileRecord {
  display_name: string;
  wound: string;
  promise: string;
  principle: string;
}

export function buildCharacterView(profile: CharacterProfileRecord | null, world: ReadonlyWorld): CharacterView {
  const displayName = profile?.display_name ?? "Неизвестный странник";
  const wound = profile?.wound ?? "Прошлое скрыто туманом.";
  const promise = profile?.promise ?? "Найти своё место в этом мире.";
  const principle = profile?.principle ?? "Не проходить мимо чужой беды.";

  const consequences = [...world.consequences.values()].map((c) => ({
    label: consequenceLabel(c.type),
  }));

  const relations = [...world.relations.values()].filter((r) => r.from === "player").map((r) => ({
    targetLabel: relationTargetLabel(r.to),
    relationLabel: relationKindLabel(r.kind),
    value: r.value,
  }));

  return { displayName, wound, promise, principle, consequences, relations };
}
