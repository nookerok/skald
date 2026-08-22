import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";
import { createApp, runCommandCycle } from "../src/index.js";

const dbPath = join(mkdtempSync(join(tmpdir(), "skald-listen-http-")), "events.sqlite");
let server: Awaited<ReturnType<typeof startServer>>;

async function api(path: string, opts?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: response.status, body: await response.json() as any };
}

async function createWorld() {
  return api("/api/worlds", {
    method: "POST",
    body: JSON.stringify({
      worldId: "listen-world",
      idempotencyKey: "create-listen-world",
      saveLabel: "Listen world",
      characterName: "Listener",
      characterPresetId: "wanderer",
      worldTemplateId: "old_tower",
    }),
  });
}

async function events() {
  const result = await api("/api/worlds/listen-world/events?limit=200");
  return result.body.events as any[];
}

  it("keeps the legacy composition root listening-compatible", () => {
    const app = createApp();
    const result = runCommandCycle(app, "прислушаться", "legacy-listen-1");
    expect(result).toHaveProperty("events");
    const events = (result as { events: Array<{ type: string }> }).events;
    expect(events.some((event) => event.type === "InteractionRequested")).toBe(true);
    expect(events.some((event) => event.type === "ActionHadNoObservableEffect" || event.type === "SoundObserved")).toBe(true);
  });
describe("listen HTTP and SQLite integration", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const created = await createWorld();
    expect(created.status).toBe(201);
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("executes listen through the production command cycle without raw events", async () => {
    const before = await api("/api/worlds/listen-world/state");
    const response = await api("/api/worlds/listen-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "прислушаться", idempotencyKey: "listen-1" }),
    });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.events).toBeUndefined();
    expect(response.body.tickEvents).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("sourceId");
    expect(JSON.stringify(response.body)).not.toContain("old_brazier");
    expect(JSON.stringify(response.body)).not.toContain("SoundObserved");
    expect(response.body.presentation.response).toEqual(expect.objectContaining({
      kind: "action_outcome",
      text: "Тихо. Слышно только собственное дыхание.",
    }));
    expect(response.body.state.eventNumber).toBeGreaterThan(before.body.state.eventNumber);

    const log = await events();
    expect(log.some((event) => event.type === "InteractionRequested" && (event.payload as any).verb === "listen")).toBe(true);
    expect(log.some((event) => event.type === "ActionHadNoObservableEffect" && (event.payload as any).reason === "silence")).toBe(true);
  });

  it("restarts from SQLite with the listen result intact", async () => {
    const before = await api("/api/worlds/listen-world/state");
    const beforeEvents = await events();
    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const after = await api("/api/worlds/listen-world/state");
    const afterEvents = await events();
    expect(after.body.state).toEqual(before.body.state);
    expect(afterEvents.map((event) => [event.eventId, event.type])).toEqual(beforeEvents.map((event) => [event.eventId, event.type]));
  });
});
