import type { DomainEvent } from "@skald/event-bus";
import type { PresentationTemplate, PresentationCandidate } from "./types.js";
import { WORLD_WIDTH, WORLD_HEIGHT } from "../map.js";

const OBSERVATION_TEXTS: Record<string, string> = {
  risk_taken: "Твой рискованный поступок не остался незамеченным.",
  wall_caution: "Повторяющиеся преграды оставляют след в твоём пути.",
  edge_awareness: "Граница мира становится для тебя всё очевиднее.",
  impatience: "Твоя поспешность начинает проявляться в поступках.",
  world_reaction_fear: "Мир отвечает на твои действия нарастающим страхом.",
};

function cand(
  id: string, kind: PresentationCandidate["kind"], importance: PresentationCandidate["defaultImportance"],
  rank: number, text: string, event: DomainEvent, groupKey?: string, threadKey?: string, threadLabel?: string,
  discoveryMark: PresentationCandidate["discoveryMark"] = null,
): PresentationCandidate {
  return {
    templateId: id, kind, defaultImportance: importance, rank,
    discoveryMark, text, timestamp: event.timestamp,
    sourceEventIds: [event.eventId], groupKey: groupKey ?? null,
    threadKey: threadKey ?? null, threadLabel: threadLabel ?? null,
  };
}

export const MOVEMENT_SUCCEEDED: PresentationTemplate = {
  id: "movement_succeeded", listens: ["MovementSucceeded"],
  present: (event, _world) => cand("movement_succeeded", "action", "primary", 100, "Ты проходишь дальше.", event),
};

export const MOVEMENT_BLOCKED_WALL: PresentationTemplate = {
  id: "movement_blocked_wall", listens: ["MovementBlocked"],
  present: (event, _world) => {
    const r = (event.payload as { reason: string }).reason;
    if (r === "wall") return cand("movement_blocked_wall", "action", "primary", 100, "Путь преграждает стена.", event);
    if (r === "boundary") return cand("movement_blocked_boundary", "action", "primary", 100, "Ты достиг края мира — дальше пути нет.", event);
    return null;
  },
};

export const ACTION_REJECTED: PresentationTemplate = {
  id: "action_rejected", listens: ["ActionRejected"],
  present: (event, _world) => {
    const r = (event.payload as { reason: string }).reason;
    if (r === "insufficient_time") {
      return cand("action_rejected_time", "action", "primary", 100, "Ты уже сделал всё, что можно было успеть в это мгновение. Придётся подождать.", event);
    }
    return null;
  },
};

export const COMMAND_REJECTED: PresentationTemplate = {
  id: "command_rejected", listens: ["CommandRejected"],
  present: (event, _world) => cand("command_rejected", "action", "primary", 100, "Мир не понял этого намерения.", event),
};

export const RELATION_CHANGED: PresentationTemplate = {
  id: "relation_changed", listens: ["RelationChanged"],
  present: (event, _world) => {
    const { kind, to, delta } = event.payload as { kind: string; to: string; delta: number };
    const dir = delta > 0 ? "укрепились" : "ослабли";
    return cand("relation_changed", "relation", "primary", 90, `Твои связи с '${to}' ${dir} (${kind}).`, event, undefined, `relation:${to}:${kind}`, `Отношение: ${to}`);
  },
};

export const FOREST_FIRE_STARTED: PresentationTemplate = {
  id: "forest_fire_started", listens: ["ForestFireStarted"],
  present: (event, _world) => cand("forest_fire_started", "situation", "primary", 100, "В лесу разгорается пожар.", event, undefined, `situation:forest_fire`, `Лесной пожар`),
};

export const SITUATION_STARTED: PresentationTemplate = {
  id: "situation_started", listens: ["SituationStarted"],
  present: (event, _world) => {
    const { situationId, duration } = event.payload as { situationId: string; duration: number };
    return cand("situation_started", "situation", "notable", 70, `Мир вокруг тебя меняется: ${situationId} (ещё ${duration} тиков).`, event, `sit:started:${situationId}`, `situation:${situationId}`, `Ситуация: ${situationId}`);
  },
};

