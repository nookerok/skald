import { describe, expect, it } from "vitest";
import { buildBootstrapEvents, eligibleNpcDossierFacts, parseNpcDossier, rebuildProjection, type NpcDossier } from "@skald/world";

describe("NPC dossier event projection", () => {
  it("seeds only deterministic authored public profile facts and restores them by replay", () => {
    const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" });
    const dossiers = events.filter((event) => event.type === "NpcDossierEstablished");
    const placements = new Map(events.filter((event) => event.type === "ObjectPlaced")
      .map((event) => [String((event.payload as { entityId?: unknown }).entityId), event]));

    expect(dossiers.length).toBeGreaterThan(0);
    for (const event of dossiers) {
      const dossier = parseNpcDossier(event.payload);
      expect(dossier).not.toBeNull();
      expect(event.timestamp).toBe(0);
      expect(event.causationId).toBe(placements.get(dossier!.npcId)?.eventId);
      expect(dossier!.voice).toEqual({ styleTags: [], toneDescription: null });
      expect(dossier!.facts.length).toBeGreaterThan(0);
      expect(dossier!.facts.every((fact) => fact.kind === "world_truth"
        && fact.disclosure.minimumFamiliarityTier === "stranger"
        && fact.disclosure.requiredConditions.length === 0)).toBe(true);
    }

    const first = rebuildProjection(events).getSnapshot();
    const replayed = rebuildProjection(events).getSnapshot();
    expect(first.npcDossiers.size).toBe(dossiers.length);
    expect([...first.npcDossiers]).toEqual([...replayed.npcDossiers]);
    expect(first.time).toBe(0);
    expect([...first.npcDossiers.values()].some((dossier) => dossier.facts.some((fact) => /Архивист|Перевозчик|Смотритель/u.test(fact.content.text)))).toBe(false);
  });

  it("fails closed on malformed dossier payloads and duplicate fact ids", () => {
    const dossier: NpcDossier = {
      npcId: "contact:test",
      dossierVersion: 1,
      voice: { styleTags: [], toneDescription: null },
      facts: [{ factId: "f1", kind: "npc_secret", content: { type: "text", text: "secret" }, disclosure: { minimumFamiliarityTier: "trusted", requiredConditions: ["promise_kept"] } }],
    };
    expect(parseNpcDossier(dossier)).not.toBeNull();
    expect(parseNpcDossier({ ...dossier, facts: [...dossier.facts, ...dossier.facts] })).toBeNull();
    expect(parseNpcDossier({ ...dossier, dossierVersion: 0 })).toBeNull();
    expect(parseNpcDossier({ ...dossier, unexpected: "field" })).toBeNull();
    expect(parseNpcDossier({ ...dossier, facts: [{ ...dossier.facts[0], content: { type: "text", text: "contact:hidden" } }] })).toBeNull();
  });

  it("releases facts only after familiarity and all authored conditions pass", () => {
    const dossier = parseNpcDossier({
      npcId: "contact:test",
      dossierVersion: 1,
      voice: { styleTags: [], toneDescription: null },
      facts: [
        { factId: "public", kind: "world_truth", content: { type: "text", text: "public fact" }, disclosure: { minimumFamiliarityTier: "stranger", requiredConditions: [] } },
        { factId: "secret", kind: "npc_secret", content: { type: "text", text: "secret fact" }, disclosure: { minimumFamiliarityTier: "trusted", requiredConditions: ["promise_kept"] } },
      ],
    })!;

    expect(eligibleNpcDossierFacts(dossier, "stranger").map((fact) => fact.factId)).toEqual(["public"]);
    expect(eligibleNpcDossierFacts(dossier, "trusted").map((fact) => fact.factId)).toEqual(["public"]);
    expect(eligibleNpcDossierFacts(dossier, "trusted", ["promise_kept"]).map((fact) => fact.factId)).toEqual(["public", "secret"]);
  });
});
