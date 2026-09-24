/**
 * `AllowedNarrativeFacts` contract (ADR-0037 / T2): the closed, bounded set
 * handed to the master, with turn-local refs and no internal ids.
 */

import { describe, expect, it } from "vitest";
import { ALLOWED_NARRATIVE_FACTS_MAX, buildAllowedNarrativeFacts } from "@skald/world";

function fact(id: string, text: string, epistemicClass: string, source: string, usableNow = true) {
  return { id, text, epistemicClass, source, usableNow, sourceEventIds: ["evt-secret"] };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    character: { name: "Зоя", backgroundTitle: "Изгнанник с северной дороги", formerRole: "Бывший дорожный проводник.", rupture: "Дорога домой закрыта.", obligation: "Найти того, кто изменил знак." },
    arrival: { reason: "Ты пришёл по следу неверного знака.", personalHook: "Тебя ждут объяснения.", startingLocation: "river_waystation" },
    visibleSituation: { facts: [fact("situation:flood", "Вода поднялась.", "observed_fact", "observation")], sensoryContext: [] },
    accessibleItems: [],
    contacts: [fact("contact:keeper", "Перевозчик у переправы.", "observed_fact", "observation")],
    knowledge: {
      observed: [],
      testimony: [fact("testimony:north", "Свидетель видел знак на северной дороге.", "testimony", "testimony")],
      hypotheses: [fact("hypothesis:course", "Старое русло могло уйти к развалинам.", "inference", "observation")],
    },
    unresolvedSituation: [],
    ...overrides,
  } as never;
}

describe("AllowedNarrativeFacts", () => {
  it("carries typed facts with turn-local refs and provenance", () => {
    const allowed = buildAllowedNarrativeFacts({ context: context(), question: "почему я здесь?" });
    expect(allowed.question).toBe("почему я здесь?");
    expect(allowed.facts.length).toBeGreaterThanOrEqual(4);
    expect(allowed.facts.map((f) => f.ref)).toEqual(allowed.facts.map((_, i) => `f${i + 1}`));

    const byContent = new Map(allowed.facts.map((f) => [f.content, f]));
    expect(byContent.get("Бывший дорожный проводник.")).toMatchObject({ provenance: "background", assertion: "established", temporal: "now", available: true });
    expect(byContent.get("Перевозчик у переправы.")).toMatchObject({ provenance: "observation", assertion: "observed" });
    expect(byContent.get("Свидетель видел знак на северной дороге.")).toMatchObject({ provenance: "testimony", assertion: "told" });
    expect(byContent.get("Старое русло могло уйти к развалинам.")).toMatchObject({ provenance: "hypothesis", assertion: "inferred" });
  });

  it("never leaks internal ids, event ids or provenance into the set", () => {
    const allowed = buildAllowedNarrativeFacts({ context: context() });
    const dump = JSON.stringify(allowed);
    expect(dump).not.toContain("contact:keeper");
    expect(dump).not.toContain("background:role");
    expect(dump).not.toContain("sourceEventIds");
    expect(dump).not.toContain("evt-secret");
  });

  it("is bounded and marks memory facts", () => {
    const many = Array.from({ length: 40 }, (_, i) => fact(`background:${i}`, `Факт ${i}.`, "established_fact", "background", i % 2 === 0));
    const allowed = buildAllowedNarrativeFacts({ context: context({ knowledge: { observed: many, testimony: [], hypotheses: [] } }) });
    expect(allowed.facts.length).toBeLessThanOrEqual(ALLOWED_NARRATIVE_FACTS_MAX);
    expect(allowed.facts.some((f) => f.temporal === "memory")).toBe(true);
  });

  it("keeps mandatory results, continuations and gaps", () => {
    const allowed = buildAllowedNarrativeFacts({ mandatory: ["путь заблокирован"], continuations: ["спросить перевозчика"], gaps: ["реакция неизвестна"] });
    expect(allowed.mandatory).toEqual(["путь заблокирован"]);
    expect(allowed.continuations).toEqual(["спросить перевозчика"]);
    expect(allowed.gaps).toEqual(["реакция неизвестна"]);
    expect(allowed.facts).toEqual([]);
  });

  it("is frozen and deterministic", () => {
    const a = buildAllowedNarrativeFacts({ context: context() });
    const b = buildAllowedNarrativeFacts({ context: context() });
    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.facts)).toBe(true);
  });
});
