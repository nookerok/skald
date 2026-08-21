import type { ReadonlyWorld } from "../projection.js";
import type { CharacterView } from "./types.js";
import { getCharacterBackground } from "../setup/character-presets.js";
import { conditionLabel, consequenceLabel, relationKindLabel, relationTargetLabel } from "./player-facing.js";

interface CharacterProfileRecord {
  display_name: string;
  wound: string;
  promise: string;
  principle: string;
  background_id?: string | null;
}

export function buildCharacterView(profile: CharacterProfileRecord | null, world: ReadonlyWorld): CharacterView {
  const background = profile?.background_id ? getCharacterBackground(profile.background_id) : null;
  const displayName = profile?.display_name ?? "Неизвестный странник";
  const wound = profile?.wound ?? "Прошлое скрыто туманом.";
  const promise = profile?.promise ?? "Найти своё место в этом мире.";
  const principle = profile?.principle ?? "Не проходить мимо чужой беды.";

  const consequences = [...world.consequences.values()].map((c) => ({
    label: consequenceLabel(c.type),
  }));

  const relations = [...world.relations.values()].filter((r) => r.from === "player").map((r) => ({
    targetLabel: world.entities.get(r.to)?.name ?? relationTargetLabel(r.to),
    relationLabel: relationKindLabel(r.kind),
    value: r.value,
  }));

  const items = world.actionCapabilities
    ? [...world.actionCapabilities.owners.entries()]
      .filter(([itemId, ownerId]) => {
        if (ownerId !== "player") return false;
        const placement = world.actionCapabilities?.placements.get(itemId);
        return placement?.kind === "carried" && placement.holderId === "player";
      })
      .map(([itemId]) => ({ label: world.objects.get(itemId)?.name ?? world.entities.get(itemId)?.name ?? "Предмет при тебе" }))
    : [];

  const conditions = world.actionCapabilities
    ? [...world.actionCapabilities.conditions.values()]
      .filter((condition) => condition.subjectId === "player")
      .map((condition) => ({ label: conditionLabel(condition.kind) }))
    : [];

  return {
    displayName,
    backgroundTitle: background?.title ?? null,
    backgroundSummary: background?.shortDescription ?? null,
    origin: background ? `${background.formerRole} ${background.reasonInRegion}` : null,
    loss: background?.rupture ?? wound,
    wound,
    promise,
    obligation: background?.obligation ?? null,
    principle,
    items,
    conditions,
    consequences,
    relations,
  };
}
