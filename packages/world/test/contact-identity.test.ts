/**
 * Contact identity (contact-identity T1).
 *
 * One canonical ferryman: the crossing entrypoint and the `wanderer` background
 * reference the SAME contact, so the hero is never given two people with one
 * name. A background that genuinely has its own contact still adds it, and no
 * relation is doubled.
 */

import { describe, expect, it } from "vitest";
import { buildBootstrapEvents } from "@skald/world";

function contacts(backgroundId: string | undefined) {
  const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId });
  const placed = events
    .filter((event) => event.type === "ObjectPlaced" && String((event.payload as { entityId?: unknown }).entityId ?? "").startsWith("contact:"))
    .map((event) => (event.payload as { entityId: string }).entityId);
  const relations = events
    .filter((event) => event.type === "RelationChanged")
    .map((event) => {
      const payload = event.payload as { from: string; to: string; kind: string };
      return `${payload.from}->${payload.to}:${payload.kind}`;
    });
  return { placed, relations };
}

describe("contact identity", () => {
  it("places exactly one ferryman for every starting background", () => {
    for (const backgroundId of [undefined, "wanderer", "keeper", "echo"]) {
      const { placed } = contacts(backgroundId);
      expect(placed.filter((id) => id === "contact:waystation-keeper")).toHaveLength(1);
      expect(placed).not.toContain("contact:waystation-ferryman");
    }
  });

  it("does not double the acquaintance relation for the wanderer", () => {
    const { relations } = contacts("wanderer");
    expect(relations.filter((relation) => relation === "player->contact:waystation-keeper:knows")).toHaveLength(1);
  });

  it("keeps a genuinely different background contact", () => {
    expect(contacts("keeper").placed).toContain("contact:riverwatch-archivist");
    expect(contacts("echo").placed).toContain("contact:night-ferryman");
    expect(new Set(contacts("keeper").placed).size).toBe(contacts("keeper").placed.length);
  });
});
