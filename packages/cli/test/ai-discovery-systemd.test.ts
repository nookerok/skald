import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("daily AI discovery systemd contract", () => {
  it("runs one persistent daily timer at 04:00 Europe/Moscow", () => {
    const timer = source("../deploy/skald-ai-discovery.timer");
    expect(timer).toContain("OnCalendar=*-*-* 04:00:00 Europe/Moscow");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("Unit=skald-ai-discovery.service");
  });

  it("runs the bounded no-world CLI with a private durable output directory", () => {
    const unit = source("../deploy/skald-ai-discovery.service");
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain("User=nooker");
    expect(unit).toContain("run-ai-model-discovery.ts --trigger=daily");
    expect(unit).toContain("TimeoutStartSec=15min");
    expect(unit).not.toContain("RuntimeMaxSec=");
    expect(unit).toContain("ReadWritePaths=/home/nooker/skald-data/ai-discovery");
    expect(unit).not.toContain("SKALD_DB_PATH");
  });

  it("installs and enables the timer only through the operator installer", () => {
    const installer = source("../deploy/install-orange-pi.sh");
    expect(installer).toContain("skald-ai-discovery.service skald-ai-discovery.timer");
    expect(installer).toContain("systemctl enable --now skald-ai-discovery.timer");
    expect(installer).toContain('"$SKALD_DATA/ai-discovery"');
  });

  it("provides a narrow existing-install activation path without restarting the game", () => {
    const installer = source("../deploy/install-ai-discovery.sh");
    expect(installer).toContain('$(id -un)" != "nooker"');
    expect(installer).toContain('git branch --show-current)" != "main"');
    expect(installer).toContain("git status --porcelain");
    expect(installer).toContain("systemctl is-active --quiet skald.service");
    expect(installer).toContain("skald-ai-discovery.service skald-ai-discovery.timer");
    expect(installer).toContain("systemctl enable --now skald-ai-discovery.timer");
    expect(installer).toContain("systemctl is-active skald-ai-discovery.timer");
    expect(installer).toContain("skald.service is not restarted");
    expect(installer).not.toContain("restart skald.service");
    expect(installer).not.toContain("events.sqlite");
  });
});
