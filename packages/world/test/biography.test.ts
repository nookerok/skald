import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  buildBiographyGraph,
  findCausalChain,
  findDescendants,
  findCrossReference,
} from "@skald/world";

function e(
  eventId: string,
  type: string,
  causationId: string | null,
  correlationId: string,
  timestamp: number,
  payload: unknown = {},
): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId, causationId };
}

function serialize(graph: { roots: unknown[] }): string {
  return JSON.stringify(graph.roots, (key, val) =>
    key === "byEventId" ? undefined : val
  );
}

describe("buildBiographyGraph", () => {
  it("empty input returns empty graph", () => {
    const g = buildBiographyGraph([]);
    expect(g.roots).toEqual([]);
    expect(g.byEventId.size).toBe(0);
    expect(g.correlationId).toBeNull();
  });

  it("linear chain a→b→c", () => {
    const a = e("a", "Start", null, "cmd-1", 0);
    const b = e("b", "Middle", "a", "cmd-1", 1);
    const c = e("c", "End", "b", "cmd-1", 2);
    const events = [a, b, c];

    const g = buildBiographyGraph(events);

    expect(g.roots).toHaveLength(1);
    expect(g.roots[0]!.event).toBe(a);
    expect(g.roots[0]!.children).toHaveLength(1);
    expect(g.roots[0]!.children[0]!.event).toBe(b);
    expect(g.roots[0]!.children[0]!.children[0]!.event).toBe(c);
    expect(g.byEventId.size).toBe(3);
  });

  it("forest — two independent roots", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const c = e("c", "C", null, "cmd-2", 0);
    const d = e("d", "D", "c", "cmd-2", 1);
    const events = [a, b, c, d];

    const g = buildBiographyGraph(events);

    expect(g.roots).toHaveLength(2);
    expect(g.roots[0]!.event).toBe(a);
    expect(g.roots[1]!.event).toBe(c);
  });

  it("dangling causationId becomes a root", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "missing", "cmd-1", 1);
    const events = [a, b];

    const g = buildBiographyGraph(events);

    expect(g.roots).toHaveLength(2);
    expect(g.roots.map((r) => r.event.eventId)).toContain("b");
  });

  it("filtering by correlationId", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", null, "tick-1", 0);
    const c = e("c", "C", "a", "cmd-1", 1);
    const events = [a, b, c];

    const g = buildBiographyGraph(events, { correlationId: "cmd-1" });

    expect(g.roots).toHaveLength(1);
    expect(g.roots[0]!.event).toBe(a);
    expect(g.roots[0]!.children).toHaveLength(1);
    expect(g.roots[0]!.children[0]!.event).toBe(c);
    expect(g.correlationId).toBe("cmd-1");
  });

  it("deterministic ordering by timestamp", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 2);
    const c = e("c", "C", "a", "cmd-1", 1);
    const events = [a, b, c];

    const g = buildBiographyGraph(events);

    expect(g.roots[0]!.children).toHaveLength(2);
    expect(g.roots[0]!.children[0]!.event).toBe(c);
    expect(g.roots[0]!.children[1]!.event).toBe(b);
  });

  it("stable order on equal timestamps (by input index)", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const c = e("c", "C", "a", "cmd-1", 1);
    const events = [a, c, b];

    const g = buildBiographyGraph(events);

    expect(g.roots[0]!.children[0]!.event).toBe(c);
    expect(g.roots[0]!.children[1]!.event).toBe(b);
  });

  it("does not mutate input array", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const events: DomainEvent[] = [a, b];
    const beforeLen = events.length;
    const beforeIds = events.map((e) => e.eventId);

    buildBiographyGraph(events);

    expect(events).toHaveLength(beforeLen);
    expect(events.map((e) => e.eventId)).toEqual(beforeIds);
  });

  it("property-style test: idempotent and all chains valid", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const c = e("c", "C", "b", "cmd-1", 2);
    const d = e("d", "D", null, "cmd-2", 0);
    const events = [a, b, c, d];

    const g1 = buildBiographyGraph(events);
    const g2 = buildBiographyGraph(events);

    expect(serialize(g1)).toBe(serialize(g2));

    for (const e of events) {
      if (e.causationId !== null) {
        const node = g1.byEventId.get(e.eventId);
        expect(node).toBeDefined();
        expect(node!.children).toBeDefined();
        const chain = findCausalChain(e.eventId, events);
        expect(chain.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("findCausalChain", () => {
  it("linear chain a→b→c starting from c", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const c = e("c", "C", "b", "cmd-1", 2);
    const events = [a, b, c];

    const chain = findCausalChain("c", events);

    expect(chain).toHaveLength(3);
    expect(chain[0]!.event.eventId).toBe("c");
    expect(chain[0]!.depth).toBe(0);
    expect(chain[1]!.event.eventId).toBe("b");
    expect(chain[1]!.depth).toBe(1);
    expect(chain[2]!.event.eventId).toBe("a");
    expect(chain[2]!.depth).toBe(2);
  });

  it("returns [] for unknown eventId", () => {
    const chain = findCausalChain("unknown", []);
    expect(chain).toEqual([]);
  });

  it("broken chain stops at missing ancestor", () => {
    const a = e("a", "A", "missing", "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const events = [a, b];

    const chain = findCausalChain("b", events);

    expect(chain).toHaveLength(2);
    expect(chain[0]!.event.eventId).toBe("b");
    expect(chain[1]!.event.eventId).toBe("a");
  });

  it("self-loop protection", () => {
    const a = e("a", "A", "a", "cmd-1", 0);
    const events = [a];

    const chain = findCausalChain("a", events);

    expect(chain).toHaveLength(1);
    expect(chain[0]!.event.eventId).toBe("a");
  });

  it("chain starting from root", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const events = [a];

    const chain = findCausalChain("a", events);

    expect(chain).toHaveLength(1);
    expect(chain[0]!.event.eventId).toBe("a");
    expect(chain[0]!.depth).toBe(0);
  });
});

describe("findDescendants", () => {
  it("linear chain a→b→c from a", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const c = e("c", "C", "b", "cmd-1", 2);
    const events = [a, b, c];

    const desc = findDescendants("a", events);

    expect(desc).toHaveLength(2);
    expect(desc[0]!.eventId).toBe("b");
    expect(desc[1]!.eventId).toBe("c");
  });

  it("tree a→b, a→c, c→d from a", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const c = e("c", "C", "a", "cmd-1", 1);
    const d = e("d", "D", "c", "cmd-1", 2);
    const events = [a, b, c, d];

    const desc = findDescendants("a", events);

    expect(desc).toHaveLength(3);
    expect(desc[0]!.eventId).toBe("b");
    expect(desc[1]!.eventId).toBe("c");
    expect(desc[2]!.eventId).toBe("d");
  });

  it("leaf node returns []", () => {
    const a = e("a", "A", null, "cmd-1", 0);
    const b = e("b", "B", "a", "cmd-1", 1);
    const events = [a, b];

    expect(findDescendants("b", events)).toEqual([]);
  });

  it("unknown eventId returns []", () => {
    expect(findDescendants("unknown", [])).toEqual([]);
  });
});

describe("findCrossReference", () => {
  it("finds events by payload field match", () => {
    const cc = e("cc-1", "ConsequenceCreated", null, "cmd-1", 0, { id: "aud@1" });
    const ce = e("ce-1", "ConsequenceExpired", null, "tick-1", 5, { id: "aud@1" });
    const other = e("other", "Other", null, "cmd-2", 0, { id: "other" });
    const events = [cc, ce, other];

    const result = findCrossReference("id", "aud@1", events);

    expect(result).toHaveLength(2);
    expect(result[0]!.eventId).toBe("cc-1");
    expect(result[1]!.eventId).toBe("ce-1");
  });

  it("finds nothing for non-existent value", () => {
    const cc = e("cc-1", "ConsequenceCreated", null, "cmd-1", 0, { id: "aud@1" });
    const events = [cc];

    expect(findCrossReference("id", "missing", events)).toEqual([]);
  });

  it("skips events where payload field does not exist", () => {
    const a = e("a", "A", null, "cmd-1", 0, { id: "x" });
    const b = e("b", "B", null, "cmd-1", 1, { name: "y" });
    const events = [a, b];

    const result = findCrossReference("id", "x", events);
    expect(result).toHaveLength(1);
    expect(result[0]!.eventId).toBe("a");
  });

  it("matches on consequenceId field", () => {
    const cf = e("cf-1", "ConsequenceFired", null, "tick-1", 5, { consequenceId: "aud@1" });
    const events = [cf];

    const result = findCrossReference("consequenceId", "aud@1", events);
    expect(result).toHaveLength(1);
    expect(result[0]!.eventId).toBe("cf-1");
  });
});
