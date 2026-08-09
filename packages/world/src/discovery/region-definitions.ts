import type { DomainEvent } from "@skald/event-bus";
import type { DiscoveryDefinition } from "./definitions.js";
import type { DiscoveryEvidence, DiscoveryStage, DiscoverySignalKind, EvidenceSource } from "./types.js";
import { deepFreeze } from "./builder.js";

function makeEvidence(
  definitionId: string,
  kind: DiscoverySignalKind,
  event: DomainEvent,
  text: string,
  subjectRef: string,
  locationId?: string | null,
): DiscoveryEvidence {
  return deepFreeze({
    evidenceId: definitionId + ":ev:" + event.eventId,
    kind,
    subjectRef,
    worldTime: event.timestamp,
    text,
    sourceEventIds: [event.eventId],
    journalTurnId: "turn:" + event.timestamp,
    confidence: 0.82,
    freshness: 1.0,
    source: "direct_observation" as EvidenceSource,
    locationRef: locationId ?? null,
    bearing: null,
    contradictionGroup: null,
  });
}

function objectDiscovery(
  id: string,
  objectIds: readonly string[],
  kind: DiscoverySignalKind,
  title: string,
  question: string,
  summaries: { trace: string; hypothesis: string; discovered: string },
  textFor: (objectId: string) => string,
): DiscoveryDefinition {
  return {
    id,
    version: 1,
    subjectKind: "object",
    collect(event: DomainEvent, locationId?: string | null): DiscoveryEvidence | null {
      if (event.type !== "ObjectObserved" && event.type !== "EntityExamined") return null;
      const payload = event.payload as { objectId?: string; entityId?: string };
      const objectId = payload.objectId ?? payload.entityId;
      if (!objectId || !objectIds.includes(objectId)) return null;
      return makeEvidence(id, kind, event, textFor(objectId), objectId, locationId);
    },
    classify(evidence: readonly DiscoveryEvidence[]): DiscoveryStage | null {
      const times = new Set(evidence.map((entry) => entry.worldTime));
      if (times.size >= 3) return "discovered";
      if (times.size >= 2) return "hypothesis";
      if (evidence.length > 0) return "trace";
      return null;
    },
    render(stage: DiscoveryStage): { title: string; question: string; summary: string } {
      return { title, question, summary: summaries[stage] };
    },
  };
}

const WATERFALL_EVIDENCE = objectDiscovery(
  "western_waterfalls",
  ["western_cliff_waterfalls"],
  "landmark_trace",
  "Водопады питают реку",
  "Связаны ли потоки на западных утёсах с уровнем реки?",
  {
    trace: "Ты увидел потоки, падающие с западных утёсов.",
    hypothesis: "Похоже, водопады связаны с руслом реки.",
    discovered: "Ты собрал повторные наблюдения: водопады остаются частью речного бассейна.",
  },
  () => "С уступа падают несколько потоков; внизу слышно движение воды.",
);

const CRATER_SURFACE = objectDiscovery(
  "crater_surface",
  ["glass_crater_surface"],
  "physical_trace",
  "Блеск Стеклянной впадины",
  "Почему поверхность впадины отражает свет?",
  {
    trace: "На дне чаши камень блестит после дождя.",
    hypothesis: "Поверхность ведёт себя не как обычный камень.",
    discovered: "Повторные осмотры подтверждают особое отражение, но не объясняют происхождение впадины.",
  },
  () => "Свет отражается от гладкого слоя; происхождение слоя остаётся неизвестным.",
);


export const REGION_CONTENT_DEFINITIONS: readonly DiscoveryDefinition[] = [
  WATERFALL_EVIDENCE,
  CRATER_SURFACE,
];
