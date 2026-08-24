import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { DiscoveryJournal, DiscoveryCard } from "../discovery/types.js";
import { buildDiscoveryJournal, deepFreeze } from "../discovery/builder.js";
import type { GuidancePhase, GuidanceIntentExample, GuidanceNavigation, PlayerGuidance } from "./types.js";
import { buildObserverGuidanceContext, type ObserverGuidanceContext } from "./observer-context.js";
import type { NarrativeAdapterContext } from "../setup/background-context.js";

const EMPTY_GUIDANCE_TEXT = "Опиши, что хочешь осмотреть, узнать или изменить.";

function monotonicCheck(events: readonly DomainEvent[]): void {
  let lastTs = 0;
  for (const e of events) {
    if (e.timestamp < lastTs) {
      throw new Error(`Non-monotonic timestamp in Event Log: ${e.timestamp} < ${lastTs}`);
    }
    lastTs = e.timestamp;
  }
}

function findRiskCard(discovery: DiscoveryJournal): DiscoveryCard | undefined {
  return discovery.cards.find((c) => c.discoveryId === "risk_draws_attention");
}

function hasActiveConsequence(world: ReadonlyWorld, type: string): boolean {
  for (const c of world.consequences.values()) {
    if (c.type === type) return true;
  }
  return false;
}

function getPhase(events: readonly DomainEvent[], world: ReadonlyWorld, discovery: DiscoveryJournal): GuidancePhase {
  const riskCard = findRiskCard(discovery);
  const actionTimes = new Set<number>();
  for (const e of events) {
    if (e.type === "MoveRequested" || e.type === "GiveRequested" || e.type === "TickPassed") actionTimes.add(e.timestamp);
  }
  const actionCount = actionTimes.size;
  let discoveredAt = 0;
  if (riskCard && riskCard.stage === "discovered") {
    const echoEv = riskCard.evidence.find((e) => e.kind === "echo");
    if (echoEv) discoveredAt = echoEv.worldTime;
  }
  if (world.time === 0) return "first_action";
  const followsDiscovery = riskCard && riskCard.stage !== null;
  if (actionCount >= 6 && !followsDiscovery) return "free_play";
  if (discoveredAt > 0 && world.time <= discoveredAt + 2) return "review_discovery";
  if (riskCard && riskCard.stage === "discovered") return "free_play";
  if (riskCard && riskCard.stage === "hypothesis" && hasActiveConsequence(world, "audacity")) return "observe_consequence";
  if (riskCard && riskCard.stage === "hypothesis") return "strengthen_hypothesis";
  if (riskCard && riskCard.stage === "trace") return "test_trace";
  if (world.time >= 1 && world.time < 6 && !riskCard) return "explore_world";
  return "free_play";
}

interface Candidate {
  readonly priority: number;
  readonly text: string;
  readonly description?: string;
}

function candidate(priority: number, text: string, description?: string): Candidate {
  return { priority, text, ...(description ? { description } : {}) };
}

function situationCandidates(context: ObserverGuidanceContext): Candidate[] {
  const situation = context.activeSituation;
  if (!situation) return [];
  const haystack = `${situation.title} ${situation.description}`.toLocaleLowerCase("ru");
  if (haystack.includes("переправ") || haystack.includes("вод") || haystack.includes("рек")) {
    if (situation.description.includes("закрыта")) {
      return [candidate(0, "Проверить, почему переправа закрыта.", "Осмотреть состояние воды и переправы.")];
    }
    return [candidate(0, "Осмотреть воду и переправу.", "Проверить местное состояние пути.")];
  }
  if (haystack.includes("дым") || haystack.includes("пожар") || haystack.includes("огон")) {
    return [candidate(0, "Осмотреть, откуда идёт дым.", "Проверить наблюдаемую опасность вокруг.")];
  }
  return [candidate(0, `Осмотреть, что происходит: ${situation.title.toLocaleLowerCase("ru")}.`, "Проверить наблюдаемую ситуацию вокруг.")];
}

function hookCandidates(context: ObserverGuidanceContext): Candidate[] {
  if (!context.personalHook) return [];
  return [candidate(1, `Проверить, что означает: ${context.personalHook}`, "Вернуться к причине своего присутствия здесь.")];
}

function objectCandidates(context: ObserverGuidanceContext): Candidate[] {
  const object = context.observedObjects[0];
  return object ? [candidate(2, `Осмотреть ${object.label.toLocaleLowerCase("ru")}.`)] : [];
}

function contactCandidates(context: ObserverGuidanceContext): Candidate[] {
  const contact = context.knownContacts[0];
  return contact ? [candidate(3, `Спросить ${contact.label}, что здесь происходит.`, `Обратиться к знакомому контакту — ${contact.label}.`)] : [];
}

