import type { InquiryQueryId, InquiryRequest } from "@skald/intent-parser";
import { sameRussianStem } from "@skald/intent-parser";
import type { GameShellSnapshot } from "../game-shell/types.js";
import type { BackgroundNarrativeContext } from "../setup/background-context.js";
import type { InquiryAnswerDTO, InquiryReadContext, InquiryQueryHandler } from "./types.js";

function revision(shell: GameShellSnapshot): InquiryAnswerDTO["revision"] {
  return { ...shell.revision };
}

function answer(queryId: InquiryQueryId, text: string, shell: GameShellSnapshot): InquiryAnswerDTO {
  return Object.freeze({ queryId, answer: text.trim(), revision: revision(shell) });
}

function locationName(shell: GameShellSnapshot): string {
  return shell.world.locationName?.trim() || "место пока не получило названия в твоих наблюдениях";
}

function visibleRoutes(shell: GameShellSnapshot): readonly { label: string; detail?: string; status?: string }[] {
  if (shell.world.knownRoutes) return shell.world.knownRoutes;
  return (shell.world.connectedLocations ?? []).map((entry) => ({ label: entry.label, ...(entry.detail ? { detail: entry.detail } : {}) }));
}

function buildCurrentLocation(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const routes = visibleRoutes(shell).slice(0, 3);
  const routeText = routes.length > 0
    ? ` Из известных направлений рядом: ${routes.map((route) => `«${route.label}»`).join(", ")}.`
    : " Известного пути рядом пока нет.";
  return answer("current_location", `Ты находишься у «${locationName(shell)}».${routeText}`, shell);
}

function buildVisibleScene(request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  if (request.focus) return buildFocusedScene(request, context);
  const { shell } = context;
  const parts = [shell.world.locationDescription, shell.currentSituation?.description, shell.lastTurn?.primary?.text]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 3);
  return answer("visible_scene", parts.length > 0 ? parts.join(" ") : "В твоих текущих наблюдениях нет ничего, что можно уверенно описать.", shell);
}

/**
 * Pronoun surfaces the builder must not guess at. They arrive resolved
 * (with an observerRef and a label surface) via validated proposals;
 * an unresolved pronoun is honestly unknown. Mirrors the parser-side
 * focus guard; kept local so the builder reads parser types only.
 */
const UNRESOLVED_FOCUS_SURFACES: ReadonlySet<string> = new Set([
  "он", "она", "оно", "они",
  "его", "ее", "их",
  "ему", "ей", "им", "ими",
  "нем", "ней",
  "него", "нее", "них", "ним", "ними", "нему",
  "это", "этот", "эта", "этом", "этим", "этой", "этого", "того",
  "такой", "такая", "такое", "такие",
  "туда", "сюда", "там", "здесь", "тут", "оттуда", "отсюда",
]);

function normalizeFocus(surface: string): string {
  return surface.toLowerCase().replace(/ё/gu, "е").trim();
}

/**
 * Derives a match key from an explicit-noun surface, or null when there is
 * nothing honest to match: pronouns, too-short or letterless surfaces.
 * One trailing declension vowel is stripped so "оградой" meets "ограда".
 */
function focusMatchKey(surface: string): string | null {
  const normalized = normalizeFocus(surface);
  if (UNRESOLVED_FOCUS_SURFACES.has(normalized)) return null;
  if (!/[а-яa-z]/iu.test(normalized)) return null;
  const stem = normalized.replace(/[аеиоуыэюяьй]$/, "");
  if (stem.length >= 3) return stem;
  return normalized.length >= 4 ? normalized : null;
}