export const SITUATION_ENDED: PresentationTemplate = {
  id: "situation_ended", listens: ["SituationEnded"],
  present: (event, _world) => {
    const { situationId } = event.payload as { situationId: string };
    return cand("situation_ended", "situation", "notable", 60, `Ситуация ${situationId} завершилась.`, event, `sit:ended:${situationId}`, `situation:${situationId}`, `Ситуация: ${situationId}`);
  },
};

export const TREE_BURNED: PresentationTemplate = {
  id: "tree_burned", listens: ["TreeBurned"],
  present: (event, _world) => {
    const { treeIndex } = event.payload as { treeIndex: number };
    return cand("tree_burned", "situation", "notable", 60, `В огне погибло дерево #${treeIndex}.`, event, "forest_fire_tree", `situation:forest_fire`, `Лесной пожар`);
  },
};

export const AUDACITY_TRIGGERED: PresentationTemplate = {
  id: "audacity_triggered", listens: ["AudacityTriggered"],
  present: (event, _world) => cand("audacity_triggered", "consequence", "notable", 90, "Твоя дерзость не осталась без ответа — мир настороже.", event, undefined, `consequence:audacity`, `Последствие: audacity`, "omen"),
};

export const CONSEQUENCE_CREATED: PresentationTemplate = {
  id: "consequence_created", listens: ["ConsequenceCreated"],
  present: (event, _world) => {
    const { type, expiresAt } = event.payload as { type: string; expiresAt: number };
    const mark: PresentationCandidate["discoveryMark"] = type === "audacity" ? "omen" : null;
    return cand("consequence_created", "consequence", "notable", 80, `Твои действия породили последствие: ${type} (до тика ${expiresAt}).`, event, `cons:created:${type}`, `consequence:${type}`, `Последствие: ${type}`, mark);
  },
};

export const CONSEQUENCE_FIRED: PresentationTemplate = {
  id: "consequence_fired", listens: ["ConsequenceFired"],
  present: (event, _world) => {
    const p = event.payload as { consequenceType: string };
    const mark: PresentationCandidate["discoveryMark"] = p.consequenceType === "audacity" ? "echo" : null;
    return cand("consequence_fired", "consequence", "notable", 80, `Последствие ${p.consequenceType} проявило себя.`, event, `cons:fired:${p.consequenceType}`, `consequence:${p.consequenceType}`, `Последствие: ${p.consequenceType}`, mark);
  },
};

export const CONSEQUENCE_EXPIRED: PresentationTemplate = {
  id: "consequence_expired", listens: ["ConsequenceExpired"],
  present: (_event, _world) => null,
};

export const OBSERVATION_UPDATED: PresentationTemplate = {
  id: "observation_updated", listens: ["ObservationUpdated"],
  present: (event, _world) => {
    const { key } = event.payload as { key: string };
    const text = OBSERVATION_TEXTS[key];
    if (!text) return null;
    const mark: PresentationCandidate["discoveryMark"] = key === "risk_taken" ? "trace" : null;
    return cand("observation_updated", "observation", "notable", 70, text, event, `obs:${key}`, `observation:${key}`, `Наблюдение: ${key}`, mark);
  },
};

export const HEAT_RADIATED: PresentationTemplate = {
  id: "heat_radiated", listens: ["HeatRadiated"],
  present: (event, world) => {
    const { x, y } = event.payload as { x: number; y: number };
    const player = world.player;
    const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
    if (dist === 0) return cand("heat_radiated_near", "world", "notable", 80, "Жар ощущается совсем рядом, под ногами.", event, "heat", "world:heat", "Тепло");
    if (dist <= 2 && x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT) {
      return cand("heat_radiated_near", "world", "notable", 60, "Тепло распространяется поблизости.", event, "heat", "world:heat", "Тепло");
    }
    return cand("heat_radiated_far", "world", "background", 30, "Где-то в мире разливается тепло.", event, "heat", "world:heat", "Тепло");
  },
};

