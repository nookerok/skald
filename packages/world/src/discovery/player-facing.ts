import { sanitizePlayerFacingText } from "../game-shell/player-facing.js";
import { deepFreeze } from "./builder.js";
import type { DiscoveryEvidence, DiscoveryJournal, DiscoverySignalKind, DiscoveryStage, RumorStatus } from "./types.js";

export interface PlayerDiscoveryEvidence {
  readonly kind: DiscoverySignalKind;
  readonly worldTime: number;
  readonly text: string;
}

export interface PlayerDiscoveryCard {
  readonly title: string;
  readonly question: string;
  readonly stage: DiscoveryStage;
  readonly summary: string;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly evidenceCount: number;
  readonly evidence: readonly PlayerDiscoveryEvidence[];
  readonly resolution?: "unresolved" | "supported" | "contradicted" | "inconclusive";
}

export interface PlayerDiscoveryRumor {
  readonly text: string;
  readonly sourceLabel: string;
  readonly status: RumorStatus;
  readonly observedAt: number;
}

export interface PlayerDiscoveryJournal {
  readonly schemaVersion: 1;
  readonly cards: readonly PlayerDiscoveryCard[];
  readonly recentEvidence: readonly PlayerDiscoveryEvidence[];
  readonly rumors: readonly PlayerDiscoveryRumor[];
  readonly worldTime: number;
}

type DiscoveryCopy = {
  readonly evidence: string;
  readonly title?: string;
  readonly question?: string;
  readonly summaries?: Partial<Record<DiscoveryStage, string>>;
};

/** Stable read-side copy for legacy or untranslated discovery propositions. */
const DISCOVERY_COPY: Readonly<Record<string, DiscoveryCopy>> = {
  heat_changes_material: {
    evidence: "Нагрев изменил свойства предмета.",
    title: "Тепло меняет свойства материалов",
    question: "Что происходит с предметами, когда они нагреваются?",
    summaries: {
      trace: "Разные материалы сохраняют тепло по-разному.",
      hypothesis: "Тепло не просто ощущается — оно меняет состояние предметов.",
      discovered: "Нагрев материала способен изменить его свойства и поведение.",
    },
  },
  // Compiled region definitions ship English authoring copy; the Russian
  // player UI renders these stable translations instead of the generic
  // fallback (which made distinct water/road/ruin findings look like
  // identical "observed pattern" duplicates).
  abandoned_infrastructure: {
    evidence: "Тёсаные камни и ровная насыпь выдают старый тракт.",
    title: "Дорога в никуда",
    question: "Какой заброшенный тракт проходил через восточные высоты?",
    summaries: {
      trace: "Старая дорога продолжается за обжитыми тропами.",
      hypothesis: "Дорога может принадлежать постройкам старше города.",
      discovered: "Повторные следы говорят о заброшенном тракте, а не о звериной тропе.",
    },
  },
  ancient_culture_traces: {
    evidence: "Швы кладки и ряды повторяются по всем развалинам.",
    title: "Отголоски старой культуры",
    question: "Развалины построены в одной старой традиции?",
    summaries: {
      trace: "Каменная кладка повторяет виденный раньше узор.",
      hypothesis: "У развалин может быть общая строительная традиция с дальними постройками.",
      discovered: "Независимые наблюдения подтверждают общую старую строительную традицию.",
    },
  },
  climate_shift: {
    evidence: "Почва и растительность меняются за нынешней кромкой леса.",
    title: "Старая граница леса",
    question: "Дотягивался ли лес раньше дальше в долину?",
    summaries: {
      trace: "Растительность меняется вдоль странно ровной границы.",
      hypothesis: "Граница может хранить след смены климата или старого землепользования.",
      discovered: "Независимые следы подтверждают прежнюю границу леса, не называя её причины.",
    },
  },
  conflict_trace: {
    evidence: "Потемневший слой кладки прерывает старую стену.",
    title: "Шрам на камне",
    question: "Восточное место пострадало от столкновения?",
    summaries: {
      trace: "Один слой кладки темнее и повреждён сильнее остальных.",
      hypothesis: "Урон мог последовать за яростным событием, но огонь и погода тоже возможны.",
      discovered: "Повторные свидетельства подтверждают повреждённый слой, оставляя причину нерешённой.",
    },
  },
  river_course_shift: {
    evidence: "Наносы и сухое русло подсказывают: вода шла здесь.",
    title: "Река помнит другое русло",
    question: "Текала ли река когда-то другим руслом?",
    summaries: {
      trace: "У нынешней реки сохранились сухие промоины.",
      hypothesis: "В котловине может сохраняться старое русло.",
      discovered: "Независимые водные следы подтверждают прежнее русло, не называя его причины.",
    },
  },
};

