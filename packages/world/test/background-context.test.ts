import { describe, expect, it } from "vitest";
import { buildBackgroundNarrativeContext, buildNarrativeAdapterContext, buildBootstrapEvents, getRegionEntrypoint, WorldProjector } from "@skald/world";

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

  it("builds a frozen Stage 5 context without promoting testimony or leaking ids", () => {
    const events = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    });
    const projector = new WorldProjector();
    for (const event of events) projector.apply(event);
    const context = buildNarrativeAdapterContext(events, projector.getSnapshot(), {
      profile: { background_id: "keeper" },
      characterName: "Виктор",
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
      openingWindow: true,
    });
    expect(context).not.toBeNull();
    expect(context?.character.name).toBe("Виктор");
    expect(context?.arrival.reason).toContain("исчезла запись");
    expect(context?.accessibleItems.some((item) => item.text.includes("Письменные принадлежности"))).toBe(true);
    expect(context?.knowledge.testimony.every((item) => item.epistemicClass === "testimony")).toBe(true);
    expect(context?.contacts.some((item) => item.text.includes("Архивист Речного Стража"))).toBe(true);
    const factText = JSON.stringify([
      ...(context?.visibleSituation.facts ?? []),
      ...(context?.visibleSituation.sensoryContext ?? []),
      ...(context?.contacts ?? []),
      ...(context?.accessibleItems ?? []),
    ].map((item) => item.text));
    expect(factText).not.toContain("contact:riverwatch-archivist");
    expect(factText).not.toContain("eventId");
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context?.accessibleItems)).toBe(true);
  });

  it("excludes an item that is not physically carried", () => {
    const events = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    }).filter((event) => event.type !== "ItemMoved" && event.type !== "ItemPossessionChanged");
    const projector = new WorldProjector();
    for (const event of events) projector.apply(event);
    const context = buildNarrativeAdapterContext(events, projector.getSnapshot(), {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
    });
    expect(context?.accessibleItems).toHaveLength(0);
  });

  it("is safe for a historical batch prefix and does not see later inventory", () => {
    const full = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    });
    const moveIndex = full.findIndex((event) => event.type === "ItemMoved");
    expect(moveIndex).toBeGreaterThan(0);
    const prefix = full.slice(0, moveIndex);
    const projector = new WorldProjector();
    for (const event of prefix) projector.apply(event);
    const historical = buildNarrativeAdapterContext(prefix, projector.getSnapshot(), {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
    });
    expect(historical?.accessibleItems).toHaveLength(0);
    expect(historical?.knowledge.testimony.length).toBeLessThanOrEqual(1);
  });

  it("does not promote another observer's hypothesis or region-wide weather", () => {
    const events = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    });
    const otherObserverEvidence = {
      eventId: "evidence-other-observer",
      type: "EpistemicEvidenceRecorded",
      timestamp: 1,
      correlationId: "test",
      causationId: null,
      payload: { evidenceId: "evidence-other-observer", observerId: "archivist", proposition: "Дальний пожар." },
    } as any;
    const projector = new WorldProjector();
    for (const event of events) projector.apply(event);
    const context = buildNarrativeAdapterContext([...events, otherObserverEvidence], projector.getSnapshot(), {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
    });
    expect(context?.knowledge.hypotheses.some((item) => item.text === "Дальний пожар.")).toBe(false);
    expect(context?.visibleSituation.sensoryContext.some((item) => item.text.startsWith("Небо:"))).toBe(false);
  });

  it("keeps acquired knowledge observer-scoped instead of treating it as world truth", () => {
    const events = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    });
    const projector = new WorldProjector();
    for (const event of events) projector.apply(event);
    const context = buildNarrativeAdapterContext(events, projector.getSnapshot(), {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
    });
    expect(context?.knowledge.observed.length).toBeGreaterThan(0);
    expect(context?.knowledge.observed.every((item) => item.source === "knowledge")).toBe(true);
    expect(context?.knowledge.observed.every((item) => item.epistemicClass === "observed_fact")).toBe(true);
    expect(context?.knowledge.observed.every((item) => item.text.length > 0)).toBe(true);
  });

  it("does not invent a physical letter or recovered record item", () => {
    const events = buildBootstrapEvents({
      templateId: "living_region",
      regionId: "riverwatch-basin",
      entrypointId: "river_waystation_arrival",
      backgroundId: "keeper",
    });
    const projector = new WorldProjector();
    for (const event of events) projector.apply(event);
    const context = buildNarrativeAdapterContext(events, projector.getSnapshot(), {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
    });
    expect(context?.accessibleItems.some((item) => /письмо|уцелевш.*запис|физическ/i.test(item.text))).toBe(false);
    expect(context?.knowledge.testimony.some((item) => /исчезла запись/i.test(item.text))).toBe(true);
  });
});
