import type { WorldTemplate } from "./types.js";

const _templates: Record<string, WorldTemplate> = {
  old_tower: {
    id: "old_tower",
    title: "Старая башня",
    description: "Одинокая башня на границе леса. Внутри — следы древнего огня и молчание камней.",
    startingQuestion: "Что скрывает башня, которую никто не решается открыть?",
    templateVersion: 1,
    available: true,
  },
  crossroads: {
    id: "crossroads",
    title: "Перекрёсток",
    description: "Четыре дороги, четыре ветра, и ни одной тени, чтобы спрятаться от собственных решений.",
    startingQuestion: "Куда ведёт дорога, которую ты выберешь?",
    templateVersion: 1,
    available: true,
  },
  living_region: {
    id: "living_region",
    title: "Бассейн Речного Стража",
    description: "Живой регион у переправы на границе Чёрного леса и открытой долины.",
    startingQuestion: "Что изменится вокруг переправы, пока ты пытаешься понять этот край?",
    templateVersion: 1,
    available: true,
  },
};

for (const key of Object.keys(_templates)) {
  Object.freeze(_templates[key]!);
}
Object.freeze(_templates);

export const WORLD_TEMPLATES: Readonly<Record<string, Readonly<WorldTemplate>>> = _templates;

export function getWorldTemplate(id: string): WorldTemplate | null {
  return _templates[id] ?? null;
}

export function listWorldTemplates(): WorldTemplate[] {
  return Object.values(_templates);
}
