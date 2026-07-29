import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

let server: Awaited<ReturnType<typeof startServer>> | null = null;
const dbDir = mkdtempSync(join(tmpdir(), "skald-wc-test-"));

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${server!.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: res.status, body: await res.json() as any };
}

describe("World creation", () => {
  beforeAll(async () => {
    server = await startServer({
      host: "127.0.0.1", port: 0,
      dbPath: join(dbDir, "events.sqlite"),
    });
  }, 10000);

  afterAll(async () => {
    if (server) await server.close();
  });

  const worldId = "test-world-uuid-001";
  const key = "create-key-001";

  it("GET /api/character-presets returns presets", async () => {
    const { status, body } = await api("/api/character-presets");
    expect(status).toBe(200);
    expect(Array.isArray(body.presets)).toBe(true);
    expect(body.presets.length).toBeGreaterThanOrEqual(2);
  });

  it("POST /api/character-presets returns 405", async () => {
    const { status } = await api("/api/character-presets", { method: "POST" });
    expect(status).toBe(405);
  });

  it("GET /api/world-templates returns templates", async () => {
    const { status, body } = await api("/api/world-templates");
    expect(status).toBe(200);
    expect(Array.isArray(body.templates)).toBe(true);
  });

  it("POST /api/world-templates returns 405", async () => {
    const { status } = await api("/api/world-templates", { method: "POST" });
    expect(status).toBe(405);
  });

  it("POST /api/worlds creates a new world", async () => {
    const { status, body } = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId, idempotencyKey: key,
        saveLabel: "Test World",
        characterName: "Hero",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
      }),
    });
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.world.worldId).toBe(worldId);
    expect(body.world.characterName).toBe("Hero");
  });

  it("same key + same body returns existing world (idempotent)", async () => {
    const { status, body } = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId, idempotencyKey: key,
        saveLabel: "Test World",
        characterName: "Hero",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
      }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.created).toBe(false);
  });

  it("same key + different body returns 409", async () => {
    const { status } = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId, idempotencyKey: key,
        saveLabel: "Different",
        characterName: "Hero",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
      }),
    });
    expect(status).toBe(409);
  });

  it("unknown preset returns 400", async () => {
    const { status } = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: "test-bad-1", idempotencyKey: "bad-key-1",
        saveLabel: "Bad", characterName: "X",
        characterPresetId: "nonexistent",
        worldTemplateId: "old_tower",
      }),
    });
    expect(status).toBe(400);
  });

  it("unknown template returns 400", async () => {
    const { status } = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: "test-bad-2", idempotencyKey: "bad-key-2",
        saveLabel: "Bad", characterName: "X",
        characterPresetId: "wanderer",
        worldTemplateId: "nonexistent",
      }),
    });
    expect(status).toBe(400);
  });

  it("numeric saveLabel returns 400 (not 500)", async () => {
    const { status } = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: "test-bad-3", idempotencyKey: "bad-key-3",
        saveLabel: 123, characterName: "X",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
      }),
    });
    expect(status).toBe(400);
  });

  it("numeric characterName returns 400 (not 500)", async () => {
    const { status } = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: "test-bad-4", idempotencyKey: "bad-key-4",
        saveLabel: "Ok", characterName: 456,
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
      }),
    });
    expect(status).toBe(400);
  });

  it("created world is accessible via scoped state API", async () => {
    const { status, body } = await api(`/api/worlds/${worldId}/state`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state.player).toBeDefined();
    expect(body.state.worldTime).toBe(0);
  });

  it("created world is listed in /api/worlds", async () => {
    const { body } = await api("/api/worlds");
    const found = body.worlds.find((w: any) => w.worldId === worldId);
    expect(found).toBeDefined();
    expect(found.characterName).toBe("Hero");
    expect(found.status).toBe("active");
  });

  it("second world is fully isolated", async () => {
    const wid2 = "test-world-uuid-002";
    await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: wid2, idempotencyKey: "create-key-002",
        saveLabel: "World 2", characterName: "Mage",
        characterPresetId: "keeper",
        worldTemplateId: "crossroads",
      }),
    });

    // Both worlds should be distinct (walls differ by template)
    const s1 = await api(`/api/worlds/${worldId}/state`);
    const s2 = await api(`/api/worlds/${wid2}/state`);
    expect(s1.body.state.walls).not.toEqual(s2.body.state.walls);
  });

  it("SQLite restart preserves created world", async () => {
    const stateBefore = await api(`/api/worlds/${worldId}/state`);
    await server!.close();

    const s2 = await startServer({ host: "127.0.0.1", port: 0, dbPath: join(dbDir, "events.sqlite") });
    try {
      server = s2 as any;
      const stateAfter = await api(`/api/worlds/${worldId}/state`);
      expect(stateAfter.body.state).toEqual(stateBefore.body.state);
    } finally {}
  });

  it("failed creation does not leave orphaned profile/world/events", async () => {
    // Try creating a world with nonexistent preset — should fail atomically
    await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: "orphan-test-001", idempotencyKey: "orphan-key-001",
        saveLabel: "Orphan", characterName: "Ghost",
        characterPresetId: "nonexistent",
        worldTemplateId: "old_tower",
      }),
    });

    // Verify the world doesn't appear in the catalog
    const { body } = await api("/api/worlds");
    const orphan = body.worlds.find((w: any) => w.worldId === "orphan-test-001");
    expect(orphan).toBeUndefined();

    // Verify no scoped state exists
    const stateRes = await api("/api/worlds/orphan-test-001/state");
    expect(stateRes.status).toBe(404);
  });
});