export const TICK_PASSED: PresentationTemplate = {
  id: "tick_passed", listens: ["TickPassed"],
  present: (event, _world) => {
    const p = event.payload as { playerOffline?: boolean };
    if (p.playerOffline) return cand("tick_passed_offline", "time", "background", 10, "Время идёт без тебя...", event);
    return null;
  },
};

// ── Iteration 15 — Open Intent Templates ────────────────────────────

export const ACTION_ATTEMPTED: PresentationTemplate = {
  id: "action_attempted", listens: ["ActionAttempted"],
  present: (event, _world) => {
    const p = event.payload as { operation: string; target?: { raw: string } | null };
    const target = p.target?.raw ? ` → ${p.target.raw}` : "";
    return cand("action_attempted", "action", "primary", 100, `Ты пытаешься: ${p.operation}${target}.`, event);
  },
};

export const ACTION_RESOLVED: PresentationTemplate = {
  id: "action_resolved", listens: ["ActionResolved"],
  present: (event, _world) => {
    const p = event.payload as { result: string; description: string };
    const text = p.description || `Результат: ${p.result}.`;
    return cand("action_resolved", "action", "primary", 95, text, event);
  },
};

export const ACTION_BLOCKED: PresentationTemplate = {
  id: "action_blocked", listens: ["ActionBlocked"],
  present: (event, _world) => {
    const p = event.payload as { reason: string; objectName?: string };
    if (p.objectName) {
      return cand("action_blocked_object", "action", "primary", 100, `${p.objectName} преграждает путь.`, event);
    }
    return cand("action_blocked", "action", "primary", 100, "Действие невозможно.", event);
  },
};

export const OBJECT_OBSERVED: PresentationTemplate = {
  id: "object_observed", listens: ["ObjectObserved"],
  present: (event, _world) => {
    const p = event.payload as { name: string; description: string; temperature: number; integrity: number };
    let text = p.description;
    if (p.temperature > 60) text += " Горячий на ощупь.";
    if (p.integrity < 40) text += " Выглядит повреждённым.";
    return cand("object_observed", "observation", "primary", 90, text, event, `obj:${p.name}`, undefined, "trace");
  },
};

export const ENTITY_EXAMINED: PresentationTemplate = {
  id: "entity_examined", listens: ["EntityExamined"],
  present: (event, _world) => {
    const { name, description } = event.payload as { name: string; description: string };
    return cand("entity_examined", "observation", "primary", 105,
      `Ты рассматриваешь ${name}. ${description}`, event, `entity:${name}`, undefined, "trace");
  },
};

export const SOUND_OBSERVED: PresentationTemplate = {
  id: "sound_observed", listens: ["SoundObserved"],
  present: (event, _world) => {
    const p = event.payload as { description: string };
    return cand("sound_observed", "observation", "notable", 85, p.description, event);
  },
};

export const ACTION_HAD_NO_OBSERVABLE_EFFECT: PresentationTemplate = {
  id: "action_had_no_observable_effect", listens: ["ActionHadNoObservableEffect"],
  present: (event, _world) => {
    const p = event.payload as { reason?: string };
    if (p.reason === "silence" || p.reason === "silent_target") {
      return cand("action_had_no_observable_effect", "observation", "background", 60,
        "Тихо. Слышно только собственное дыхание.", event);
    }
    return cand("action_had_no_observable_effect", "observation", "background", 60,
      "Ничего особенного не происходит.", event);
  },
};

