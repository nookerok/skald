import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer, type StartedServer } from "../src/http-server.js";

let server: StartedServer | null = null;

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${server!.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return { status: response.status, body: await response.json() as any };
}

describe("primary world routing", () => {
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it("routes continue and unscoped state to the compiled Pilot Region", async () => {
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: join(mkdtempSync(join(tmpdir(), "skald-primary-http-")), "events.sqlite"),
    });
    const created = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: "riverwatch-main",
        idempotencyKey: "create-riverwatch-main",
        saveLabel: "Бассейн Речного Стража",
        characterName: "Вася",
        characterPresetId: "wanderer",
        worldTemplateId: "living_region",
      }),
    });
    expect(created.status).toBe(201);
    server.app.store.recordWorldSuccession({ fromWorldId: "legacy-world", toWorldId: "riverwatch-main", reason: "test" });
    server.app.store.setPrimaryWorld("riverwatch-main");

    const continued = await api("/api/continue");
    expect(continued.status).toBe(200);
    expect(continued.body).toEqual({ worldId: "riverwatch-main", source: "primary" });

    const map = await api("/api/worlds/riverwatch-main/map");
    expect(map.status).toBe(200);
    expect(map.body.map.region.name).toBe("Бассейн Речного Стража");
    expect(map.body.map.observer.locationRef).toBeTruthy();

    const old = await api("/api/worlds/legacy-world/state");
    expect(old.status).toBe(410);
    expect(old.body.error).toEqual(expect.objectContaining({ code: "world_superseded", replacementWorldId: "riverwatch-main" }));
  });
});
