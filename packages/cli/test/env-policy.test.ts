import { describe, expect, it } from "vitest";
import { decideEnvPolicy, parseEnvFile } from "../deploy/env-policy.js";

describe("env containment policy", () => {
  it("accepts a clean production env", () => {
    expect(decideEnvPolicy("SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_BIN=/home/nooker/.opencode/bin/opencode\n"))
      .toEqual({ accepted: true, reason: "Containment env policy holds." });
  });

  it("accepts only a fully pinned OpenCode Server primary transport", () => {
    const accepted = decideEnvPolicy([
      "SKALD_OPENCODE_SERVER_ENABLED=1",
      "SKALD_OPENCODE_SERVER_MODEL=opencode/deepseek-v4-flash-free",
      "SKALD_OPENCODE_ZEN_API_KEY=present",
      "SKALD_OPENCODE_SERVER_PORT=4097",
      "SKALD_OPENCODE_SERVER_STATE_DIR=/home/nooker/skald-data/opencode-server",
    ].join("\n"));
    expect(accepted.accepted).toBe(true);
  });

  it("accepts an explicit model fallback and bounded concurrency", () => {
    const accepted = decideEnvPolicy([
      "SKALD_OPENCODE_SERVER_ENABLED=1",
      "SKALD_OPENCODE_SERVER_MODEL=opencode/free-primary",
      "SKALD_OPENCODE_SERVER_FALLBACK_MODEL=opencode/free-backup",
      "SKALD_OPENCODE_SERVER_MAX_CONCURRENCY=3",
      "SKALD_OPENCODE_ZEN_API_KEY=present",
    ].join("\n"));
    expect(accepted.accepted).toBe(true);
  });

  it("permits paid fallback only with a separate explicit opt-in and pin", () => {
    const accepted = decideEnvPolicy([
      "SKALD_OPENCODE_SERVER_ENABLED=1",
      "SKALD_OPENCODE_SERVER_MODEL=opencode/free-primary",
      "SKALD_OPENCODE_SERVER_FALLBACK_MODEL=opencode/paid-backup",
      "SKALD_OPENCODE_SERVER_ALLOW_PAID_FALLBACK=1",
      "SKALD_OPENCODE_ZEN_API_KEY=present",
    ].join("\n"));
    expect(accepted.accepted).toBe(true);
  });

  it("accepts explicit paid primary permission with an exact pin, without requiring fallback", () => {
    const common = [
      "SKALD_OPENCODE_SERVER_ENABLED=1", "SKALD_OPENCODE_SERVER_MODEL=opencode/paid-primary",
      "SKALD_OPENCODE_ZEN_API_KEY=present",
    ];
    expect(decideEnvPolicy([...common, "SKALD_OPENCODE_SERVER_ALLOW_PAID_PRIMARY=1"].join("\n")).accepted).toBe(true);
    for (const value of ["yes", "", "2", "true"]) {
      expect(decideEnvPolicy([...common, `SKALD_OPENCODE_SERVER_ALLOW_PAID_PRIMARY=${value}`].join("\n")).accepted).toBe(false);
    }
    expect(decideEnvPolicy([
      "SKALD_OPENCODE_SERVER_ENABLED=1", "SKALD_OPENCODE_ZEN_API_KEY=present",
      "SKALD_OPENCODE_SERVER_ALLOW_PAID_PRIMARY=1",
    ].join("\n")).accepted).toBe(false);
  });

  it("rejects malformed fallback, unapproved paid fallback and unbounded concurrency", () => {
    const common = [
      "SKALD_OPENCODE_SERVER_ENABLED=1",
      "SKALD_OPENCODE_SERVER_MODEL=opencode/free-primary",
      "SKALD_OPENCODE_ZEN_API_KEY=present",
    ];
    for (const extra of [
      ["SKALD_OPENCODE_SERVER_FALLBACK_MODEL=opencode/free-primary"],
      ["SKALD_OPENCODE_SERVER_FALLBACK_MODEL=not-a-model"],
      ["SKALD_OPENCODE_SERVER_ALLOW_PAID_FALLBACK=1"],
      ["SKALD_OPENCODE_SERVER_ALLOW_PAID_FALLBACK=yes", "SKALD_OPENCODE_SERVER_FALLBACK_MODEL=opencode/paid"],
      ["SKALD_OPENCODE_SERVER_MAX_CONCURRENCY=5"],
      ["SKALD_OPENCODE_SERVER_MAX_CONCURRENCY=1.5"],
    ]) {
      expect(decideEnvPolicy([...common, ...extra].join("\n")).accepted).toBe(false);
    }
  });

  it("fails closed on missing or malformed OpenCode Server primary configuration", () => {
    for (const text of [
      "SKALD_OPENCODE_SERVER_ENABLED=1\nSKALD_OPENCODE_ZEN_API_KEY=present\n",
      "SKALD_OPENCODE_SERVER_ENABLED=1\nSKALD_OPENCODE_SERVER_MODEL=not-a-model\nSKALD_OPENCODE_ZEN_API_KEY=present\n",
      "SKALD_OPENCODE_SERVER_ENABLED=1\nSKALD_OPENCODE_SERVER_MODEL=opencode/model\n",
      "SKALD_OPENCODE_SERVER_ENABLED=1\nSKALD_OPENCODE_SERVER_MODEL=opencode/model\nSKALD_OPENCODE_ZEN_API_KEY=present\nSKALD_OPENCODE_SERVER_PORT=4096\n",
      "SKALD_OPENCODE_SERVER_ENABLED=1\nSKALD_OPENCODE_SERVER_MODEL=opencode/model\nSKALD_OPENCODE_ZEN_API_KEY=present\nSKALD_OPENCODE_SERVER_STATE_DIR=/home/nooker/skald\n",
      "SKALD_OPENCODE_SERVER_ENABLED=yes\n",
    ]) {
      const decision = decideEnvPolicy(text);
      expect(decision.accepted).toBe(false);
      expect(decision.reason).not.toContain("present");
    }
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
