import type { ReadonlyWorld } from "../projection.js";
import type { CharacterView } from "./types.js";

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
    label: `Последствие: ${c.type}`,
    source: c.id,
  }));

  const relations = [...world.relations.values()].filter((r) => r.from === "player").map((r) => ({
    target: r.to,
    kind: r.kind,
    value: r.value,
  }));

  return { displayName, wound, promise, principle, consequences, relations };
}