export const OBJECT_TEMPERATURE_CHANGED: PresentationTemplate = {
  id: "object_temperature_changed", listens: ["ObjectTemperatureChanged"],
  present: (event, _world) => {
    const p = event.payload as { name: string; temperature: number; previousTemperature: number };
    if (p.temperature > p.previousTemperature) {
      if (p.temperature > 80) {
        return cand("object_temp_hot", "observation", "notable", 85, `${p.name} раскаляется.`, event, `temp:${p.name}`);
      }
      if (p.temperature > 50) {
        return cand("object_temp_warm", "observation", "notable", 75, `${p.name} нагревается.`, event, `temp:${p.name}`);
      }
      return cand("object_temp_slight", "observation", "background", 50, `${p.name} слегка тёплая.`, event, `temp:${p.name}`);
    }
    return null;
  },
};

export const SOUND_PRODUCED: PresentationTemplate = {
  id: "sound_produced", listens: ["SoundProduced"],
  present: (event, _world) => {
    const p = event.payload as { source: string; kind: string; intensity: string };
    if (p.intensity === "loud") {
      return cand("sound_loud", "observation", "notable", 80, `Громкий звук: ${p.source}.`, event, "sound", "world:sound", "trace");
    }
    return cand("sound_quiet", "observation", "background", 40, `Тихий звук: ${p.source}.`, event, "sound");
  },
};

export const CRITICAL_CHECK_REQUESTED: PresentationTemplate = {
  id: "critical_check_requested", listens: ["CriticalCheckRequested"],
  present: (event, _world) => {
    const p = event.payload as { stakes: { success: string; failure: string }; checkKind: string };
    return cand("critical_check", "action", "primary", 110,
      `Критический момент: ${p.stakes.success} Неудача: ${p.stakes.failure}`,
      event, "critical", "critical:check", "Критический момент");
  },
};

export const CRITICAL_CHECK_RESOLVED: PresentationTemplate = {
  id: "critical_check_resolved", listens: ["CriticalCheckResolved"],
  present: (event, _world) => {
    const p = event.payload as { outcome: string; total: number; difficulty: number };
    if (p.outcome === "success" || p.outcome === "critical_success") {
      return cand("critical_success", "action", "primary", 110,
        `Бросок ${p.total} (против ${p.difficulty}): Успех!`,
        event, "critical", "critical:check", "Критический момент");
    }
    return cand("critical_failure", "action", "primary", 110,
      `Бросок ${p.total} (против ${p.difficulty}): Неудача.`,
      event, "critical", "critical:check", "Критический момент");
  },
};

export const PLAYER_LOCATION_CHANGED: PresentationTemplate = {
  id: "player_location_changed", listens: ["PlayerLocationChanged"],
  present: (event, _world) => {
    const p = event.payload as { locationName: string };
    return cand("player_location_changed", "action", "primary", 95,
      `Ты перемещаешься: ${p.locationName}.`,
      event, "location");
  },
};

export const ALL_TEMPLATES: PresentationTemplate[] = [
  MOVEMENT_SUCCEEDED,
  MOVEMENT_BLOCKED_WALL,
  ACTION_REJECTED,
  COMMAND_REJECTED,
  RELATION_CHANGED,
  FOREST_FIRE_STARTED,
  SITUATION_STARTED,
  SITUATION_ENDED,
  TREE_BURNED,
  AUDACITY_TRIGGERED,
  CONSEQUENCE_CREATED,
  CONSEQUENCE_FIRED,
  CONSEQUENCE_EXPIRED,
  OBSERVATION_UPDATED,
  HEAT_RADIATED,
  TICK_PASSED,
  // Iteration 15 — Open Intent templates
  ACTION_ATTEMPTED,
  ACTION_RESOLVED,
  ACTION_BLOCKED,
  OBJECT_OBSERVED,
  ENTITY_EXAMINED,
  SOUND_OBSERVED,
  ACTION_HAD_NO_OBSERVABLE_EFFECT,
  OBJECT_TEMPERATURE_CHANGED,
  SOUND_PRODUCED,
  CRITICAL_CHECK_REQUESTED,
  CRITICAL_CHECK_RESOLVED,
  PLAYER_LOCATION_CHANGED,
];