/** Observer-safe texts a focus question may quote: shell prose only, never hidden geometry. */
function focusSearchTexts(shell: GameShellSnapshot): readonly string[] {
  return [
    shell.world.locationDescription,
    shell.currentSituation?.description,
    shell.lastTurn?.primary?.text,
    ...(shell.lastTurn?.notable.slice(0, 2).map((entry) => entry.text) ?? []),
    ...shell.knowledge.entries.slice(0, 5).map((entry) => entry.text),
    ...(shell.world.knownRoutes ?? []).flatMap((route) => [route.label, route.detail].filter((value): value is string => typeof value === "string")),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function focusLabel(surface: string): string {
  const trimmed = surface.trim();
  return trimmed.length <= 120 ? trimmed : trimmed.slice(0, 120);
}

/**
 * Answers a focused scene question from observer-safe shell prose only.
 * Known (quoted) when shell texts mention the focus, honestly unknown
 * otherwise. Creates no Observation and moves no time; the builder stays
 * a pure read of the passed snapshot.
 */
function buildFocusedScene(request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const label = focusLabel(request.focus?.surface ?? "");
  const key = focusMatchKey(label);
  const matched = key === null ? [] : focusSearchTexts(shell)
    .filter((text) => normalizeFocus(text).includes(key))
    .slice(0, 2);
  if (matched.length > 0) {
    const known = `Про «${label}» в твоих наблюдениях есть: ${matched.join(" ")}`;
    const closer = request.relation === "behind" || request.relation === "beyond"
      ? " Что находится дальше — в твоих наблюдениях пока нет."
      : "";
    return answer("visible_scene", `${known}${closer}`, shell);
  }
  const unknown = (() => {
    switch (request.relation) {
      case "behind": return `Что за «${label}» — из твоих наблюдений пока не различить. Подойди ближе или осмотри окрестности действием.`;
      case "beyond": return `Что за «${label}» вдали — пока не различить.`;
      case "near": return `Что рядом с «${label}» — в твоих наблюдениях пока ничего различимого нет. Осмотрись действием.`;
      case "inside": return `Что внутри «${label}» — из текущих наблюдений не различить.`;
      default: return `Про «${label}» в твоих наблюдениях пока ничего нет.`;
    }
  })();
  return answer("visible_scene", unknown, shell);
}

function buildAuditoryScene(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const signal = shell.lastTurn?.notable?.find((entry) => /звук|шум|гул|крик|шелест|треск/iu.test(entry.text));
  return answer("auditory_scene", signal?.text ?? "Отдельного звукового сигнала в твоих текущих наблюдениях нет. Прислушайся, если хочешь проверить это действием.", shell);
}

function buildCharacterIdentity(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell, background } = context;
  const parts = [`Ты — ${shell.character.displayName}.`];
  if (background?.title) parts.push(`Твоя предыстория: ${background.title}.`);
  if (shell.character.wound) parts.push(`С тобой осталось: ${shell.character.wound}`);
  if (shell.character.promise) parts.push(`Твоё обязательство: ${shell.character.promise}`);
  return answer("character_identity", parts.join(" "), shell);
}

function buildKnownPlaceKnowledge(request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const known = shell.knowledge.entries.map((entry) => entry.text).filter(Boolean);
  const focus = request.focus?.surface?.trim() ?? "";
  if (focus.length > 0) {
    // "Что я знаю о X?": answer from entries mentioning the named
    // subject, never from an unrelated dump. An empty match is an
    // honest unknown — not a hijack into another question.
    const focusWords = normalizeFocus(focus).split(/[^a-zа-я0-9]+/iu).filter((word) => word.length >= 4);
    const matched = known.filter((line) => {
      const lineWords = normalizeFocus(line).split(/[^a-zа-я0-9]+/iu).filter((word) => word.length > 0);
      return focusWords.some((focusWord) => lineWords.some((lineWord) => lineWord === focusWord || sameRussianStem(lineWord, focusWord)));
    });
    if (matched.length > 0) return answer("known_place_knowledge", matched.slice(0, 5).join(" "), shell);
    return answer("known_place_knowledge", `В твоих записях о «${focus}» пока ничего нет. Продолжай наблюдать и расспрашивать.`, shell);
  }
  return answer("known_place_knowledge", known.length > 0 ? known.slice(0, 5).join(" ") : `Ты знаешь только то, что видишь у «${locationName(shell)}» прямо сейчас.`, shell);
}

function buildAvailableRoutes(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const routes = visibleRoutes(shell).slice(0, 5);
  if (!routes.length) return answer("available_routes", "Известного маршрута отсюда пока нет. Сначала осмотрись или спроси о дороге у того, кто её знает.", shell);
  const text = routes.map((route) => {
    const status = route.status === "blocked" ? "перекрыт" : route.status === "difficult" ? "труден" : "доступен";
    return `«${route.label}» — ${status}${route.detail ? `: ${route.detail}` : ""}`;
  }).join(" ");
  return answer("available_routes", `Из твоих наблюдений доступны такие направления: ${text}`, shell);
}

function buildRecentEvents(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const entries = [shell.lastTurn?.primary?.text, ...shell.recentActivity.slice(0, 3).map((item) => item.text)]
    .filter((value): value is string => Boolean(value && value.trim()));
  return answer("recent_events", entries.length > 0 ? entries.slice(0, 4).join(" ") : "В доступной тебе хронике пока нет недавних событий.", shell);
}

function buildInventory(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell, background } = context;
  const items = background?.accessibleItems.filter(Boolean) ?? [];
  return answer("inventory", items.length > 0 ? `При тебе: ${items.join(", ")}.` : "В доступном тебе снаряжении сейчас нет предметов, которые можно уверенно назвать.", shell);
}

function buildKnownContacts(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const contacts = shell.character.relations.map((relation) => `${relation.targetLabel} (${relation.relationLabel.toLowerCase()})`);
  return answer("known_contacts", contacts.length > 0 ? `Тебе известны: ${contacts.join(", ")}.` : "В доступных воспоминаниях нет подтверждённого знакомого рядом.", shell);
}

function buildMapPosition(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  return answer("map_position", `Маркер на карте показывает последнюю подтверждённую тобой позицию — «${locationName(shell)}». Неизвестные участки остаются скрыты туманом, пока у тебя нет наблюдения о них.`, shell);
}

/** Ordinals for same-named distinct people (at most five names render). */
const PERSON_ORDINALS: readonly string[] = ["первый", "второй", "третий", "четвёртый", "пятый"];

function normalizePersonLabel(label: string): string {
  return label.trim().toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ");
}

