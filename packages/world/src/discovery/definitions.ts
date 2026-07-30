import type { DomainEvent } from "@skald/event-bus";
import type { DiscoveryEvidence, DiscoveryStage } from "./types.js";
import { deepFreeze } from "./builder.js";

export interface DiscoveryDefinition {
  readonly id: string;
  readonly version: number;
  collect(event: DomainEvent): DiscoveryEvidence | null;
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null;
  render(stage: DiscoveryStage): { title: string; question: string; summary: string };
}

const TEXTS: Record<string, string> = {
  risk_taken: "Твой рискованный поступок не остался незамеченным.",
  audacity_triggered: "Твоя дерзость не осталась без ответа — мир настороже.",
  audacity_created: "Твои действия породили тревожное предвестие.",
  audacity_fired: "Последствие проявило себя — мир ответил на риск.",
  // Iteration 15
  temperature_changed: "Температура предмета изменилась — это меняет его свойства.",
  heat_applied: "Ты применил тепло к объекту. Металл реагирует на нагрев.",
  sound_produced: "Громкий звук разнёсся по пространству.",
  integrity_changed: "Целостность объекта изменилась — он стал слабее или сильнее.",
};

function makeEvidence(
  defId: string,
  index: number,
  kind: DiscoveryEvidence["kind"],
  worldTime: number,
  text: string,
  event: DomainEvent,
): DiscoveryEvidence {
  return deepFreeze({
    evidenceId: `${defId}:ev:${index}`,
    kind,
    worldTime,
    text,
    sourceEventIds: [event.eventId],
    journalTurnId: `turn:${worldTime}`,
  });
}

const RISK_DRAWS_ATTENTION: DiscoveryDefinition = {
  id: "risk_draws_attention",
  version: 1,
  collect(_event: DomainEvent): DiscoveryEvidence | null {
    return null;
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const counts = { trace: 0, omen: 0, echo: 0 };
    for (const ev of evidence) counts[ev.kind] += 1;

    if (counts.echo > 0) return "discovered";
    if (counts.omen > 0 || counts.trace >= 2) return "hypothesis";
    if (counts.trace > 0) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return {
          title: "Риск оставляет след",
          question: "Что происходит, когда ты снова и снова рискуешь?",
          summary: "Твои рискованные поступки не проходят бесследно.",
        };
      case "hypothesis":
        return {
          title: "Риск оставляет след",
          question: "Что происходит, когда ты снова и снова рискуешь?",
          summary: "Похоже, мир начинает замечать повторяющийся риск.",
        };
      case "discovered":
        return {
          title: "Риск оставляет след",
          question: "Что происходит, когда ты снова и снова рискуешь?",
          summary: "Ты понял: повторяющийся риск вызывает ответ мира.",
        };
    }
  },
};

// Iteration 15 — Heat Changes Material
const HEAT_CHANGES_MATERIAL: DiscoveryDefinition = {
  id: "heat_changes_material",
  version: 1,
  collect(_event: DomainEvent): DiscoveryEvidence | null {
    return null;
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const counts = { trace: 0, omen: 0, echo: 0 };
    for (const ev of evidence) counts[ev.kind] += 1;

    if (counts.echo > 0) return "discovered";
    if (counts.omen > 0 || counts.trace >= 2) return "hypothesis";
    if (counts.trace > 0) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return {
          title: "Тепло меняет material",
          question: "Что происходит с предметами, когда они нагреваются?",
          summary: "Разные материалы сохраняют тепло по-разному.",
        };
      case "hypothesis":
        return {
          title: "Тепло меняет material",
          question: "Что происходит с предметами, когда они нагреваются?",
          summary: "Тепло не просто ощущается — оно меняет состояние предметов.",
        };
      case "discovered":
        return {
          title: "Тепло меняет material",
          question: "Что происходит с предметами, когда они нагреваются?",
          summary: "Нагрев материала способен изменить его свойства и поведение.",
        };
    }
  },
};

