import type { DomainEvent } from "@skald/event-bus";
import type { DiscoveryEvidence, DiscoveryStage, DiscoverySignalKind, EvidenceSource } from "./types.js";
import { deepFreeze } from "./builder.js";
import { REGION_CONTENT_DEFINITIONS } from "./region-definitions.js";

export interface DiscoveryDefinition {
  readonly id: string;
  readonly version: number;
  readonly subjectKind: string;
  collect(event: DomainEvent, locationId?: string | null): DiscoveryEvidence | null;
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null;
  render(stage: DiscoveryStage): { title: string; question: string; summary: string };
}

function makeEvidence(
  defId: string,
  index: number,
  kind: DiscoverySignalKind,
  worldTime: number,
  text: string,
  event: DomainEvent,
  overrides?: {
    subjectRef?: string;
    confidence?: number;
    source?: EvidenceSource;
    locationRef?: string | null;
    bearing?: string | null;
    contradictionGroup?: string | null;
  },
): DiscoveryEvidence {
  return deepFreeze({
    evidenceId: `${defId}:ev:${index}`,
    kind,
    subjectRef: overrides?.subjectRef ?? defId,
    worldTime,
    text,
    sourceEventIds: [event.eventId],
    journalTurnId: `turn:${worldTime}`,
    confidence: overrides?.confidence ?? 0.7,
    freshness: 1.0,
    source: overrides?.source ?? "direct_observation",
    locationRef: overrides?.locationRef ?? null,
    bearing: overrides?.bearing ?? null,
    contradictionGroup: overrides?.contradictionGroup ?? null,
  });
}

function countKinds(evidence: readonly DiscoveryEvidence[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ev of evidence) {
    counts[ev.kind] = (counts[ev.kind] ?? 0) + 1;
  }
  return counts;
}

// ── Legacy definitions (Iteration 15) ──────────────────────────────────

const RISK_DRAWS_ATTENTION: DiscoveryDefinition = {
  id: "risk_draws_attention",
  version: 1,
  subjectKind: "behavior",
  collect(event: DomainEvent): DiscoveryEvidence | null {
    return collectRiskDrawsAttention(event, 0);
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const counts = countKinds(evidence);
    if ((counts["echo"] ?? 0) > 0) return "discovered";
    if ((counts["omen"] ?? 0) > 0 || (counts["trace"] ?? 0) >= 2) return "hypothesis";
    if ((counts["trace"] ?? 0) > 0) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return { title: "Риск оставляет след", question: "Что происходит, когда ты снова и снова рискуешь?", summary: "Твои рискованные поступки не проходят бесследно." };
      case "hypothesis":
        return { title: "Риск оставляет след", question: "Что происходит, когда ты снова и снова рискуешь?", summary: "Похоже, мир начинает замечать повторяющийся риск." };
      case "discovered":
        return { title: "Риск оставляет след", question: "Что происходит, когда ты снова и снова рискуешь?", summary: "Ты понял: повторяющийся риск вызывает ответ мира." };
    }
  },
};

const HEAT_CHANGES_MATERIAL: DiscoveryDefinition = {
  id: "heat_changes_material",
  version: 1,
  subjectKind: "material",
  collect(event: DomainEvent): DiscoveryEvidence | null {
    return collectHeatChangesMaterial(event, 0);
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const counts = countKinds(evidence);
    if ((counts["echo"] ?? 0) > 0) return "discovered";
    if ((counts["omen"] ?? 0) > 0 || (counts["trace"] ?? 0) >= 2) return "hypothesis";
    if ((counts["trace"] ?? 0) > 0) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return { title: "Тепло меняет material", question: "Что происходит с предметами, когда они нагреваются?", summary: "Разные материалы сохраняют тепло по-разному." };
      case "hypothesis":
        return { title: "Тепло меняет material", question: "Что происходит с предметами, когда они нагреваются?", summary: "Тепло не просто ощущается — оно меняет состояние предметов." };
      case "discovered":
        return { title: "Тепло меняет material", question: "Что происходит с предметами, когда они нагреваются?", summary: "Нагрев материала способен изменить его свойства и поведение." };
    }
  },
};