const ENGLISH = /[A-Za-z]{4,}/;
const INTERNAL_TOKEN = /(?:^|\s)[a-z]{2,}[a-z0-9]*[#:_-][a-z0-9_:#-]*(?:$|\s)/i;

function isUnsafe(value: string): boolean {
  return ENGLISH.test(value) || INTERNAL_TOKEN.test(value) || value.includes("_");
}

function safeText(value: unknown, fallback: string, copy?: string): string {
  const normalized = typeof value === "string" ? sanitizePlayerFacingText(value).trim() : "";
  if (!normalized || isUnsafe(normalized)) return copy ?? fallback;
  return normalized;
}

function copyFor(discoveryId: string): DiscoveryCopy | undefined {
  return DISCOVERY_COPY[discoveryId];
}

function safeEvidence(discoveryId: string, evidence: DiscoveryEvidence): PlayerDiscoveryEvidence {
  return deepFreeze({
    kind: evidence.kind,
    worldTime: evidence.worldTime,
    text: safeText(evidence.text, "Ты заметил след, связанный с этим открытием.", copyFor(discoveryId)?.evidence),
  });
}

function safeCard(discoveryId: string, card: DiscoveryJournal["cards"][number]): PlayerDiscoveryCard {
  const copy = copyFor(discoveryId);
  return deepFreeze({
    title: safeText(card.title, "Наблюдаемая закономерность.", copy?.title),
    question: safeText(card.question, "Что происходит в окружающем мире?", copy?.question),
    stage: card.stage,
    summary: safeText(card.summary, "Ты заметил закономерность, которую ещё нужно проверить.", copy?.summaries?.[card.stage]),
    firstSeenAt: card.firstSeenAt,
    lastSeenAt: card.lastSeenAt,
    evidenceCount: card.evidence.length,
    evidence: deepFreeze(card.evidence.map((evidence) => safeEvidence(discoveryId, evidence))),
    ...(card.resolution ? { resolution: card.resolution } : {}),
  });
}

/**
 * Removes backend provenance and localizes legacy discovery text for the
 * normal player UI. This is a pure projection; the internal journal remains
 * available to trusted diagnostics and rules-adjacent read models.
 */
export function toPlayerDiscoveryJournal(journal: DiscoveryJournal): PlayerDiscoveryJournal {
  const cards = journal.cards.map((card) => safeCard(card.discoveryId, card));
  const recentEvidence = cards
    .flatMap((card) => card.evidence)
    .sort((a, b) => b.worldTime - a.worldTime)
    .slice(0, 10);
  const rumors = journal.rumors
    .filter((rumor) => rumor.observerId === "player")
    .map((rumor) => deepFreeze({
      text: safeText(rumor.text, "Тебе передали слух, который ещё нужно проверить."),
      sourceLabel: safeText(rumor.sourceLabel, "Источник рассказа пока неясен."),
      status: rumor.status,
      observedAt: rumor.observedAt,
    }));
  return deepFreeze({
    schemaVersion: 1 as const,
    cards: deepFreeze(cards),
    recentEvidence: deepFreeze(recentEvidence),
    rumors: deepFreeze(rumors),
    worldTime: journal.worldTime,
  });
}
