import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { DiscoveryJournal, DiscoveryCard } from "../discovery/types.js";
import { buildDiscoveryJournal, deepFreeze } from "../discovery/builder.js";
import type { GuidanceActionId, GuidancePhase, GuidanceSuggestion, PlayerGuidance } from "./types.js";
import { GUIDANCE_ACTIONS } from "./actions.js";

function buildSuggestion(
  actionId: GuidanceActionId,
  label: string,
  description: string,
  index: number,
): GuidanceSuggestion {
  const def = GUIDANCE_ACTIONS[actionId];
  return deepFreeze({
    id: `sug:${index}`,
    kind: def.kind,
    actionId,
    label,
    description,
    input: def.input,
    view: def.view,
  });
}

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

function getPhase(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  discovery: DiscoveryJournal,
): GuidancePhase {
  const riskCard = findRiskCard(discovery);

  // Count unique action timestamps — one command produces
  // MoveRequested + MovementBlocked + TickPassed at the same T.
  // We count the timestamp once, not each event type.
  const actionTimes = new Set<number>();
  for (const e of events) {
    if (
      e.type === "MoveRequested" ||
      e.type === "GiveRequested" ||
      e.type === "TickPassed"
    ) {
      actionTimes.add(e.timestamp);
    }
  }
  const actionCount = actionTimes.size;

  // discoveredAt: timestamp of the first echo evidence (ConsequenceFired for this discovery)
  let discoveredAt = 0;
  if (riskCard && riskCard.stage === "discovered") {
    const echoEv = riskCard.evidence.find((e) => e.kind === "echo");
    if (echoEv) discoveredAt = echoEv.worldTime;
  }

  // first_action
  if (world.time === 0) return "first_action";

  // free_play: 6+ actions without following discovery route
  const followsDiscovery = riskCard && riskCard.stage !== null;
  if (actionCount >= 6 && !followsDiscovery) return "free_play";

  // review_discovery: the discovery happened recently (within 2 ticks of discovering)
  if (discoveredAt > 0 && world.time <= discoveredAt + 2) {
    return "review_discovery";
  }

  // free_play: old discovery
  if (riskCard && riskCard.stage === "discovered") return "free_play";

  // observe_consequence: hypothesis + active audacity consequence
  if (riskCard && riskCard.stage === "hypothesis" && hasActiveConsequence(world, "audacity")) {
    return "observe_consequence";
  }

  // strengthen_hypothesis: hypothesis without active consequence
  if (riskCard && riskCard.stage === "hypothesis") return "strengthen_hypothesis";

  // test_trace
  if (riskCard && riskCard.stage === "trace") return "test_trace";

  // explore_world: at least one action, no discovery card yet, world.time < 6
  if (world.time >= 1 && world.time < 6 && !riskCard) return "explore_world";

  // Fallback for any unhandled state
  return "free_play";
}

export function buildPlayerGuidance(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
): PlayerGuidance {
  monotonicCheck(events);

  const discovery = buildDiscoveryJournal(events);
  const phase = getPhase(events, world, discovery);
  const riskCard = findRiskCard(discovery);

  let suggestions: GuidanceSuggestion[] = [];
  let title = "";
  let text = "";
  let mode: "onboarding" | "free_play" = "onboarding";

  switch (phase) {
    case "first_action": {
      title = "Первое действие";
      text = "Мир отвечает на поступки. Выбери первое намерение и посмотри, что изменится.";
      suggestions = [
        buildSuggestion("move_north", "Идти на север", "Исследовать мир на север.", 0),
        buildSuggestion("move_east", "Идти на восток", "Исследовать мир на восток.", 1),
        buildSuggestion("wait", "Ждать", "Позволить миру идти своим чередом.", 2),
      ];
      break;
    }
    case "explore_world": {
      title = "Исследуй мир";
      text = "Попробуй разные поступки. Мир запоминает не команды, а их последствия.";
      suggestions = [
        buildSuggestion("move_north", "Идти на север", "Продолжить движение.", 0),
        buildSuggestion("give_help", "Помочь", "Помочь гильдии.", 1),
        buildSuggestion("open_journal", "Журнал", "Посмотреть хронику ходов.", 2),
      ];
      break;
    }
    case "test_trace": {
      title = "Проверь след";
      text = "Ты заметил след. Можно повторить похожий поступок или сравнить его с предыдущим ходом.";
      suggestions = [
        buildSuggestion("move_north", "Идти на север", "Повторить движение.", 0),
        buildSuggestion("move_east", "Идти на восток", "Двигаться в другом направлении.", 1),
        buildSuggestion("open_journal", "Журнал", "Сравнить с предыдущим ходом.", 2),
      ];
      break;
    }
    case "strengthen_hypothesis": {
      title = "Укрепи гипотезу";
      text = "Закономерность начинает проявляться, но одного совпадения недостаточно.";
      suggestions = [
        buildSuggestion("move_north", "Идти", "Продолжить движение.", 0),
        buildSuggestion("open_discoveries", "Открытия", "Посмотреть карточку открытия.", 1),
        buildSuggestion("open_journal", "Журнал", "Просмотреть хронику.", 2),
      ];
      break;
    }
    case "observe_consequence": {
      title = "Наблюдай за последствием";
      text = "Последствие уже возникло. Дай миру время ответить или продолжай действовать.";
      suggestions = [
        buildSuggestion("wait", "Ждать", "Дать миру время.", 0),
        buildSuggestion("open_discoveries", "Открытия", "Следить за стадией открытия.", 1),
        buildSuggestion("give_help", "Помочь", "Выполнить социальное действие.", 2),
      ];
      break;
    }
    case "review_discovery": {
      title = "Открытие";
      text = "Наблюдения сложились в открытие. Сравни свидетельства и ход, в котором проявилось последствие.";
      suggestions = [
        buildSuggestion("open_discoveries", "Открытия", "Изучить доказательства.", 0),
        buildSuggestion("open_journal", "Журнал", "Найти ход с последствием.", 1),
        buildSuggestion("wait", "Ждать", "Продолжить наблюдение.", 2),
      ];
      break;
    }
    case "free_play": {
      mode = "free_play";
      title = "Куда дальше?";
      text = "";
      suggestions = [
        buildSuggestion("open_journal", "Журнал", "Просмотреть хронику.", 0),
        buildSuggestion("open_discoveries", "Открытия", "Посмотреть открытия.", 1),
        buildSuggestion("move_north", "Идти", "Продолжить движение.", 2),
      ];
      break;
    }
  }

  return deepFreeze({
    schemaVersion: 1 as const,
    mode,
    phase,
    title,
    text,
    suggestions,
    relatedDiscoveryId: riskCard?.discoveryId ?? null,
    worldTime: world.time,
  });
}
