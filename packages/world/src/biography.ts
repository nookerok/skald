import type { DomainEvent } from "@skald/event-bus";

export interface BiographyNode {
  readonly event: DomainEvent;
  readonly children: BiographyNode[];
}

export interface BiographyGraph {
  readonly roots: BiographyNode[];
  readonly byEventId: ReadonlyMap<string, BiographyNode>;
  readonly correlationId: string | null;
}

export interface CausalChainStep {
  readonly event: DomainEvent;
  readonly depth: number;
}

export function buildBiographyGraph(
  events: readonly DomainEvent[],
  opts?: { correlationId: string } | undefined,
): BiographyGraph {
  const filtered = opts?.correlationId !== undefined
    ? events.filter((e) => e.correlationId === opts!.correlationId)
    : events;

  const byEventId = new Map<string, BiographyNode>();
  const nodeMap = new Map<string, { event: DomainEvent; children: string[] }>();

  for (const event of filtered) {
    nodeMap.set(event.eventId, { event, children: [] });
  }

  const rootIds: string[] = [];

  for (const event of filtered) {
    if (event.causationId !== null && nodeMap.has(event.causationId)) {
      const parentData = nodeMap.get(event.causationId)!;
      parentData.children.push(event.eventId);
    } else {
      rootIds.push(event.eventId);
    }
  }

  function buildNode(eventId: string): BiographyNode {
    const data = nodeMap.get(eventId)!;
    const children: BiographyNode[] = data.children
      .map((childId) => buildNode(childId))
      .sort((a, b) => {
        const tsDiff = a.event.timestamp - b.event.timestamp;
        if (tsDiff !== 0) return tsDiff;
        return filtered.indexOf(a.event) - filtered.indexOf(b.event);
      });
    const node: BiographyNode = { event: data.event, children };
    byEventId.set(eventId, node);
    return node;
  }

  const rootNodes = rootIds
    .map((id) => buildNode(id))
    .sort((a, b) => {
      const tsDiff = a.event.timestamp - b.event.timestamp;
      if (tsDiff !== 0) return tsDiff;
      return filtered.indexOf(a.event) - filtered.indexOf(b.event);
    });

  return {
    roots: rootNodes,
    byEventId,
    correlationId: opts?.correlationId ?? null,
  };
}

export function findCausalChain(
  eventId: string,
  events: readonly DomainEvent[],
): CausalChainStep[] {
  const byId = new Map<string, DomainEvent>();
  for (const e of events) byId.set(e.eventId, e);

  const step = byId.get(eventId);
  if (!step) return [];

  const chain: CausalChainStep[] = [{ event: step, depth: 0 }];
  let currentId = step.causationId;
  let depth = 0;
  const seen = new Set<string>([eventId]);

  while (currentId !== null && currentId !== undefined) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const ancestor = byId.get(currentId);
    if (!ancestor) break;

    depth++;
    chain.push({ event: ancestor, depth });
    currentId = ancestor.causationId;
  }

  return chain;
}

export function findDescendants(
  eventId: string,
  events: readonly DomainEvent[],
): DomainEvent[] {
  const byId = new Map<string, DomainEvent>();
  const children = new Map<string, string[]>();

  for (const e of events) {
    byId.set(e.eventId, e);
    if (e.causationId !== null) {
      const list = children.get(e.causationId) ?? [];
      list.push(e.eventId);
      children.set(e.causationId, list);
    }
  }

  if (!byId.has(eventId)) return [];

  const result: DomainEvent[] = [];
  const queue = [eventId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const childIds = children.get(currentId);
    if (!childIds) continue;

    const sorted = childIds
      .map((id) => ({ id, event: byId.get(id)! }))
      .sort((a, b) => {
        const tsDiff = a.event.timestamp - b.event.timestamp;
        if (tsDiff !== 0) return tsDiff;
        return events.indexOf(a.event) - events.indexOf(b.event);
      });

    for (const { id, event } of sorted) {
      result.push(event);
      queue.push(id);
    }
  }

  return result;
}

export function findCrossReference(
  payloadField: string,
  sourceValue: unknown,
  events: readonly DomainEvent[],
): DomainEvent[] {
  const result: DomainEvent[] = [];
  for (const e of events) {
    if (
      e.payload !== null &&
      e.payload !== undefined &&
      typeof e.payload === "object" &&
      !Array.isArray(e.payload) &&
      payloadField in (e.payload as Record<string, unknown>)
    ) {
      const val = (e.payload as Record<string, unknown>)[payloadField];
      if (val === sourceValue) {
        result.push(e);
      }
    }
  }
  return result;
}
