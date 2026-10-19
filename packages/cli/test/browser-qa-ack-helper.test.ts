import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const helperPath = path.resolve(
  process.cwd(),
  ".agents/skills/skald-ntfs-browser-qa/scripts/read-result.mjs",
);
const capabilities = [
  "browser",
  "viewport",
  "screenshot",
  "rendered_audit",
  "dom",
  "console",
  "report_dir",
] as const;
type Preflight = Record<(typeof capabilities)[number], "PASS" | "BLOCKED">;

function fullPreflight(overrides: Partial<Preflight> = {}): Preflight {
  return Object.fromEntries(
    capabilities.map((capability) => [capability, overrides[capability] ?? "PASS"]),
  ) as Preflight;
}

function invokeAck(outputRoot: string, jobId: string, preflight?: unknown, acknowledgedBy?: string) {
  const args = [
    helperPath,
    "--mode", "ack",
    "--output-root", outputRoot,
    "--job-id", jobId,
    "--run-token", "browser-qa-ack-test-token-0001",
    "--mutation-limit", "8",
  ];
  if (preflight !== undefined) {
    args.push("--preflight-base64", Buffer.from(JSON.stringify(preflight), "utf8").toString("base64"));
  }
  if (acknowledgedBy !== undefined) args.push("--acknowledged-by", acknowledgedBy);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

async function withOutputRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "skald-qa-ack-test-"));
  try {
    return await run(root);
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep)) {
      throw new Error("refusing to remove a non-temporary test directory");
    }
    await rm(resolved, { recursive: true, force: true });
  }
}

describe("NTFS browser QA ACK preflight contract", () => {
  it("rejects a missing or incomplete capability set before writing ACK", async () => {
    await withOutputRoot(async (root) => {
      const missing = invokeAck(root, "qa-ack-missing");
      expect(missing.status).not.toBe(0);
      await expect(readFile(path.join(root, "qa-ack-missing.ack.json"))).rejects.toMatchObject({ code: "ENOENT" });

      const incomplete = invokeAck(root, "qa-ack-incomplete", { browser: "PASS" });
      expect(incomplete.status).not.toBe(0);
      await expect(readFile(path.join(root, "qa-ack-incomplete.ack.json"))).rejects.toMatchObject({ code: "ENOENT" });

      // The rendered-structure instrument is part of the recorded set: an ACK
      // without it predates the screenshotless mode and must be refused.
      const withoutRenderedAudit = Object.fromEntries(
        capabilities.filter((capability) => capability !== "rendered_audit").map((capability) => [capability, "PASS"]),
      );
      const stale = invokeAck(root, "qa-ack-stale", withoutRenderedAudit);
      expect(stale.status).not.toBe(0);
      await expect(readFile(path.join(root, "qa-ack-stale.ack.json"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("records all seven successful probes and opens the full-scope gate", async () => {
    await withOutputRoot(async (root) => {
      const result = invokeAck(root, "qa-ack-pass", fullPreflight());
      expect(result.status).toBe(0);
      const ack = JSON.parse(await readFile(path.join(root, "qa-ack-pass.ack.json"), "utf8"));
      expect(ack.preflight).toEqual(fullPreflight());
      expect(ack.preflightGate).toBe("proceed");
      expect(ack.blockedCapabilities).toEqual([]);
      expect(ack.mutationLimit).toBe(8);
    });
  });

  it("lets the rendered audit stand in for an unavailable screenshot", async () => {
    await withOutputRoot(async (root) => {
      const preflight = fullPreflight({ screenshot: "BLOCKED" });
      const result = invokeAck(root, "qa-ack-screenshotless", preflight);
      expect(result.status).toBe(0);
      const ack = JSON.parse(await readFile(path.join(root, "qa-ack-screenshotless.ack.json"), "utf8"));
      expect(ack.preflightGate).toBe("proceed");
      expect(ack.blockedCapabilities).toEqual(["screenshot"]);
      expect(ack).not.toHaveProperty("acknowledgedBy");
    });
  });

  it("stops when both visual instruments are unavailable", async () => {
    await withOutputRoot(async (root) => {
      const preflight = fullPreflight({ screenshot: "BLOCKED", rendered_audit: "BLOCKED" });
      const stoppedResult = invokeAck(root, "qa-ack-stop", preflight);
      expect(stoppedResult.status).toBe(0);
      const stopped = JSON.parse(await readFile(path.join(root, "qa-ack-stop.ack.json"), "utf8"));
      expect(stopped.preflightGate).toBe("stop");
      expect(stopped.blockedCapabilities).toEqual(["screenshot", "rendered_audit"]);
      expect(stopped).not.toHaveProperty("acknowledgedBy");

      const reducedResult = invokeAck(root, "qa-ack-reduced", preflight, "QA operator");
      expect(reducedResult.status).toBe(0);
      const reduced = JSON.parse(await readFile(path.join(root, "qa-ack-reduced.ack.json"), "utf8"));
      expect(reduced.preflightGate).toBe("proceed_reduced");
      expect(reduced.acknowledgedBy).toBe("QA operator");
      expect(reduced.blockedCapabilities).toEqual(["screenshot", "rendered_audit"]);
      expect(reduced.reducedScope.missing).toEqual(["screenshot", "rendered_audit"]);
      expect(reduced.reducedScope.acknowledgedBy).toBe("QA operator");
    });
  });

  it("stops on a blocked required capability unless an operator accepts reduced scope", async () => {
    await withOutputRoot(async (root) => {
      const preflight = fullPreflight({ console: "BLOCKED" });
      const stoppedResult = invokeAck(root, "qa-ack-console-stop", preflight);
      expect(stoppedResult.status).toBe(0);
      const stopped = JSON.parse(await readFile(path.join(root, "qa-ack-console-stop.ack.json"), "utf8"));
      expect(stopped.preflightGate).toBe("stop");
      expect(stopped.blockedCapabilities).toEqual(["console"]);

      const reducedResult = invokeAck(root, "qa-ack-console-reduced", preflight, "QA operator");
      expect(reducedResult.status).toBe(0);
      const reduced = JSON.parse(await readFile(path.join(root, "qa-ack-console-reduced.ack.json"), "utf8"));
      expect(reduced.preflightGate).toBe("proceed_reduced");
      expect(reduced.reducedScope.missing).toEqual(["console"]);
    });
  });

  it("rejects unknown status values rather than treating them as a pass", async () => {
    await withOutputRoot(async (root) => {
      const invalid = fullPreflight({ console: "pass" as "PASS" });
      const result = invokeAck(root, "qa-ack-invalid", invalid);
      expect(result.status).not.toBe(0);
      await expect(readFile(path.join(root, "qa-ack-invalid.ack.json"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
