import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Behavioral coverage for the containment-policy gate in
// install/update-orange-pi.sh: the same grep lines, executed for real
// against fixture env files. deploy-policy.test.ts pins that both scripts
// carry these exact lines. Skipped where bash is unavailable.
const GATE_SCRIPT = [
  'F="$1"',
  'if grep -q -E \'^[[:space:]]*SKALD_OPENCODE_RUN[[:space:]]*=[[:space:]]*1([[:space:]]*(#.*)?)?$\' "$F" 2>/dev/null; then',
  '  if grep -q -E \'^[[:space:]]*SKALD_OPENCODE_ISOLATE_HOME[[:space:]]*=[[:space:]]*0([[:space:]]*(#.*)?)?$\' "$F" 2>/dev/null; then echo REJECT-ISOLATION; exit 11; fi',
  '  if grep -q -E \'^[[:space:]]*SKALD_OPENCODE_AGENT_MANIFEST[[:space:]]*=[[:space:]]*[^[:space:]#]\' "$F" 2>/dev/null; then echo REJECT-MANIFEST; exit 12; fi',
  'fi',
  'echo PASS',
].join("\n");

function runGate(envText: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "skald-env-gate-"));
    const file = join(dir, "skald.env");
    try {
      writeFileSync(file, envText, "utf8");
    } catch (error) {
      reject(error);
      return;
    }
    // Cleanup happens inside the callback: removing the fixture earlier
    // would let every case pass vacuously on a missing file.
    execFile("bash", ["-c", GATE_SCRIPT, "bash", file], (error, stdout) => {
      const code = error && typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : 0;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort; the OS reaps temp dirs eventually.
      }
      resolve({ stdout: String(stdout).trim(), code });
    });
  });
}

describe.skipIf(process.platform === "win32")("production containment env gate", () => {
  it("passes a clean production env", async () => {
    await expect(runGate("SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_BIN=/home/nooker/.opencode/bin/opencode\n"))
      .resolves.toEqual({ stdout: "PASS", code: 0 });
  });

  it("rejects ISOLATE_HOME=0 while the transport is enabled", async () => {
    await expect(runGate("SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_ISOLATE_HOME=0\n"))
      .resolves.toEqual({ stdout: "REJECT-ISOLATION", code: 11 });
  });

  it("rejects a manifest override while the transport is enabled", async () => {
    await expect(runGate('SKALD_OPENCODE_RUN=1\nSKALD_OPENCODE_AGENT_MANIFEST=/tmp/evil.md\n'))
      .resolves.toEqual({ stdout: "REJECT-MANIFEST", code: 12 });
  });

  it("ignores commented lines and tolerates trailing comments", async () => {
    await expect(runGate("SKALD_OPENCODE_RUN=1 # production narrate backup\n# SKALD_OPENCODE_ISOLATE_HOME=0\n#SKALD_OPENCODE_AGENT_MANIFEST=/tmp/evil.md\n"))
      .resolves.toEqual({ stdout: "PASS", code: 0 });
  });

  it("skips both checks when the transport is off", async () => {
    await expect(runGate("SKALD_OPENCODE_RUN=0\nSKALD_OPENCODE_ISOLATE_HOME=0\nSKALD_OPENCODE_AGENT_MANIFEST=\n"))
      .resolves.toEqual({ stdout: "PASS", code: 0 });
  });
});
