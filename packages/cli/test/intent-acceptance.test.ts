import { describe, expect, it } from "vitest";
import { decideIntentAcceptance, formatIntentAcceptance } from "../deploy/intent-acceptance.js";

describe("intent-acceptance gate", () => {
  it("accepts an explicit passing contract", () => {
    const decision = decideIntentAcceptance({ ok: true, contract: { pass: true } });
    expect(decision).toEqual({ accepted: true, pass: true });
    expect(formatIntentAcceptance(decision)).toContain("passed");
  });

  it("rejects a failing contract with its reason", () => {
    const decision = decideIntentAcceptance({ ok: false, contract: { pass: false } });
    expect(decision.accepted).toBe(false);
    expect(formatIntentAcceptance(decision)).toContain("cannot carry a turn");
  });

  it("rejects missing, malformed and hostile bodies fail-closed", () => {
    for (const body of [undefined, null, "", "not json", 42, {}, { ok: true }, { contract: null }, { contract: { pass: "yes" } }]) {
      expect(decideIntentAcceptance(body).accepted).toBe(false);
    }
  });

  it("never throws on hostile input", () => {
    const evil = JSON.parse('{"contract":{"pass":true,"__proto__":{"polluted":1}}}');
    expect(() => decideIntentAcceptance(evil)).not.toThrow();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
