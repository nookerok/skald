import { describe, expect, it } from "vitest";
import { buildBackgroundNarrativeContext, buildBootstrapEvents, WorldProjector } from "@skald/world";

describe("background narrative context", () => {
  it("derives observer-safe facts from events without promoting testimony", () => {
    const events = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    });
    const projector = new WorldProjector();
    for (const event of events) projector.apply(event);
    const context = buildBackgroundNarrativeContext(events, projector.getSnapshot(), { background_id: "keeper" });
    expect(context?.title).toBe("Последний ученик сгоревшего архива");
    expect(context?.testimony.join(" ")).toContain("исчезла запись");
    expect(context?.accessibleItems).toContain("Письменные принадлежности архивиста");
    expect(context?.relations.join(" ")).toContain("contact:riverwatch-archivist");
    expect(context?.establishedFacts.join(" ")).not.toContain("исчезла запись");
  });

  it("does not create context for a legacy profile", () => {
    const projector = new WorldProjector();
    const context = buildBackgroundNarrativeContext([], projector.getSnapshot(), { background_id: null });
    expect(context).toBeNull();
  });
});
