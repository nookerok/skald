import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

describe("living region HTTP boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "skald-region-http-"));
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath: join(directory, "events.sqlite") });
    const response = await fetch(`${server.url}/api/worlds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worldId: "region-map", idempotencyKey: "region-create-1", saveLabel: "Регион", characterName: "Искатель", characterPresetId: "wanderer", worldTemplateId: "living_region" }),
    });
    expect(response.status).toBe(201);
  });

  afterAll(async () => {
    await server.close();
  });

  it("serves an observer-scoped map for the installed region", async () => {
    const response = await fetch(`${server.url}/api/worlds/region-map/map`);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.map.region.name).toBe("Бассейн Речного Стража");
    expect(body.map.locations).toHaveLength(1);
    expect(body.map.routes).toHaveLength(2);
    expect(body.map.landmarks[0].xMetres).toBeNull();
    expect(JSON.stringify(body.map)).not.toContain("tiles");
    expect(JSON.stringify(body.map)).not.toContain("suspended_monolith");
  });

  it("does not expose the map through a mutating method", async () => {
    const response = await fetch(`${server.url}/api/worlds/region-map/map`, { method: "POST" });
    expect(response.status).toBe(405);
  });
});
