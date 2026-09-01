import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { rebuildProjection } from "../src/projection.js";
import { buildBeliefModel, serializeBeliefModel, evidenceSourceEventIds } from "../src/observation/builder.js";
import { getRegionBackgroundBinding } from "../src/region/compiler.js";
import { authoredKnowledgeText } from "../src/game-shell/knowledge-copy.js";
import { buildPlayerKnowledgePresentation } from "../src/game-shell/knowledge-view.js";

function event(type: string, eventId: string, timestamp: number, payload: Record<string, unknown>): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "knowledge-" + timestamp, causationId: null };
}

describe("PlayerKnowledgePresentation", () => {
  it("retains approved testimony and procedural knowledge without promoting them to sight", () => {
    const events = getRegionBackgroundBinding("riverwatch-basin", "keeper")!.bootstrapEvents;
    const world = rebuildProjection(events).getSnapshot();
    const model = buildBeliefModel(events, world);
    const dto = buildPlayerKnowledgePresentation(events, world, model);
    const testimony = events.find((entry) => entry.type === "TestimonyReceived")!;
    const knowledge = events.find((entry) => entry.type === "KnowledgeAcquired")!;
    expect(authoredKnowledgeText(testimony)).toContain("Перед пожаром из архива исчезла запись");
    expect(dto.entries).toContainEqual(expect.objectContaining({
      category: "told", text: (testimony.payload as any).proposition,
    }));
    expect(dto.entries).toContainEqual(expect.objectContaining({
      category: "inferred", text: (knowledge.payload as any).proposition,
    }));
    expect(dto.entries.filter((entry) => entry.category === "seen").map((entry) => entry.text))
      .not.toContain((testimony.payload as any).proposition);
    const poisoned = { ...testimony, payload: { ...(testimony.payload as object), proposition: "event:secret item:unknown The hidden truth" } };
    expect(authoredKnowledgeText(poisoned)).toBeNull();
    const foreign = { ...testimony, payload: { ...(testimony.payload as object), observerId: "npc" } };
    const hidden = buildPlayerKnowledgePresentation([foreign], world, buildBeliefModel([foreign], world));
    expect(hidden.entries).toEqual([]);
  });

  it("resolves discovery hypotheses through provenance, including serialized-model callers", () => {
    const events = [event("ObservationUpdated", "risk-source", 1, { key: "risk_taken", delta: 1 })];
    const world = rebuildProjection(events).getSnapshot();
    const model = buildBeliefModel(events, world);
    const evidence = model.beliefs.get("discovery:risk_draws_attention")!.supportingEvidence[0]!;
    expect(evidenceSourceEventIds(evidence)).toEqual(["risk-source"]);
    expect(Object.isFrozen(evidenceSourceEventIds(evidence))).toBe(true);
    const result = buildPlayerKnowledgePresentation(events, world, model);
    expect(result.entries).toContainEqual(expect.objectContaining({ category: "inferred", text: evidence.description }));
    expect(buildPlayerKnowledgePresentation(events, world, serializeBeliefModel(model))).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("risk-source");
  });

  it("classifies visible evidence without exposing internal or English text", () => {
    const events = [
      event("EntityExamined", "seen-1", 1, { entityId: "stone", description: "Камень покрыт свежими трещинами." }),
      event("EntityExamined", "seen-id", 1, { entityId: "obj-42", description: "obj-42" }),
      event("TestimonyReceived", "told-1", 2, { observerId: "player", claimId: "river-sign", proposition: "The river remembers." }),
      event("ObservationUpdated", "inferred-1", 3, { key: "risk_taken", delta: 1 }),
    ];
    const world = rebuildProjection(events).getSnapshot();
    const dto = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world));
    expect(dto.schemaVersion).toBe(1);
    expect(dto.entries.some((entry) => entry.category === "seen" && entry.text.includes("Камень"))).toBe(true);
    expect(dto.entries.some((entry) => entry.category === "told")).toBe(true);
    expect(dto.entries.some((entry) => entry.category === "inferred")).toBe(true);
    const values = dto.entries.map((entry) => entry.text + " " + entry.origin).join(" ");
    expect(values).not.toMatch(/[A-Za-z]{4,}/);
    expect(values).not.toMatch(/event|claim|river-sign/i);
    expect(values).not.toContain("obj-42");
  });

  it("does not promote bootstrap knowledge to seen and ignores foreign evidence", () => {
    const events = [
      event("KnowledgeAcquired", "seed-1", 0, { subjectId: "player", knowledgeId: "background:keeper", proposition: "The hidden archive is real.", provenance: "background" }),
      event("EntityExamined", "foreign-1", 1, { observerId: "npc", entityId: "secret", description: "Чужое наблюдение." }),
    ];
    const world = rebuildProjection(events).getSnapshot();
    const dto = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world));
    expect(dto.entries.some((entry) => entry.category === "seen")).toBe(false);
    expect(dto.entries.some((entry) => entry.category === "inferred")).toBe(true);
    expect(dto.entries.some((entry) => entry.text.includes("Чужое"))).toBe(false);
  });

  it("never echoes raw propositions into player knowledge", () => {
    const propositions = [
      "Старое русло скрывает следы древней дороги.",
      "Свидетель утверждает, что вода помнит прежнее русло.",
      "Новая находка подтверждает это старое свидетельство.",
    ];
    const events = [
      event("KnowledgeAcquired", "raw-knowledge", 1, { subjectId: "player", knowledgeId: "background:keeper", proposition: propositions[0] }),
      event("TestimonyReceived", "raw-testimony", 2, { observerId: "player", claimId: "river-sign", proposition: propositions[1] }),
      event("EpistemicEvidenceRecorded", "raw-evidence", 3, { observerId: "player", claimId: "river-sign", relation: "supports", proposition: propositions[2] }),
    ];
    const world = rebuildProjection(events).getSnapshot();
    const dto = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world));
    const text = dto.entries.map((entry) => entry.text).join(" ");
    expect(propositions.every((proposition) => !text.includes(proposition))).toBe(true);
    expect(text).toContain("Тебе передали свидетельство, которое ещё нужно проверить.");
    expect(text).toContain("Ты заметил связь между несколькими признаками.");
  });

  it("is frozen, deterministic and applies the startup limit", () => {
    const events = Array.from({ length: 5 }, (_, index) => event("EntityExamined", "seen-" + index, index, { entityId: "object-" + index, description: "Наблюдение " + index }));
    const world = rebuildProjection(events).getSnapshot();
    const model = buildBeliefModel(events, world);
    const first = buildPlayerKnowledgePresentation(events, world, model, { startup: true, maxEntries: 3 });
    const second = buildPlayerKnowledgePresentation(structuredClone(events), rebuildProjection(structuredClone(events)).getSnapshot(), model, { startup: true, maxEntries: 3 });
    expect(first.entries).toHaveLength(3);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.entries)).toBe(true);
  });
});