const SOUND_DRAWS_ATTENTION: DiscoveryDefinition = {
  id: "sound_draws_attention",
  version: 1,
  subjectKind: "environment",
  collect(event: DomainEvent): DiscoveryEvidence | null {
    return collectSoundDrawsAttention(event, 0);
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const counts = countKinds(evidence);
    if ((counts["echo"] ?? 0) > 0) return "discovered";
    if ((counts["omen"] ?? 0) > 0 || (counts["trace"] ?? 0) >= 2) return "hypothesis";
    if ((counts["trace"] ?? 0) > 0) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return { title: "Звук привлекает внимание", question: "Что происходит, когда ты производишь громкий звук?", summary: "После громкого действия башня отвечает новым звуком." };
      case "hypothesis":
        return { title: "Звук привлекает внимание", question: "Что происходит, когда ты производишь громкий звук?", summary: "Шум замечает не только тот, кто его создаёт." };
      case "discovered":
        return { title: "Звук привлекает внимание", question: "Что происходит, когда ты производишь громкий звук?", summary: "Громкие действия меняют поведение скрытых процессов мира." };
    }
  },
};

// ── Legacy collectors (used by builder for backward compatibility) ──────

export function collectRiskDrawsAttention(event: DomainEvent, index: number): DiscoveryEvidence | null {
  const type = event.type;
  const payload = event.payload as Record<string, unknown>;
  if (type === "ObservationUpdated" && payload["key"] === "risk_taken") {
    return makeEvidence("risk_draws_attention", index, "trace", event.timestamp, "Твой рискованный поступок не остался незамеченным.", event);
  }
  if (type === "AudacityTriggered") {
    return makeEvidence("risk_draws_attention", index, "omen", event.timestamp, "Твоя дерзость не осталась без ответа — мир настороже.", event);
  }
  if (type === "ConsequenceCreated" && payload["type"] === "audacity") {
    return makeEvidence("risk_draws_attention", index, "omen", event.timestamp, "Твои действия породили тревожное предвестие.", event);
  }
  if (type === "ConsequenceFired" && payload["consequenceType"] === "audacity") {
    return makeEvidence("risk_draws_attention", index, "echo", event.timestamp, "Последствие проявило себя — мир ответил на риск.", event);
  }
  return null;
}

export function collectHeatChangesMaterial(event: DomainEvent, index: number): DiscoveryEvidence | null {
  const type = event.type;
  const payload = event.payload as Record<string, unknown>;
  if (type === "ObjectTemperatureChanged" && (payload["temperature"] as number) > 50) {
    return makeEvidence("heat_changes_material", index, "trace", event.timestamp, "Ты применил тепло к объекту. Металл реагирует на нагрев.", event);
  }
  if (type === "ObjectIntegrityChanged") {
    const prev = payload["previousIntegrity"] as number;
    const curr = payload["integrity"] as number;
    if (curr < prev) {
      return makeEvidence("heat_changes_material", index, "omen", event.timestamp, "Целостность объекта изменилась — он стал слабее.", event);
    }
  }
  return null;
}

export function collectSoundDrawsAttention(event: DomainEvent, index: number): DiscoveryEvidence | null {
  const type = event.type;
  const payload = event.payload as Record<string, unknown>;
  if (type === "SoundProduced" && payload["intensity"] === "loud") {
    return makeEvidence("sound_draws_attention", index, "trace", event.timestamp, "Громкий звук разнёсся по пространству.", event);
  }
  if (type === "ConsequenceCreated" && payload["type"] === "noise_attention") {
    return makeEvidence("sound_draws_attention", index, "omen", event.timestamp, "Мир реагирует на шум.", event);
  }
  return null;
}

// ── Spatial Discovery Definitions (ADR-0018) ──────────────────────────

const RIVER_CYCLE: DiscoveryDefinition = {
  id: "river_cycle",
  version: 1,
  subjectKind: "river",
  collect(event: DomainEvent, locationId?: string | null): DiscoveryEvidence | null {
    const type = event.type;
    const payload = event.payload as Record<string, unknown>;

    if (type === "RiverLevelChanged") {
      const band = payload["band"] as string;
      const previousBand = payload["previousBand"] as string;
      if (band !== previousBand) {
        const text = band === "high" || band === "flood"
          ? "Вода поднялась — камни переправы скрыты."
          : "Вода отступила — переправа снова видна.";
        return makeEvidence("river_cycle", 0, "water_trace", event.timestamp, text, event, {
          subjectRef: "river_basin", source: "environment", locationRef: locationId ?? null,
        });
      }
    }

    if (type === "CrossingConditionChanged") {
      const condition = payload["condition"] as string;
      const text = condition === "closed"
        ? "Переправа закрыта — течение слишком сильное."
        : condition === "difficult"
        ? "Переправа стала труднее — вода поднялась."
        : "Переправа снова открыта — вода спала.";
      return makeEvidence("river_cycle", 0, "structural_trace", event.timestamp, text, event, {
        subjectRef: "river_crossing", source: "direct_observation", locationRef: locationId ?? null,
      });
    }
    return null;
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const independentTimes = new Set(evidence.map((e) => e.worldTime));
    if (independentTimes.size >= 3) return "discovered";
    if (independentTimes.size >= 2) return "hypothesis";
    if (evidence.length >= 1) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return { title: "Вода меняется", question: "Почему уровень воды меняется?", summary: "Ты заметил, что вода поднимается и опускается." };
      case "hypothesis":
        return { title: "Цикл реки", question: "Следует ли река повторяющемуся циклу?", summary: "Похоже, вода поднимается и опускается по закономерности." };
      case "discovered":
        return { title: "Закономерность прилива", question: "Как именно река меняет свой уровень?", summary: "Ты выяснил: река следует циклическому закону изменения уровня." };
    }
  },
};