// Iteration 15 — Sound Draws Attention
const SOUND_DRAWS_ATTENTION: DiscoveryDefinition = {
  id: "sound_draws_attention",
  version: 1,
  collect(_event: DomainEvent): DiscoveryEvidence | null {
    return null;
  },
  classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
    const counts = { trace: 0, omen: 0, echo: 0 };
    for (const ev of evidence) counts[ev.kind] += 1;

    if (counts.echo > 0) return "discovered";
    if (counts.omen > 0 || counts.trace >= 2) return "hypothesis";
    if (counts.trace > 0) return "trace";
    return null;
  },
  render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
    switch (stage) {
      case "trace":
        return {
          title: "Звук привлекает внимание",
          question: "Что происходит, когда ты производишь громкий звук?",
          summary: "После громкого действия башня отвечает новым звуком.",
        };
      case "hypothesis":
        return {
          title: "Звук привлекает внимание",
          question: "Что происходит, когда ты производишь громкий звук?",
          summary: "Шум замечает не только тот, кто его создаёт.",
        };
      case "discovered":
        return {
          title: "Звук привлекает внимание",
          question: "Что происходит, когда ты производишь громкий звук?",
          summary: "Громкие действия меняют поведение скрытых процессов мира.",
        };
    }
  },
};

export function collectRiskDrawsAttention(
  event: DomainEvent,
  index: number,
): DiscoveryEvidence | null {
  const type = event.type;
  const payload = event.payload as Record<string, unknown>;

  if (type === "ObservationUpdated") {
    if (payload["key"] === "risk_taken") {
      return makeEvidence("risk_draws_attention", index, "trace", event.timestamp, TEXTS["risk_taken"]!, event);
    }
  }

  if (type === "AudacityTriggered") {
    return makeEvidence("risk_draws_attention", index, "omen", event.timestamp, TEXTS["audacity_triggered"]!, event);
  }

  if (type === "ConsequenceCreated" && payload["type"] === "audacity") {
    return makeEvidence("risk_draws_attention", index, "omen", event.timestamp, TEXTS["audacity_created"]!, event);
  }

  if (type === "ConsequenceFired" && payload["consequenceType"] === "audacity") {
    return makeEvidence("risk_draws_attention", index, "echo", event.timestamp, TEXTS["audacity_fired"]!, event);
  }

  return null;
}

export function collectHeatChangesMaterial(
  event: DomainEvent,
  index: number,
): DiscoveryEvidence | null {
  const type = event.type;
  const payload = event.payload as Record<string, unknown>;

  if (type === "ObjectTemperatureChanged") {
    const temp = payload["temperature"] as number;
    if (temp > 50) {
      return makeEvidence("heat_changes_material", index, "trace", event.timestamp, TEXTS["heat_applied"]!, event);
    }
  }

  if (type === "ObjectIntegrityChanged") {
    const prev = payload["previousIntegrity"] as number;
    const curr = payload["integrity"] as number;
    if (curr < prev) {
      return makeEvidence("heat_changes_material", index, "omen", event.timestamp, TEXTS["integrity_changed"]!, event);
    }
  }

  return null;
}

export function collectSoundDrawsAttention(
  event: DomainEvent,
  index: number,
): DiscoveryEvidence | null {
  const type = event.type;
  const payload = event.payload as Record<string, unknown>;

  if (type === "SoundProduced") {
    const intensity = payload["intensity"] as string;
    if (intensity === "loud") {
      return makeEvidence("sound_draws_attention", index, "trace", event.timestamp, TEXTS["sound_produced"]!, event);
    }
  }

  if (type === "ConsequenceCreated" && payload["type"] === "noise_attention") {
    return makeEvidence("sound_draws_attention", index, "omen", event.timestamp, "Мир реагирует на шум.", event);
  }

  return null;
}

export const DEFINITIONS: DiscoveryDefinition[] = [
  RISK_DRAWS_ATTENTION,
  HEAT_CHANGES_MATERIAL,
  SOUND_DRAWS_ATTENTION,
];
