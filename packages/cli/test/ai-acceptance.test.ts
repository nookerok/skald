import { describe, expect, it } from "vitest";
import { decideAiAcceptance, formatAiAcceptance } from "../deploy/ai-acceptance.js";

function body(status: unknown, playable: unknown): unknown {
  return { ok: false, readiness: { status, checkedAt: "2026-09-12T00:00:00.000Z", durationMs: 1, configFingerprint: "x", routes: { interpret: [], narrate: [] } }, playable };
}

describe("ai-acceptance gate", () => {
  it("accepts ready and playable", () => {
    expect(decideAiAcceptance(body("ready", true))).toEqual({ accepted: true, status: "ready", playable: true });
  });

  it("accepts degraded and playable", () => {
    const decision = decideAiAcceptance(body("degraded", true));
    expect(decision.accepted).toBe(true);
    expect(formatAiAcceptance(decision)).toContain("degraded but playable");
  });

  it("rejects degraded without a playable route (dead interpret)", () => {
    const decision = decideAiAcceptance(body("degraded", false));
    expect(decision).toEqual({ accepted: false, status: "degraded", playable: false });
    expect(formatAiAcceptance(decision)).toContain("not playable");
  });

  it("rejects unavailable and misconfigured even when playable is claimed", () => {
    for (const status of ["unavailable", "misconfigured"]) {
      const decision = decideAiAcceptance(body(status, true));
      expect(decision.accepted).toBe(false);
      expect(formatAiAcceptance(decision)).toContain(`status: ${status}`);
    }
  });

  it("rejects a missing playable field", () => {
    const full = body("ready", true) as { readiness: unknown };
    expect(decideAiAcceptance({ readiness: full.readiness }).accepted).toBe(false);
  });

  it("rejects empty, garbage and wrong-shaped bodies fail-closed", () => {
    for (const bad of ["", "not json", "{}", "[]", "null", "42", { ok: true }, { readiness: null }, { readiness: { status: 42, playable: "yes" } }]) {
      const decision = decideAiAcceptance(typeof bad === "string" && bad.startsWith("{") ? JSON.parse(bad) : bad);
      expect(decision.accepted).toBe(false);
      expect(decision.status).toBe("unknown");
      expect(decision.playable).toBe(false);
    }
  });

  it("ignores HTTP framing: a 503 body with degraded+playable still accepts", () => {
    // The endpoint answers 503 for degraded; the gate decides on the body.
    expect(decideAiAcceptance(body("degraded", true)).accepted).toBe(true);
  });

  it("never throws on hostile input", () => {
    const evil = JSON.parse('{"readiness":{"status":"ready","playable":true,"__proto__":{"polluted":1}}}');
    expect(() => decideAiAcceptance(evil)).not.toThrow();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