const MONOLITH_SIGHTING: DiscoveryDefinition = {
  id: "monolith_sighting",
  version: 1,
  subjectKind: "landmark",
  collect(event: DomainEvent, locationId?: string | null): DiscoveryEvidence | null {
    const type = event.type;
    const payload = event.payload as Record<string, unknown>;

    if (type === "SpatialObservationRecorded") {
      const subjectId = payload["subjectId"] as string;
      const subjectKind = payload["subjectKind"] as string;
      if (subjectId === "suspended_monolith" && subjectKind === "landmark") {
        const knowledge = payload["knowledge"] as string;
        const bearing = payload["bearing"] as string | undefined;
        const text = knowledge === "glimpsed"
          ? `На горизонте показался тёмный силуэт${bearing ? ` (${bearing})` : ""}.`
          : "Ты разглядел объект — он не касается земли.";
        return makeEvidence("monolith_sighting", 0, "landmark_trace", event.timestamp, text, event, {
          subjectRef: "suspended_monolith", confidence: knowledge === "glimpsed" ? 0.4 : 0.8,
          source: "direct_observation", locationRef: locationId ?? null, bearing: bearing ?? null,
        });
      }
    }
    return null;
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const independentTimes = new Set(evidence.map((e) => e.worldTime));
    const hasObserved = evidence.some((e) => e.confidence >= 0.7);
    if (independentTimes.size >= 2 && hasObserved) return "discovered";
    if (independentTimes.size >= 2) return "hypothesis";
    if (evidence.length >= 1) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return { title: "Тёмный силуэт", question: "Что это за объект на горизонте?", summary: "Ты заметил необычный силуэт вдалеке." };
      case "hypothesis":
        return { title: "Парящий объект", question: "Держится ли объект в воздухе?", summary: "Силуэт появляется снова — и, кажется, не касается земли." };
      case "discovered":
        return { title: "Парящий монолит", question: "Что удерживает монолит в воздухе?", summary: "Ты убедился: объект парит над землёй, не имея видимой опоры." };
    }
  },
};

const CROSSING_CHANGES: DiscoveryDefinition = {
  id: "crossing_changes",
  version: 1,
  subjectKind: "route",
  collect(event: DomainEvent, locationId?: string | null): DiscoveryEvidence | null {
    const type = event.type;
    const payload = event.payload as Record<string, unknown>;

    if (type === "CrossingConditionChanged") {
      const condition = payload["condition"] as string;
      const previousCondition = payload["previousCondition"] as string;
      if (condition !== previousCondition) {
        const text = condition === "closed"
          ? "Переправа закрыта — камни скрыты водой."
          : condition === "difficult"
          ? "Переправа стала медленнее — течение усилилось."
          : "Переправа снова безопасна — вода отступила.";
        return makeEvidence("crossing_changes", 0, "structural_trace", event.timestamp, text, event, {
          subjectRef: "river_crossing", source: "direct_observation", locationRef: locationId ?? null,
        });
      }
    }
    return null;
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const independentTimes = new Set(evidence.map((e) => e.worldTime));
    if (independentTimes.size >= 3) return "discovered";
    if (independentTimes.size >= 2) return "hypothesis";
    if (evidence.length >= 1) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return { title: "Изменение переправы", question: "Почему переправа меняется?", summary: "Ты заметил, что состояние переправы изменилось." };
      case "hypothesis":
        return { title: "Динамическая переправа", question: "Зависит ли переправа от уровня воды?", summary: "Переправа меняется вместе с уровнем реки." };
      case "discovered":
        return { title: "Закон переправы", question: "Как именно вода влияет на переправу?", summary: "Ты выяснил: переправа напрямую зависит от уровня реки." };
    }
  },
};


export const DEFINITIONS: DiscoveryDefinition[] = [
  RISK_DRAWS_ATTENTION,
  HEAT_CHANGES_MATERIAL,
  SOUND_DRAWS_ATTENTION,
  RIVER_CYCLE,
  MONOLITH_SIGHTING,
  CROSSING_CHANGES,
  ...REGION_CONTENT_DEFINITIONS,
];
