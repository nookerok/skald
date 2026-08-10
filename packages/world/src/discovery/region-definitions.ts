import type { DomainEvent } from "@skald/event-bus";
import type { DiscoveryDefinition } from "./definitions.js";
import type { DiscoveryEvidence, DiscoveryResolution, DiscoveryStage, DiscoverySignalKind, EvidenceSource } from "./types.js";
import { deepFreeze } from "./builder.js";
import { loadCompiledRegionBundle } from "../region/bundle-loader.js";

interface EvidenceRule {
  readonly id: string;
  readonly subjectRefs?: readonly string[];
  readonly signalKinds?: readonly DiscoverySignalKind[];
  readonly minDistinctWorldTimes?: number;
  readonly minDistinctLocations?: number;
  readonly minIndependentSources?: number;
}

interface CompiledDiscoveryDefinition {
  readonly id: string;
  readonly version: number;
  readonly subjectKind: string;
  readonly objectIds?: readonly string[];
  readonly subjectIds?: readonly string[];
  readonly contradictionObjectIds?: readonly string[];
  readonly signalKind: DiscoverySignalKind;
  readonly title: string;
  readonly question: string;
  readonly summaries: Readonly<Record<DiscoveryStage, string>>;
  readonly evidenceText: string;
  readonly status: string;
  readonly evidenceRules?: readonly EvidenceRule[];
  readonly contradictionRules?: readonly EvidenceRule[];
  readonly stageThresholds?: { readonly hypothesis?: number; readonly discovered?: number };
}

function distinctCount(items: readonly DiscoveryEvidence[], selector: (item: DiscoveryEvidence) => string | null): number {
  return new Set(items.map(selector).filter((value): value is string => value !== null && value.length > 0)).size;
}

function matchesRule(items: readonly DiscoveryEvidence[], rule: EvidenceRule): boolean {
  const filtered = items.filter((item) => {
    if (rule.subjectRefs && !rule.subjectRefs.includes(item.subjectRef)) return false;
    if (rule.signalKinds && !rule.signalKinds.includes(item.kind)) return false;
    return true;
  });
  if (filtered.length === 0) return false;
  if (distinctCount(filtered, (item) => String(item.worldTime)) < (rule.minDistinctWorldTimes ?? 1)) return false;
  if (distinctCount(filtered, (item) => item.locationRef) < (rule.minDistinctLocations ?? 0)) return false;
  if (distinctCount(filtered, (item) => item.sourceEventIds[0] ?? null) < (rule.minIndependentSources ?? 1)) return false;
  return true;
}

function sourceFromPayload(payload: Record<string, unknown>): EvidenceSource {
  if (payload.evidenceSource === "sound" || payload.evidenceSource === "social" || payload.evidenceSource === "environment" || payload.evidenceSource === "reconstruction") return payload.evidenceSource;
  if (payload.knowledge === "rumored") return "social";
  return "direct_observation";
}

function evidence(definition: CompiledDiscoveryDefinition, event: DomainEvent, subjectRef: string, locationId: string | null, payload: Record<string, unknown>): DiscoveryEvidence {
  const role = payload.evidenceRole === "contradiction" ? "contradiction" : "support";
  return deepFreeze({
    evidenceId: definition.id + ":ev:" + event.eventId,
    kind: definition.signalKind,
    subjectRef,
    worldTime: event.timestamp,
    text: typeof payload.evidenceText === "string" ? payload.evidenceText : definition.evidenceText,
    sourceEventIds: [event.eventId],
    journalTurnId: "turn:" + event.timestamp,
    confidence: typeof payload.confidence === "number" ? Math.max(0, Math.min(1, payload.confidence)) : 0.82,
    freshness: 1,
    source: sourceFromPayload(payload),
    locationRef: locationId,
    bearing: typeof payload.bearing === "string" ? payload.bearing : null,
    contradictionGroup: role === "contradiction" ? definition.id + ":contradiction" : null,
  });
}

function buildDefinition(config: CompiledDiscoveryDefinition): DiscoveryDefinition {
  const subjectIds = new Set([...(config.subjectIds ?? []), ...(config.objectIds ?? [])]);
  const contradictionIds = new Set(config.contradictionObjectIds ?? []);
  const collect = (event: DomainEvent, locationId?: string | null): DiscoveryEvidence | null => {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "ObjectObserved" || event.type === "EntityExamined") {
      const objectId = typeof payload.objectId === "string" ? payload.objectId : typeof payload.entityId === "string" ? payload.entityId : null;
      if (!objectId || !subjectIds.has(objectId)) return null;
      return evidence(config, event, objectId, locationId ?? null, { ...payload, evidenceRole: contradictionIds.has(objectId) ? "contradiction" : payload.evidenceRole });
    }
    if (event.type === "SpatialObservationRecorded") {
      const subjectId = typeof payload.subjectId === "string" ? payload.subjectId : null;
      if (!subjectId || !subjectIds.has(subjectId)) return null;
      return evidence(config, event, subjectId, locationId ?? null, payload);
    }
    return null;
  };
  const classify = (items: readonly DiscoveryEvidence[]): DiscoveryStage | null => {
    if (items.length === 0) return null;
    const times = distinctCount(items, (item) => String(item.worldTime));
    const hypothesis = config.stageThresholds?.hypothesis ?? 2;
    const discovered = config.stageThresholds?.discovered ?? 3;
    if (times >= discovered) return "discovered";
    if (times >= hypothesis) return "hypothesis";
    return "trace";
  };
  return {
    id: config.id,
    version: config.version,
    subjectKind: config.subjectKind,
    collect,
    classify,
    resolve(items: readonly DiscoveryEvidence[]): { readonly resolution: DiscoveryResolution; readonly contradictionCount: number } {
      const contradictionCount = items.filter((item) => item.contradictionGroup !== null).length;
      const supports = (config.evidenceRules ?? []).some((rule) => matchesRule(items, rule));
      const contradicts = contradictionCount > 0 && (config.contradictionRules ?? []).some((rule) => matchesRule(items, rule));
      if (contradicts) return { resolution: "contradicted", contradictionCount };
      if (supports) return { resolution: "supported", contradictionCount };
      return { resolution: items.length > 0 ? "inconclusive" : "unresolved", contradictionCount };
    },
    render(stage: DiscoveryStage) {
      return { title: config.title, question: config.question, summary: config.summaries[stage] };
    },
  };
}

export function buildRegionContentDefinitions(regionId = "riverwatch-basin"): readonly DiscoveryDefinition[] {
  const bundle = loadCompiledRegionBundle(regionId);
  return Object.freeze(bundle.discoveryDefinitions.filter((entry) => {
    const status = (entry as { status?: string }).status;
    return status === "runtime";
  }).map((entry) => buildDefinition(entry as CompiledDiscoveryDefinition)));
}

export const REGION_CONTENT_DEFINITIONS: readonly DiscoveryDefinition[] = buildRegionContentDefinitions();
