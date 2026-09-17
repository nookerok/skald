import { describe, expect, it } from "vitest";
import {
  GENERIC_FALLBACK_TEXTS,
  classifyStructuralReason,
  conflictingActions,
  isGenericFallbackText,
  missingReferent,
  multipleReferents,
  multipleThings,
  unclearDestination,
  unclearPrimaryAction,
  unknownObservedTarget,
  unsafeCombination,
} from "@skald/intent-parser";

describe("clarification taxonomy (plan_9 §2)", () => {
  it("names entities or actions in every classified generator", () => {
    const outputs = [
      multipleReferents(["Перевозчик", "Архивист"], true),
      multipleReferents(["Ограда", "Двор"], false),
      multipleThings(["Ограда", "Двор"]),
      missingReferent({ kind: "person", mention: "Перевозчик" }),
      missingReferent({ kind: "either" }),
      unclearPrimaryAction({ surface: "Ограда", speak: false }),
      unclearPrimaryAction({ surface: "Ограда", speak: true }),
      unclearDestination(),
      conflictingActions(["осмотреть двор", "идти к реке"]),
      unsafeCombination("ждать"),
      unknownObservedTarget("башня"),
    ];
    for (const output of outputs) {
      expect(output.reason).toMatch(/^(missing_referent|multiple_referents|unclear_primary_action|unclear_destination|conflicting_actions|unsafe_combination|unknown_observed_target)$/);
      expect(isGenericFallbackText(output.question)).toBe(false);
      expect(output.options.length).toBeGreaterThan(0);
    }
    expect(multipleReferents(["А", "Б"], true).question).toContain("А");
    expect(unknownObservedTarget("башня").question).toContain("башня");
    expect(conflictingActions(["осмотреть двор", "идти к реке"]).options.map((o) => o.label))
      .toEqual(["осмотреть двор", "идти к реке"]);
  });

  it("carries the executable text on conflicting-action options (review P1)", () => {
    const options = conflictingActions(["осмотреть двор", "идти к реке"]).options;
    expect(options.map((o) => o.optionId)).toEqual(["deterministic-1", "deterministic-2"]);
    expect(options.map((o) => o.intentPatch)).toEqual([
      { actionText: "осмотреть двор" },
      { actionText: "идти к реке" },
    ]);
  });

  it("detects every known last-resort wording", () => {
    expect(GENERIC_FALLBACK_TEXTS.length).toBeGreaterThan(0);
    for (const text of GENERIC_FALLBACK_TEXTS) {
      expect(isGenericFallbackText(text)).toBe(true);
      expect(isGenericFallbackText(text.toUpperCase().replace(/ё/gu, "е"))).toBe(true);
    }
    expect(isGenericFallbackText("К кому именно — А или Б?")).toBe(false);
    expect(isGenericFallbackText("Что именно ты хочешь сделать?")).toBe(false);
  });

  it("maps every structural reason onto the taxonomy", () => {
    expect(classifyStructuralReason("missing_target")).toBe("missing_referent");
    expect(classifyStructuralReason("missing_target", true)).toBe("unclear_destination");
    expect(classifyStructuralReason("malformed_target")).toBe("missing_referent");
    expect(classifyStructuralReason("multiple_actions")).toBe("conflicting_actions");
    expect(classifyStructuralReason("unexpected_target")).toBe("unsafe_combination");
    expect(classifyStructuralReason("unsupported_structure")).toBe("unclear_primary_action");
  });
});
