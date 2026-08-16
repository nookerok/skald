import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

let server: Awaited<ReturnType<typeof startServer>>;
const dbPath = join(mkdtempSync(join(tmpdir(), "skald-inquiry-http-")), "events.sqlite");

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return { status: response.status, body: await response.json() as any };
}

describe("read-only inquiry HTTP path", () => {
  let worldId: string;

  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const created = await api("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "inquiry-create" },
      body: JSON.stringify({ characterName: "Зоя", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
    });
    expect(created.status).toBe(201);
    worldId = created.body.world.worldId;
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("answers where-am-I without changing world revision or event log", async () => {
    const before = await api(`/api/worlds/${worldId}/state`);
    const beforeEvents = await api(`/api/worlds/${worldId}/events?limit=500`);
    const response = await api(`/api/worlds/${worldId}/command`, {
      method: "POST",
      body: JSON.stringify({ input: "где я?", idempotencyKey: "inquiry-where-1" }),
    });
    const after = await api(`/api/worlds/${worldId}/state`);
    const afterEvents = await api(`/api/worlds/${worldId}/events?limit=500`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, status: "inquiry", inquiry: { queryId: "current_location" } });
    expect(response.body.inquiry.answer).toContain("Переправа");
    expect(after.body.state).toMatchObject({ worldTime: before.body.state.worldTime, eventNumber: before.body.state.eventNumber, lastActionTick: before.body.state.lastActionTick });
    expect(afterEvents.body.count).toBe(beforeEvents.body.count);
  });
});
