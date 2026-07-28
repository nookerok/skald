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
});
