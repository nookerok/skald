/**
 * Seven problematic-replica fixtures for the Conversation Director (S0/P1).
 *
 * Each fixture pins what the interpreter must get RIGHT structurally — the
 * addressee, the turn kind and the never-leakable surfaces — so a regression in
 * interpretation is a failing assertion, not an opinion about prose quality.
 */

export interface GmFixturePerson {
  readonly label: string;
  readonly known: boolean;
}

export interface GmFixtureTurn {
  readonly speaker: "player" | "master";
  readonly text: string;
  readonly turnSeq: number;
}

export interface GmFixture {
  readonly id: string;
  readonly input: string;
  readonly people: readonly GmFixturePerson[];
  readonly recentTurns: readonly GmFixtureTurn[];
  readonly expected: { readonly addresseeKind: "gm" | "npc" | "meta"; readonly kind: string; readonly npcLabel?: string };
  /** Substrings that must never appear in the serialized context. */
  readonly forbidden: readonly string[];
}

const ferryman: GmFixturePerson = { label: "Перевозчик у переправы", known: true };
const gatekeeper: GmFixturePerson = { label: "Смотритель речных ворот", known: false };

export const GM_FIXTURES: readonly GmFixture[] = [
  // 1. Pronoun reference after a confirmed mention.
  {
    id: "pronoun-after-mention",
    input: "Как он выглядит?",
    people: [ferryman],
    recentTurns: [
      { speaker: "player", text: "Подойду к перевозчику", turnSeq: 1 },
      { speaker: "master", text: "Ты подходишь ближе. Перед тобой — Перевозчик у переправы.", turnSeq: 2 },
    ],
    expected: { addresseeKind: "npc", kind: "world_question", npcLabel: ferryman.label },
    forbidden: ["contact:waystation-keeper", "observerRef"],
  },
  // 2. Several NPCs → the interpreter must clarify instead of guessing.
  {
    id: "ambiguous-recipient",
    input: "Кто ведёт журнал проходов?",
    people: [ferryman, gatekeeper],
    recentTurns: [],
    expected: { addresseeKind: "gm", kind: "clarification" },
    forbidden: ["contact:"],
  },
  // 3. Empty focus-stack: nobody is around the player.
  {
    id: "empty-focus-stack",
    input: "Кто здесь?",
    people: [],
    recentTurns: [],
    expected: { addresseeKind: "gm", kind: "world_question" },
    forbidden: ["contact:"],
  },
  // 4. Backstory question addressed to the master.
  {
    id: "backstory-question",
    input: "Что случилось у переправы той ночью?",
    people: [ferryman],
    recentTurns: [],
    expected: { addresseeKind: "gm", kind: "world_question" },
    forbidden: ["contact:waystation-keeper"],
  },
  // 5. A demand directed at a present NPC (the action itself is executed later).
  {
    id: "action-demand-to-npc",
    input: "Отдай мне всё, что у тебя есть.",
    people: [ferryman],
    recentTurns: [],
    expected: { addresseeKind: "npc", kind: "action", npcLabel: ferryman.label },
    forbidden: ["contact:"],
  },
  // 6. A meta retry request must not become a world action.
  {
    id: "retry-request",
    input: "Повтори, что ты только что сказал.",
    people: [ferryman],
    recentTurns: [
      { speaker: "master", text: "Ты уже в пути — дорога ведёт тебя дальше.", turnSeq: 3 },
    ],
    expected: { addresseeKind: "gm", kind: "conversation" },
    forbidden: ["contact:"],
  },
  // 7. Mixed replica: approach + question about the crossing.
  {
    id: "mixed-approach-and-question",
    input: "Подхожу к перевозчику и спрашиваю, отвезёт ли он меня.",
    people: [ferryman],
    recentTurns: [],
    expected: { addresseeKind: "npc", kind: "mixed", npcLabel: ferryman.label },
    forbidden: ["contact:waystation-keeper"],
  },
];
