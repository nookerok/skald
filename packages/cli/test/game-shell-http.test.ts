import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

let server: Awaited<ReturnType<typeof startServer>>;
const dbPath = join(mkdtempSync(join(tmpdir(), "skald-shell-http-")), "events.sqlite");

async function api(path: string, opts?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: response.status, body: await response.json() as any };
}

async function createWorld(worldId: string, name: string, preset = "wanderer", template = "old_tower") {
  return api("/api/worlds", {
    method: "POST",
    body: JSON.stringify({
      worldId,
      idempotencyKey: `create-${worldId}`,
      saveLabel: name,
      characterName: name,
      characterPresetId: preset,
      worldTemplateId: template,
    }),
  });
}

function expectAlignedResponse(body: any) {
  expect(body.ok).toBe(true);
  expect(body.shellDelta.revision.worldTime).toBe(body.state.worldTime);
  expect(body.shellDelta.revision.eventNumber).toBe(body.state.eventNumber);
  expect(body.presentation.worldTime).toBe(body.state.worldTime);
  expect(body.guidance.worldTime).toBe(body.state.worldTime);
}

describe("Game Shell HTTP contract", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const created = await createWorld("shell-world", "Ирина");
    expect(created.status).toBe(201);
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("returns the stored character profile from the scoped endpoint", async () => {
    const { status, body } = await api("/api/worlds/shell-world/game-shell");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.snapshot.worldId).toBe("shell-world");
    expect(body.snapshot.character.displayName).toBe("Ирина");
    expect(body.snapshot.schemaVersion).toBe(1);
  });

  it("returns 405 for POST /game-shell", async () => {
    const { status } = await api("/api/worlds/shell-world/game-shell", { method: "POST", body: "{}" });
    expect(status).toBe(405);
  });

  it("includes a revision-aligned shellDelta in every command and wait path", async () => {
    const cases: Array<[string, RequestInit]> = [
      ["/api/worlds/shell-world/command", {
        method: "POST", body: JSON.stringify({ input: "move north", idempotencyKey: "shell-move" }),
      }],
      ["/api/worlds/shell-world/command", {
        method: "POST", body: JSON.stringify({ input: "wait", idempotencyKey: "shell-text-wait" }),
      }],
      ["/api/worlds/shell-world/command", {
        method: "POST", body: JSON.stringify({ input: "advance 2", idempotencyKey: "shell-advance" }),
      }],
      ["/api/worlds/shell-world/wait", {
        method: "POST", body: JSON.stringify({ count: 1, idempotencyKey: "shell-post-wait" }),
      }],
    ];

    for (const [path, options] of cases) {
      const { status, body } = await api(path, options);
      expect(status).toBe(200);
      expectAlignedResponse(body);
    }
  });

  it("keeps Game Shell snapshots isolated between worlds", async () => {
    const created = await createWorld("other-world", "Марк", "keeper", "crossroads");
    expect(created.status).toBe(201);

    const first = await api("/api/worlds/shell-world/game-shell");
    const second = await api("/api/worlds/other-world/game-shell");
    expect(first.body.snapshot.character.displayName).toBe("Ирина");
    expect(second.body.snapshot.character.displayName).toBe("Марк");
    expect(first.body.snapshot.revision.worldTime).toBeGreaterThan(0);
    expect(second.body.snapshot.revision.worldTime).toBe(0);
    expect(first.body.snapshot.world).not.toEqual(second.body.snapshot.world);
  });

  it("rebuilds an identical snapshot after SQLite restart", async () => {
    const before = await api("/api/worlds/shell-world/game-shell");
    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const after = await api("/api/worlds/shell-world/game-shell");

    expect(after.status).toBe(200);
    expect(after.body.snapshot).toEqual(before.body.snapshot);
  });
});