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
    // Collect is called in the same order as the Event Log.
    // We use a closure counter for evidenceId.
    // This is fine because the builder calls collect in log order.
    return null; // Handled by builder; this is just a signature.
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

export const DEFINITIONS: DiscoveryDefinition[] = [
  RISK_DRAWS_ATTENTION,
];
