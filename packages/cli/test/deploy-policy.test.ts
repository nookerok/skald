import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("Orange Pi non-interactive restart policy", () => {
  it("grants only the exact Skald restart command", () => {
    const policy = read("packages/cli/deploy/skald-sudoers").trim();

    expect(policy).toContain(
      "nooker ALL=(root) NOPASSWD: /usr/bin/systemctl restart skald.service",
    );
    expect(policy).not.toContain("ALL=(ALL)");
    expect(policy).not.toContain("/bin/sh");
    expect(policy).not.toContain("/bin/bash");
  });

  it("checks restart permission before backup or pull", () => {
    const updater = read("packages/cli/deploy/update-orange-pi.sh");
    const gate = updater.indexOf(
      "sudo -n -l /usr/bin/systemctl restart skald.service",
    );
    const backup = updater.indexOf('BACKUP_FILE="${BACKUP_DIR}');
    const pull = updater.indexOf("git pull --ff-only");

    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(backup);
    expect(gate).toBeLessThan(pull);
    expect(updater).toContain(
      "sudo -n /usr/bin/systemctl restart skald.service",
    );
  });

  it("installer validates and installs the restricted policy", () => {
    const installer = read("packages/cli/deploy/install-orange-pi.sh");

    expect(installer).toContain("packages/cli/deploy/skald-sudoers");
    expect(installer).toContain("/etc/sudoers.d/skald-deploy");
    expect(installer).toContain('/usr/sbin/visudo -cf "${SUDOERS_SOURCE}"');
    expect(installer).toContain('-m 440 "${SUDOERS_SOURCE}"');
  });

  it("accepts ready or degraded AI readiness and fails otherwise", () => {
    const installer = read("packages/cli/deploy/install-orange-pi.sh");
    const updater = read("packages/cli/deploy/update-orange-pi.sh");

    expect(installer).toContain("SKALD_AI_REQUIRED=1");
    for (const script of [installer, updater]) {
      // The endpoint answers HTTP 200 only for `ready`, while `degraded`
      // (one live model, deterministic fallback covers the rest) is the
      // accepted production posture. The verdict is delegated to the tested
      // ai-acceptance helper reading status and playable from the sanitized
      // body; a dead interpret route rejects the deploy even when narrate
      // answers. See ai-acceptance.test.ts for the behavioral matrix.
      expect(script).toContain("packages/cli/deploy/ai-acceptance.ts");
      expect(script).toContain("node --import tsx");
      expect(script).toContain("Deployment acceptance: FAILED");
    }
    expect(updater.indexOf("Deployment acceptance: FAILED")).toBeLessThan(updater.indexOf("Update complete."));
    expect(installer.indexOf("Deployment acceptance: FAILED")).toBeLessThan(installer.indexOf("Installation complete"));
  });

  it("keeps HOME fully read-only: the isolated transport needs no home writes", () => {
    const unit = read("packages/cli/deploy/skald.service");

    expect(unit).toContain("ProtectHome=read-only");
    expect(unit).toContain("ReadWritePaths=/home/nooker/skald-data");
    expect(unit).not.toContain(".local/share/opencode");
    expect(unit).not.toContain(".cache/opencode");
    expect(unit).not.toContain(".local/state/opencode");
    expect(unit).not.toContain(".config/opencode");
  });

  it("installs and verifies the pinned narrative agent manifest", () => {
    const installer = read("packages/cli/deploy/install-orange-pi.sh");
    const updater = read("packages/cli/deploy/update-orange-pi.sh");

    expect(read("packages/cli/deploy/opencode-narrative-agent.md")).toContain("permission:");
    expect(read("packages/cli/deploy/opencode-narrative-agent.md")).toContain("doom_loop: deny");
    for (const script of [installer, updater]) {
      // Fail-closed containment: without a verified tools-denied manifest
      // the transport must stay disabled, so verification failure aborts.
      expect(script).toContain("packages/cli/deploy/opencode-narrative-agent.md");
      expect(script).toContain("sha256sum");
      expect(script).toContain("stat -c %U");
      expect(script).toContain("stat -c %a");
      expect(script).toContain("chmod 600");
    }
    expect(updater.indexOf("agent manifest missing from the deployed tree")).toBeGreaterThan(updater.indexOf("git pull --ff-only"));
    expect(updater.indexOf("agent manifest missing from the deployed tree")).toBeLessThan(updater.indexOf("sudo -n /usr/bin/systemctl restart skald.service"));
    // The manifest installs only after the tree validated, and post-restart
    // failures restore the previously accepted manifest (atomic boundary).
    expect(updater.indexOf("Narrative agent manifest installed and verified")).toBeGreaterThan(updater.indexOf("npm run validate"));
    expect(updater).toContain("restore_agent_manifest");
    expect(updater).toContain("Previous agent manifest restored");
  });

  it("forbids disarming containment through production env", () => {
    const installer = read("packages/cli/deploy/install-orange-pi.sh");
    const updater = read("packages/cli/deploy/update-orange-pi.sh");

    // When the transport is enabled, ISOLATE_HOME=0 and a manifest override
    // must fail the deploy before any mutation. The verdict comes from the
    // tested env-policy helper (quoted values, duplicates, malformed lines);
    // see env-policy.test.ts for the behavioral matrix.
    for (const script of [installer, updater]) {
      expect(script).toContain("packages/cli/deploy/env-policy.ts");
      expect(script).toContain("Containment env policy");
    }
    expect(updater.indexOf("env-policy.ts")).toBeLessThan(updater.indexOf("BACKUP_FILE=\"${BACKUP_DIR}"));
  });

  it("keeps HTTP liveness independent from strict SSH identity preflight", () => {
    const preflight = read("packages/cli/deploy/preflight-orange-pi.sh");

    expect(preflight).toContain('SKALD_HOST="192.168.0.5"');
    expect(preflight).toContain('SKALD_USER="nooker"');
    expect(preflight).toContain('SKALD_SSH_KEY="/home/nook/.ssh/id_ed25519_skald"');
    expect(preflight).toContain('HEALTH_URL="http://${SKALD_HOST}:3000/api/health"');
    expect(preflight).toContain("SSH_PREFLIGHT_COMMAND='hostname; whoami; uname -a; test -d /home/nooker/skald; test -d /home/nooker/skald-data; systemctl is-active skald.service'");
    expect(preflight).toContain("SSH_ATTEMPTS=5");
    expect(preflight).toContain("for attempt in 1 2 3 4 5; do");
    expect(preflight).toContain('"${OBSERVED_UNAME}" != *aarch64*');
    expect(preflight).toContain("HTTP_ALIVE_SSH_IDENTITY_MISMATCH");
    expect(preflight).toContain('test -d /home/nooker/skald');
    expect(preflight).toContain('test -d /home/nooker/skald-data');
    expect(preflight).toContain('systemctl is-active skald.service');
    expect(preflight).toContain("Preflight: BLOCKED");
    expect(preflight).not.toMatch(/git\s+(commit|push)/);
    expect(preflight).not.toContain("update-orange-pi.sh");
    expect(preflight).not.toContain("systemctl restart");
    expect(preflight).not.toMatch(/(^|\n)\s*(git commit|git push|npm run update|systemctl restart|sqlite3 .*migration)/);
  });
});
