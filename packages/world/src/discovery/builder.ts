import type { DomainEvent } from "@skald/event-bus";
import type { DiscoveryCard, DiscoveryEvidence, DiscoveryJournal } from "./types.js";
import { DEFINITIONS, collectRiskDrawsAttention } from "./definitions.js";

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

export function buildDiscoveryJournal(events: readonly DomainEvent[]): DiscoveryJournal {
  monotonicCheck(events);

  const collectorFns = [collectRiskDrawsAttention];
  // Collect evidence for each collector into separate arrays
  const evidenceGroups = collectorFns.map(() => [] as DiscoveryEvidence[]);
  const allEvidence: DiscoveryEvidence[] = [];
  let evidenceIndex = 0;

  for (const event of events) {
    for (let i = 0; i < collectorFns.length; i++) {
      const ev = collectorFns[i]!(event, evidenceIndex);
      if (ev) {
        evidenceGroups[i]!.push(ev);
        allEvidence.push(ev);
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
    // Evidence is already sorted by log order (monotonic)
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
    }));
  }

  // Recent evidence: last 10 across all discoveries, sorted by worldTime desc
  const sorted = [...allEvidence].sort((a, b) => b.worldTime - a.worldTime);
  const recentEvidence = deepFreeze(sorted.slice(0, 10));

  return deepFreeze({
    cards: deepFreeze(cards),
    recentEvidence,
    worldTime: events.length > 0 ? events[events.length - 1]!.timestamp : 0,
  });
}
