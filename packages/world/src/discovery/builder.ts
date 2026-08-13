import type { DomainEvent } from "@skald/event-bus";
import type { DiscoveryCard, DiscoveryEvidence, DiscoveryJournal, BiographyDiscoveryChain, BiographyDiscoveryStep, RumorRecord } from "./types.js";
import { DEFINITIONS } from "./definitions.js";

export { DEFINITIONS } from "./definitions.js";
export type { DiscoveryDefinition } from "./definitions.js";

export function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === "object") deepFreeze(v);
  }
  return obj;
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

/** Get current location from event stream */
function currentLocation(events: readonly DomainEvent[]): string | null {
  let id: string | null = null;
  for (const event of events) {
    if (event.type === "PlayerLocationChanged") {
      id = (event.payload as { locationId: string }).locationId;
    }
  }
  return id;
}

/** Filter events to observer scope: exclude offline events */
function observerScopeFilter(events: readonly DomainEvent[]): readonly DomainEvent[] {
  return events.filter((event) => {
    // Exclude offline tick events from evidence collection
    if (event.type === "TickPassed") {
      const payload = event.payload as { playerOffline?: boolean };
      if (payload.playerOffline === true) return false;
    }
    return true;
  });
}

/** Build biography chains from evidence */
function buildBiographyChains(
  evidence: readonly DiscoveryEvidence[],
): readonly BiographyDiscoveryChain[] {
  const chains: BiographyDiscoveryChain[] = [];
  const evidenceBySubject = new Map<string, DiscoveryEvidence[]>();

  for (const ev of evidence) {
    const existing = evidenceBySubject.get(ev.subjectRef) ?? [];
    existing.push(ev);
    evidenceBySubject.set(ev.subjectRef, existing);
  }

  for (const [subjectRef, subjectEvidence] of evidenceBySubject) {
    if (subjectEvidence.length < 2) continue;

    const sorted = [...subjectEvidence].sort((a, b) => a.worldTime - b.worldTime);
    const steps: BiographyDiscoveryStep[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i]!;
      const kind = i === 0 ? "observation" as const
        : i === sorted.length - 1 ? "confirmation" as const
        : "trace" as const;

      steps.push(deepFreeze({
        ref: `bio:${subjectRef}:step:${i}`,
        kind,
        text: ev.text,
        worldTime: ev.worldTime,
        locationLabel: ev.locationRef ?? null,
        evidenceRef: ev.evidenceId,
      }));
    }

    const status = steps.length >= 3 ? "understood" as const : "forming" as const;
    chains.push(deepFreeze({
      ref: `chain:${subjectRef}`,
      title: subjectRef.replace(/_/g, " "),
      status,
      steps: deepFreeze(steps),
    }));
  }

  return deepFreeze(chains);
}

export function buildDiscoveryJournal(events: readonly DomainEvent[]): DiscoveryJournal {
  monotonicCheck(events);

  const observerEvents = observerScopeFilter(events);
  const locationId = currentLocation(events);

  // Collect evidence from each definition
  const evidenceGroups = DEFINITIONS.map(() => [] as DiscoveryEvidence[]);
  const allEvidence: DiscoveryEvidence[] = [];
  let evidenceIndex = 0;

  for (const event of observerEvents) {
    for (let i = 0; i < DEFINITIONS.length; i++) {
      const ev = DEFINITIONS[i]!.collect(event, locationId);
      if (ev) {
        const indexedEv = deepFreeze({
          ...ev,
          evidenceId: `${DEFINITIONS[i]!.id}:ev:${evidenceIndex}`,
        });
        evidenceGroups[i]!.push(indexedEv);
        allEvidence.push(indexedEv);
        evidenceIndex++;
      }
    }
  }

  const cards: DiscoveryCard[] = [];

  for (let i = 0; i < DEFINITIONS.length; i++) {
    const def = DEFINITIONS[i]!;
    const evidence = evidenceGroups[i]!;

    if (evidence.length === 0) continue;

    const stage = def.classify(evidence);
    if (!stage) continue;

    const rendered = def.render(stage);
    const resolution = def.resolve?.(evidence);
    cards.push(deepFreeze({
      discoveryId: def.id,
      definitionVersion: def.version,
      title: rendered.title,
      question: rendered.question,
      stage,
      summary: rendered.summary,
      firstSeenAt: evidence[0]!.worldTime,
      lastSeenAt: evidence[evidence.length - 1]!.worldTime,
      evidenceCount: evidence.length,
      evidence: deepFreeze(evidence),
      ...(resolution ? { resolution: resolution.resolution, contradictionCount: resolution.contradictionCount } : {}),
    }));
  }

  const sorted = [...allEvidence].sort((a, b) => b.worldTime - a.worldTime);
  const recentEvidence = deepFreeze(sorted.slice(0, 10));

  const rumors: readonly RumorRecord[] = observerEvents
    .filter((event) => event.type === "RumorHeard")
    .map((event) => {
      const p = event.payload as { rumorRef?: string; subjectRef?: string; text?: string; sourceLabel?: string; confidence?: number };
      return deepFreeze({
        ref: p.rumorRef ?? `rumor:${event.eventId}`,
        subjectRef: p.subjectRef ?? "unknown",
        text: p.text ?? "Ты услышал неподтверждённый слух.",
        sourceLabel: p.sourceLabel ?? "неизвестный источник",
        confidence: typeof p.confidence === "number" ? p.confidence : 0.2,
        status: "unverified" as const,
        evidenceRefs: deepFreeze([]),
        source: "social",
        sourceEventIds: deepFreeze([event.eventId]),
        observerId: "player",
        observedAt: event.timestamp,
      });
    });
  const biographyChains = buildBiographyChains(allEvidence);

  return deepFreeze({
    cards: deepFreeze(cards),
    recentEvidence,
    rumors: deepFreeze(rumors),
    biographyChains,
    worldTime: events.length > 0 ? events[events.length - 1]!.timestamp : 0,
  });
}
