import type { ReadonlyWorld } from "../projection.js";
import type { SituationView } from "./types.js";

const SITUATION_TEMPLATES: Record<string, { title: string; description: string; effects: { label: string; tone: "neutral" | "warning" | "danger" }[] }> = {
  forest_fire: {
    title: "Лесной пожар",
    description: "Огонь распространяется по лесу. Дым поднимается над кронами, воздух становится горячим и сухим.",
    effects: [
      { label: "Деревья гибнут", tone: "danger" },
      { label: "Жар распространяется", tone: "warning" },
      { label: "Животные бегут", tone: "neutral" },
    ],
  },
  crossing_watch: {
    title: "Переправа перекрыта водой",
    description: "Вода поднялась и скрыла верхний ряд камней; переправа стала трудной. Перевозчик держится у плоскодонки и не спешит говорить о ночном течении.",
    effects: [
      { label: "Вода продолжает подниматься", tone: "warning" },
      { label: "Прямой путь трудный", tone: "danger" },
      { label: "Перевозчик что-то скрывает", tone: "neutral" },
    ],
  },
};

export function buildSituationView(world: ReadonlyWorld): SituationView | null {
  if (world.activeSituations.size === 0) return null;

  for (const [id, s] of world.activeSituations) {
    const template = SITUATION_TEMPLATES[s.type];
    // Unknown types are still valid simulation state, but their internal key
    // is not suitable for a normal player's UI or inquiry answer.
    const title = template?.title ?? "Неясная перемена";
    const description = template?.description ?? "Вокруг заметна перемена, но её причина пока неясна.";
    const effects = template?.effects ?? [];
    const remaining = (s.startedAt + s.duration) - world.time;

    return {
      situationId: id,
      title,
      description,
      effects,
      startedAt: s.startedAt,
      remainingTicks: remaining > 0 ? remaining : null,
    };
  }

  return null;
}
