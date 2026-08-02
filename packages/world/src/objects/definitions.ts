/**
 * Object definitions for the Old Tower world.
 *
 * Each definition is a template; actual objects are placed via bootstrap events.
 */

import type { WorldObject } from "./types.js";

export interface ObjectDefinition {
  readonly id: string;
  readonly name: string;
  /** Player-facing alternative names (inflected forms like «пепел» for «Кучка пепла»), ADR-0013 §3. */
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly material: WorldObject["material"];
  readonly initialState: Record<string, unknown>;
  readonly locationId: string;
  readonly integrity: number;
  readonly temperature: number;
}

export interface LocationDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly connections: Readonly<Record<string, string>>;
}

export const LEGACY_LOCATIONS: readonly LocationDefinition[] = [
  {
    id: "legacy_overworld",
    name: "Древний лес",
    description: "Пучистый лес с сухими деревьями. Где-то вдалеке слышен треск веток.",
    connections: {},
  },
];

export const LEGACY_OBJECTS: readonly ObjectDefinition[] = [
  {
    id: "old_brazier",
    name: "Старая жаровня",
    aliases: ["жаровня"],
    description: "Железная жаровня с угасающими углями.",
    material: "iron",
    initialState: { hasEmbers: true },
    locationId: "legacy_overworld",
    integrity: 60,
    temperature: 45,
  },
  {
    id: "dry_tree",
    name: "Сухое дерево",
    aliases: ["дерево"],
    description: "Старое сухое дерево, готовое вспыхнуть от любой искры.",
    material: "wood",
    initialState: { flammable: true },
    locationId: "legacy_overworld",
    integrity: 30,
    temperature: 20,
  },
];

export const OLD_TOWER_OBJECTS: readonly ObjectDefinition[] = [
  {
    id: "tower_door",
    name: "Башенная дверь",
    aliases: ["дверь"],
    description: "Тяжёлая дубовая дверь с железными заклёпками. Петли покрыты ржавчиной.",
    material: "wood",
    initialState: { locked: true, hasRust: true },
    locationId: "tower_entrance",
    integrity: 80,
    temperature: 20,
  },
  {
    id: "door_hinges",
    name: "Дверные петли",
    aliases: ["петли", "ржавые петли"],
    description: "Железные петли, скреплённые ржавчиной. Их можно нагреть.",
    material: "iron",
    initialState: { rusted: true, heated: false },
    locationId: "tower_entrance",
    integrity: 60,
    temperature: 20,
  },
  {
    id: "broken_window",
    name: "Разбитое окно",
    aliases: ["окно", "окна"],
    description: "Узкое окно с обломками стекла. Через него можно пролезть, но опасно.",
    material: "glass",
    initialState: { shattered: true, dangerous: true },
    locationId: "tower_entrance",
    integrity: 30,
    temperature: 20,
  },
  {
    id: "extinguished_brazier",
    name: "Потухшая жаровня",
    aliases: ["жаровня"],
    description: "Железная жаровня с остатками угля. Ещё сохраняет слабое тепло.",
    material: "iron",
    initialState: { hasEmbers: true },
    locationId: "tower_approach",
    integrity: 70,
    temperature: 40,
  },
  {
    id: "ash_pile",
    name: "Кучка пепла",
    aliases: ["пепел"],
    description: "Мягкий серый пепел от старого огня. Его можно взять.",
    material: "ash",
    initialState: { collectible: true },
    locationId: "tower_approach",
    integrity: 100,
    temperature: 20,
  },
  {
    id: "stone_wall",
    name: "Каменная стена",
    description: "Грубая кладка из тёмного камня. Хранит температурные следы.",
    material: "stone",
    initialState: {},
    locationId: "tower_interior",
    integrity: 95,
    temperature: 20,
  },
  {
    id: "inner_mechanism",
    name: "Внутренний механизм",
    description: "Железный шестерёнчатый механизм. Скрыт до открытия прохода.",
    material: "iron",
    initialState: { revealed: false, jammed: true },
    locationId: "tower_interior",
    integrity: 50,
    temperature: 20,
  },
];

export const OLD_TOWER_LOCATIONS: readonly LocationDefinition[] = [
  {
    id: "tower_approach",
    name: "Подножие башни",
    description: "Трава и камни у основания башни. Здесь стоит потухшая жаровня и кучка пепла.",
    connections: { enter: "tower_entrance", approach: "tower_entrance" },
  },
  {
    id: "tower_entrance",
    name: "Вход в башню",
    description: "Тяжёлая дверь с ржавыми петлями. Рядом — разбитое окно.",
    connections: { approach: "tower_approach", enter: "tower_interior" },
  },
  {
    id: "tower_interior",
    name: "Внутри башни",
    description: "Темное пространство с каменными стенами. В глубине — механизм.",
    connections: { exit: "tower_entrance", leave: "tower_entrance" },
  },
];
