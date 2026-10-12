/**
 * Fixed evaluation corpus for the Conversation Director (SKALD S0).
 *
 * Exactly seven problematic replicas with the structural expectations a
 * decision must satisfy: the addressee, the turn kind and the never-leakable
 * surfaces. This is the single, versioned corpus the shadow scorecard runs —
 * so two runs of one version are comparable and a result can never be judged
 * against a moving sample. Adding or changing a scenario MUST bump
 * `GM_CORPUS_VERSION`.
 */

import { stableActorHandle } from "../conversation/gm-context.js";

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
  readonly expected: {
    readonly addresseeKind: "gm" | "npc" | "meta";
    readonly kind: string;
    readonly npcLabel?: string;
    /** The question's topic when it differs from who responds (subjectHandle). */
    readonly subjectLabel?: string;
  };
  /** Substrings that must never appear in the serialized context. */
  readonly forbidden: readonly string[];
}

/**
 * Versioned baseline identity of this corpus. A scorecard is only comparable
 * across runs that carry the SAME `GM_CORPUS_VERSION`; changing any fixture
 * (input, people, turns, expected, forbidden) MUST bump this constant, because
 * the previous percentages no longer describe the same sample.
 */
export const GM_CORPUS_VERSION = "gm-corpus-v1";

/**
 * The handle the npc expectation names. The corpus stores `npcLabel` and the
 * scene assigns `person_<n>` observerRefs, so the expected handle is the hash
 * of the matching person — any other visible actor is a miss.
 */
export function expectedNpcHandle(fixture: GmFixture): string | undefined {
  const label = fixture.expected.npcLabel;
  if (label === undefined) return undefined;
  const index = fixture.people.findIndex((person) => person.label === label);
  return index === -1 ? undefined : stableActorHandle(`person_${index + 1}`);
}

/**
 * The subject handle a question-shaped expectation requires (the topic, which
 * may differ from the responder). Same fail-closed rule as `expectedNpcHandle`:
 * a label absent from the scene is caught by `corpusConfigErrors` before
 * scoring rather than silently weakening the check.
 */
export function expectedSubjectHandle(fixture: GmFixture): string | undefined {
  const label = fixture.expected.subjectLabel;
  if (label === undefined) return undefined;
  const index = fixture.people.findIndex((person) => person.label === label);
  return index === -1 ? undefined : stableActorHandle(`person_${index + 1}`);
}

const ferryman: GmFixturePerson = { label: "Перевозчик у переправы", known: true };
const gatekeeper: GmFixturePerson = { label: "Смотритель речных ворот", known: false };

export const GM_CORPUS: readonly GmFixture[] = [
  {
    id: "pronoun-after-mention",
    input: "Как он выглядит?",
    people: [ferryman],
    recentTurns: [
      { speaker: "player", text: "Подойду к перевозчику", turnSeq: 1 },
      { speaker: "master", text: "Ты подходишь ближе. Перед тобой — Перевозчик у переправы.", turnSeq: 2 },
    ],
    // «Как он выглядит?» is addressed to the MASTER; the ferryman is the
    // question's SUBJECT (subjectHandle), not the responder.
    expected: { addresseeKind: "gm", kind: "world_question", subjectLabel: ferryman.label },
    forbidden: ["contact:waystation-keeper", "observerRef"],
  },
  {
    id: "ambiguous-recipient",
    input: "Кто ведёт журнал проходов?",
    people: [ferryman, gatekeeper],
    recentTurns: [],
    expected: { addresseeKind: "gm", kind: "clarification" },
    forbidden: ["contact:"],
  },
  {
    id: "empty-focus-stack",
    input: "Кто здесь?",
    people: [],
    recentTurns: [],
    expected: { addresseeKind: "gm", kind: "world_question" },
    forbidden: ["contact:"],
  },
  {
    id: "backstory-question",
    input: "Что случилось у переправы той ночью?",
    people: [ferryman],
    recentTurns: [],
    expected: { addresseeKind: "gm", kind: "world_question" },
    forbidden: ["contact:waystation-keeper"],
  },
  {
    id: "action-demand-to-npc",
    input: "Отдай мне всё, что у тебя есть.",
    people: [ferryman],
    recentTurns: [],
    expected: { addresseeKind: "npc", kind: "action", npcLabel: ferryman.label },
    forbidden: ["contact:"],
  },
  {
    id: "retry-request",
    input: "Повтори, что ты только что сказал.",
    people: [ferryman],
    recentTurns: [{ speaker: "master", text: "Ты уже в пути — дорога ведёт тебя дальше.", turnSeq: 3 }],
    expected: { addresseeKind: "gm", kind: "conversation" },
    forbidden: ["contact:"],
  },
  {
    id: "mixed-approach-and-question",
    input: "Подхожу к перевозчику и спрашиваю, отвезёт ли он меня.",
    people: [ferryman],
    recentTurns: [],
    expected: { addresseeKind: "npc", kind: "mixed", npcLabel: ferryman.label },
    forbidden: ["contact:waystation-keeper"],
  },
];