/**
 * Answers "who is nearby" from observer-safe scene people only: labels the
 * player already knows, never hidden entities. Falls back to background
 * relations only when no scene was passed (never invents presence).
 * One character arriving through several read-side sources renders once:
 * exact observerRef duplicates collapse, then normalized labels. Distinct
 * entities sharing one name are never silently merged — each keeps a
 * player-safe ordinal distinguisher.
 */
function buildWhoIsNearby(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const seenRefs = new Set<string>();
  const groups = new Map<string, { label: string; count: number }>();
  const order: string[] = [];
  for (const person of context.scene?.knownPeople ?? []) {
    if (seenRefs.has(person.observerRef)) continue;
    seenRefs.add(person.observerRef);
    const label = person.label.trim();
    if (label.length === 0) continue;
    const key = normalizePersonLabel(label);
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      groups.set(key, { label, count: 1 });
      order.push(key);
    }
  }
  if (order.length === 0) {
    return answer("who_is_nearby", "Рядом с тобой сейчас никого различимого нет. Осмотрись действием — может, кто-то покажется.", shell);
  }
  const parts: string[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    if (group.count === 1) {
      if (parts.length < 5) parts.push(`«${group.label}»`);
    } else {
      for (let index = 0; index < group.count && parts.length < 5; index += 1) {
        parts.push(`«${group.label}» (${PERSON_ORDINALS[index] ?? "ещё один"})`);
      }
    }
    if (parts.length >= 5) break;
  }
  return answer("who_is_nearby", `Рядом с тобой: ${parts.join(", ")}.`, shell);
}

/** Default water/river keywords when the question names no focus. */
const INDICATION_KEYWORDS: readonly string[] = [
  "вода", "река", "течение", "волна", "берег", "ручей",
];

function indicationKeywords(surface: string | undefined): readonly string[] {
  if (surface) {
    const words = normalizeFocus(surface).split(/[^a-zа-я0-9]+/iu).filter((word) => word.length >= 3);
    if (words.length > 0) return words;
  }
  return INDICATION_KEYWORDS;
}

function mentionsIndication(text: string, keywords: readonly string[]): boolean {
  const words = normalizeFocus(text).split(/[^a-zа-я0-9]+/iu).filter((word) => word.length > 0);
  return keywords.some((keyword) => words.some((word) => word === keyword || sameRussianStem(word, keyword)));
}

/**
 * Answers what the environment signals (plan_9 §1 "что подсказывает вода?").
 * Route conditions first — a difficult crossing IS the water speaking —
 * then location-description and recent notable sentences mentioning the
 * focus (default: water words). Shell prose only, never hidden hydrology
 * numbers; creates no Observation and moves no time.
 */
function buildEnvironmentalIndication(request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const keywords = indicationKeywords(request.focus?.surface);
  const lines: string[] = [];
  for (const route of visibleRoutes(shell)) {
    if (route.status !== "difficult" && route.status !== "blocked") continue;
    const state = route.status === "blocked" ? "перекрыт" : "труден";
    lines.push(`«${route.label}» — ${state}${route.detail ? `: ${route.detail}` : ""}.`);
  }
  for (const sentence of (shell.world.locationDescription ?? "").split(/(?<=[.?!])\s+/u)) {
    const trimmed = sentence.trim();
    if (trimmed.length > 0 && mentionsIndication(trimmed, keywords)) lines.push(trimmed);
  }
  for (const entry of shell.lastTurn?.notable.slice(0, 2).map((item) => item.text) ?? []) {
    const trimmed = entry.trim();
    if (trimmed.length > 0 && mentionsIndication(trimmed, keywords)) lines.push(trimmed);
  }
  const unique = [...new Set(lines)].slice(0, 4);
  if (unique.length === 0) {
    return request.focus
      ? answer("environmental_indication", `Про «${focusLabel(request.focus.surface)}» округа сейчас ничего особенного не говорит. Прислушайся или осмотрись действием — и спроси снова.`, shell)
      : answer("environmental_indication", "Вода и округа сейчас ничего особенного не подсказывают. Прислушайся или осмотрись действием — и спроси снова.", shell);
  }
  return answer("environmental_indication", `Что подсказывает округа: ${unique.join(" ")}`, shell);
}

export const INQUIRY_QUERY_HANDLERS: Readonly<Record<InquiryQueryId, InquiryQueryHandler>> = Object.freeze({
  current_location: buildCurrentLocation,
  visible_scene: buildVisibleScene,
  auditory_scene: buildAuditoryScene,
  character_identity: buildCharacterIdentity,
  known_place_knowledge: buildKnownPlaceKnowledge,
  available_routes: buildAvailableRoutes,
  recent_events: buildRecentEvents,
  inventory: buildInventory,
  known_contacts: buildKnownContacts,
  map_position: buildMapPosition,
  who_is_nearby: buildWhoIsNearby,
  environmental_indication: buildEnvironmentalIndication,
});

/** Resolves a registered query against the already-built observer read model. */
export function buildInquiryAnswer(request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  return INQUIRY_QUERY_HANDLERS[request.queryId](request, context);
}

export type { BackgroundNarrativeContext };
