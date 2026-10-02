import { describe, expect, it } from "vitest";
import { INTERACTION_VERBS, INTENT_CAPABILITIES } from "@skald/intent-parser";
import {
  interactionRegistry,
  INTERACTION_REGISTRY_PENDING_VERBS,
} from "../src/interaction-registry.js";

describe("canonical interaction catalog", () => {
  it("keeps the type source, manifest, and registry aligned", () => {
    expect(INTENT_CAPABILITIES.interactionVerbs).toBe(INTERACTION_VERBS);

    const pending = new Set<string>(INTERACTION_REGISTRY_PENDING_VERBS);
    const expectedRegistry = INTERACTION_VERBS.filter((verb) => !pending.has(verb)).sort();
    expect([...interactionRegistry.keys()].sort()).toEqual(expectedRegistry);
  });

  it("makes the temporary apply_force exception expire visibly", () => {
    expect(INTERACTION_REGISTRY_PENDING_VERBS).toEqual(["apply_force"]);
    for (const verb of INTERACTION_REGISTRY_PENDING_VERBS) {
      expect(
        interactionRegistry.has(verb),
        `remove ${verb} from INTERACTION_REGISTRY_PENDING_VERBS when its registry slice lands`,
      ).toBe(false);
    }
  });
});
