import { describe, expect, it } from "vitest";
import {
  classifyReplicaClauses,
  parseIntent,
  splitReplicaClauses,
} from "@skald/intent-parser";

describe("splitReplicaClauses (plan_9 §1)", () => {
  it("splits the plan flagship into action and question clauses", () => {
    const clauses = splitReplicaClauses(
      "Я осматриваю переправу и хочу понять, куда лучше идти — что подсказывает вода?",
    );
    expect(clauses).toEqual([
      "Я осматриваю переправу",
      "хочу понять, куда лучше идти",
      "что подсказывает вода",
    ]);
  });

  it("strips a conjunction left by a sentence delimiter", () => {
    expect(splitReplicaClauses("где я? и кто рядом?")).toEqual(["где я", "кто рядом"]);
  });

  it("keeps a simple replica as one clause", () => {
    expect(splitReplicaClauses("осмотреться")).toEqual(["осмотреться"]);
  });

  it("does not split a comma-separated question frame", () => {
    expect(splitReplicaClauses("хочу узнать, кто рядом")).toEqual(["хочу узнать, кто рядом"]);
  });
});

describe("classifyReplicaClauses (plan_9 §1)", () => {
  it("separates one action from its questions", () => {
    const clauses = classifyReplicaClauses(
      "Я осматриваю переправу и хочу понять, куда лучше идти — что подсказывает вода?",
      parseIntent,
    );
    expect(clauses.actions).toHaveLength(1);
    expect(clauses.actions[0]!.intent.type).toBe("InteractionCommand");
    expect(clauses.inquiries.map((clause) => clause.inquiry.queryId)).toEqual([
      "available_routes",
      "environmental_indication",
    ]);
    expect(clauses.unknown).toHaveLength(0);
  });

  it("collects two questions with no action", () => {
    const clauses = classifyReplicaClauses("где я? и кто рядом?", parseIntent);
    expect(clauses.actions).toHaveLength(0);
    expect(clauses.inquiries.map((clause) => clause.inquiry.queryId)).toEqual([
      "current_location",
      "who_is_nearby",
    ]);
  });

  it("splits an action joined to a question by a comma", () => {
    const clauses = classifyReplicaClauses("осматриваю двор, что я вижу?", parseIntent);
    expect(clauses.actions).toHaveLength(1);
    expect(clauses.actions[0]!.intent.type).toBe("InteractionCommand");
    expect(clauses.inquiries.map((clause) => clause.inquiry.queryId)).toEqual(["visible_scene"]);
    expect(clauses.unknown).toHaveLength(0);
  });

  it("keeps a want-to-know frame as one inquiry", () => {
    const clauses = classifyReplicaClauses("хочу узнать, кто рядом", parseIntent);
    expect(clauses.actions).toHaveLength(0);
    expect(clauses.inquiries.map((clause) => clause.inquiry.queryId)).toEqual(["who_is_nearby"]);
    expect(clauses.unknown).toHaveLength(0);
  });
});
