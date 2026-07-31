import { describe, expect, it } from "vitest";
import { createObservationPipeline, createObservationStage, type ObservationStage, type ObservationStageInput } from "@skald/observation";

const input: ObservationStageInput = {
  targetId: "pattern:ridge",
  observerId: "player",
  lens: "terrain",
  context: { time: 1 },
  facts: {},
};

describe("Observation Engine skeleton", () => {
  it("creates an independent pass-through stage", () => {
    expect(createObservationStage("weather").run(input)).toEqual({ status: "continue", facts: {} });
  });

  it("uses the canonical configurable stage order", () => {
    expect(createObservationPipeline().stages.map((stage) => stage.id)).toEqual([
      "can-perceive", "distance", "occlusion", "weather", "prior-knowledge", "culture",
    ]);
  });

  it("composes independent stage facts", () => {
    const stages: ObservationStage[] = ["can-perceive", "distance"].map((id) => ({
      id: id as ObservationStage["id"],
      run: (value) => ({ status: "continue", facts: { ...value.facts, [id]: true } }),
    }));
    const result = createObservationPipeline(stages).run(input);
    expect(result.status).toBe("complete");
    expect(result.input.facts).toEqual({ "can-perceive": true, distance: true });
  });

  it("stops at an explicitly blocked stage", () => {
    const result = createObservationPipeline([{
      id: "occlusion",
      run: () => ({ status: "blocked", facts: {}, reason: "not visible" }),
    }]).run(input);
    expect(result.status).toBe("blocked");
    expect(result.blockedBy).toBe("occlusion");
    expect(result.reason).toBe("not visible");
  });
});
