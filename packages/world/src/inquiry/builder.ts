import type { InquiryQueryId, InquiryRequest } from "@skald/intent-parser";
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

function buildKnownPlaceKnowledge(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const known = shell.knowledge.entries.map((entry) => entry.text).filter(Boolean).slice(0, 5);
  return answer("known_place_knowledge", known.length > 0 ? known.join(" ") : `Ты знаешь только то, что видишь у «${locationName(shell)}» прямо сейчас.`, shell);
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

/**
 * Answers "who is nearby" from observer-safe scene people only: labels the
 * player already knows, never hidden entities. Falls back to background
 * relations only when no scene was passed (never invents presence).
 */
function buildWhoIsNearby(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const people = [...(context.scene?.knownPeople ?? [])]
    .map((person) => person.label.trim())
    .filter((label) => label.length > 0);
  if (people.length === 0) {
    return answer("who_is_nearby", "Рядом с тобой сейчас никого различимого нет. Осмотрись действием — может, кто-то покажется.", shell);
  }
  const list = people.slice(0, 5).map((label) => `«${label}»`).join(", ");
  return answer("who_is_nearby", `Рядом с тобой: ${list}.`, shell);
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
});

/** Resolves a registered query against the already-built observer read model. */
export function buildInquiryAnswer(request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  return INQUIRY_QUERY_HANDLERS[request.queryId](request, context);
}

export type { BackgroundNarrativeContext };
