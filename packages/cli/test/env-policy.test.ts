import { describe, expect, it } from "vitest";
import { decideEnvPolicy, parseEnvFile } from "../deploy/env-policy.js";

describe("env containment policy", () => {
  it("accepts a clean production env", () => {
    expect(decideEnvPolicy("SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_BIN=/home/nooker/.opencode/bin/opencode\n"))
      .toEqual({ accepted: true, reason: "Containment env policy holds." });
  });

  it("accepts a disabled transport regardless of other keys", () => {
    expect(decideEnvPolicy("SKALD_OPENCODE_RUN=0\nSKALD_OPENCODE_ISOLATE_HOME=0\nSKALD_OPENCODE_AGENT_MANIFEST=\n").accepted).toBe(true);
    expect(decideEnvPolicy("").accepted).toBe(true);
  });

  it("rejects ISOLATE_HOME=0 while the transport is enabled", () => {
    const decision = decideEnvPolicy("SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_ISOLATE_HOME=0\n");
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toContain("ISOLATE_HOME=0");
  });

  it("rejects a manifest override while the transport is enabled", () => {
    const decision = decideEnvPolicy("SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_AGENT_MANIFEST=/tmp/evil.md\n");
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toContain("MANIFEST");
  });

  it("honors quoted values exactly like the runtime does", () => {
    expect(decideEnvPolicy('SKALD_OPENCODE_RUN="1"\nSKALD_OPENCODE_ISOLATE_HOME="0"\n').accepted).toBe(false);
    expect(decideEnvPolicy("SKALD_OPENCODE_RUN='1'\n").accepted).toBe(true);
    expect(decideEnvPolicy('SKALD_OPENCODE_RUN="1"\n').accepted).toBe(true);
  });

  it("tolerates whitespace around assignments and trailing comments", () => {
    expect(decideEnvPolicy("  SKALD_OPENCODE_RUN = 1  \n").accepted).toBe(true);
    expect(decideEnvPolicy("SKALD_OPENCODE_RUN=1 # production narrate backup\n").accepted).toBe(true);
  });

  it("ignores commented lines", () => {
    const text = "SKALD_OPENCODE_RUN=1\n# SKALD_OPENCODE_ISOLATE_HOME=0\n;SKALD_OPENCODE_AGENT_MANIFEST=/tmp/evil.md\n";
    expect(decideEnvPolicy(text).accepted).toBe(true);
  });

  it("rejects duplicate keys even with identical values", () => {
    expect(decideEnvPolicy("SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_RUN=1\n").accepted).toBe(false);
    expect(decideEnvPolicy("SKALD_AI_REQUIRED=1\nSKALD_AI_REQUIRED=1\n").accepted).toBe(false);
  });

  it("rejects malformed lines without leaking values", () => {
    for (const text of [
      "SKALD_OPENCODE_RUN=1\n1BAD=x\n",
      'SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_ISOLATE_HOME="0\n',
      "SKALD_OPENCODE_RUN=1\nSECRET_KEY=super-secret-value\nBAD KEY=x\n",
    ]) {
      const decision = decideEnvPolicy(text);
      expect(decision.accepted).toBe(false);
      expect(decision.reason).not.toContain("super-secret-value");
    }
  });

  it("keeps inline comments inside bare values like systemd does", () => {
    // systemd does not strip trailing comments: the value (and therefore
    // the transport) differs from what a shell reader would assume. Both
    // gate and runtime see the same text, so no bypass either way.
    const parsed = parseEnvFile("SKALD_OPENCODE_RUN=1 # prod\n");
    expect(parsed.vars.get("SKALD_OPENCODE_RUN")).toBe("1 # prod");
    expect(decideEnvPolicy("SKALD_OPENCODE_RUN=1 # prod\n").accepted).toBe(true);
  });

  it("never throws on hostile input", () => {
    expect(() => decideEnvPolicy("\0\uFEFFSKALD_OPENCODE_RUN=1\r\n")).not.toThrow();
  });
});
