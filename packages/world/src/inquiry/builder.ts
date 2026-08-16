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

function buildVisibleScene(_request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  const { shell } = context;
  const parts = [shell.world.locationDescription, shell.currentSituation?.description, shell.lastTurn?.primary?.text]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 3);
  return answer("visible_scene", parts.length > 0 ? parts.join(" ") : "В твоих текущих наблюдениях нет ничего, что можно уверенно описать.", shell);
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
  const known = [
    ...shell.knowledge.facts.map((entry) => entry.text),
    ...shell.knowledge.hypotheses.map((entry) => `Гипотеза: ${entry.text}`),
    ...shell.knowledge.traces.map((entry) => `След: ${entry.text}`),
  ].filter(Boolean).slice(0, 5);
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
});

/** Resolves a registered query against the already-built observer read model. */
export function buildInquiryAnswer(request: InquiryRequest, context: InquiryReadContext): InquiryAnswerDTO {
  return INQUIRY_QUERY_HANDLERS[request.queryId](request, context);
}

export type { BackgroundNarrativeContext };