const AFFORDANCE_TEXT: Readonly<Record<string, string>> = {
  illuminate: "осветить место",
  ignite: "зажечь огонь",
  signal: "подать сигнал",
  secure: "закрепить что-нибудь",
  tie: "связать найденное",
  repair: "попробовать починить",
  experiment: "провести осторожный опыт",
  examine: "изучить свойства",
};

function itemCandidates(context: ObserverGuidanceContext): Candidate[] {
  const item = context.accessibleItems[0];
  if (!item) return [];
  const affordance = item.affordances.find((value) => AFFORDANCE_TEXT[value]);
  if (!affordance) return [];
  return [candidate(4, `Проверить, как можно использовать ${item.label.toLocaleLowerCase("ru")}.`, `Можно ${AFFORDANCE_TEXT[affordance]}.` )];
}

function routeCandidates(context: ObserverGuidanceContext): Candidate[] {
  const route = context.knownRoutes[0];
  if (!route) return [];
  if (route.status === "closed") return [candidate(5, `Узнать, как безопасно пройти через путь к «${route.label}».`, "Путь закрыт; сначала стоит разобраться в причине.")];
  return [candidate(5, `Узнать больше о пути к «${route.label}».`, route.status === "difficult" ? "Путь наблюдаем, но сейчас труден." : "Путь уже наблюдаем в мире.")];
}

function buildIntentExamples(context: ObserverGuidanceContext): readonly GuidanceIntentExample[] {
  const candidates = [
    ...situationCandidates(context),
    ...hookCandidates(context),
    ...objectCandidates(context),
    ...contactCandidates(context),
    ...itemCandidates(context),
    ...routeCandidates(context),
  ];
  const seen = new Set<string>();
  const selected: GuidanceIntentExample[] = [];
  for (const item of candidates.sort((a, b) => a.priority - b.priority || a.text.localeCompare(b.text, "ru"))) {
    const normalized = item.text.trim().toLocaleLowerCase("ru");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push({ id: `intent:${selected.length}`, text: item.text, ...(item.description ? { description: item.description } : {}) });
    if (selected.length >= 3) break;
  }
  return deepFreeze(selected);
}

function buildNavigation(examples: readonly GuidanceIntentExample[]): readonly GuidanceNavigation[] {
  if (examples.length === 0) return deepFreeze([]);
  return deepFreeze([
    { id: "navigation:journal", label: "Открыть журнал", view: "journal" as const },
    { id: "navigation:discoveries", label: "Открыть открытия", view: "discoveries" as const },
  ]);
}

function phaseCopy(phase: GuidancePhase): { title: string; text: string; mode: "onboarding" | "free_play" } {
  switch (phase) {
    case "first_action": return { title: "Первое действие", text: "Мир отвечает на поступки. Опиши первое намерение своими словами.", mode: "onboarding" };
    case "explore_world": return { title: "Исследуй мир", text: "Попробуй разные намерения. Мир запоминает не команды, а их последствия.", mode: "onboarding" };
    case "test_trace": return { title: "Проверь след", text: "Ты заметил след. Сравни его с тем, что можно наблюдать сейчас.", mode: "onboarding" };
    case "strengthen_hypothesis": return { title: "Укрепи гипотезу", text: "Закономерность начинает проявляться, но одного совпадения недостаточно.", mode: "onboarding" };
    case "observe_consequence": return { title: "Наблюдай за последствием", text: "Последствие уже возникло. Опиши, что хочешь проверить дальше.", mode: "onboarding" };
    case "review_discovery": return { title: "Открытие", text: "Наблюдения сложились в открытие. Сравни свидетельства и новый ход.", mode: "onboarding" };
    case "free_play": return { title: "Куда дальше?", text: "Опиши, что хочешь попробовать в мире.", mode: "free_play" };
  }
}

export function buildPlayerGuidance(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  narrativeContext?: NarrativeAdapterContext | null,
): PlayerGuidance {
  monotonicCheck(events);
  const discovery = buildDiscoveryJournal(events);
  const phase = getPhase(events, world, discovery);
  const riskCard = findRiskCard(discovery);
  const context = buildObserverGuidanceContext(events, world, narrativeContext);
  const intentExamples = buildIntentExamples(context);
  const copy = phaseCopy(phase);
  const text = intentExamples.length > 0 ? copy.text : EMPTY_GUIDANCE_TEXT;
  return deepFreeze({
    schemaVersion: 2 as const,
    mode: copy.mode,
    phase,
    title: copy.title,
    text,
    intentExamples,
    navigation: buildNavigation(intentExamples),
    relatedDiscoveryId: riskCard?.discoveryId ?? null,
    worldTime: world.time,
  });
}
