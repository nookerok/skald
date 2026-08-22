import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

const dbPath = join(mkdtempSync(join(tmpdir(), "skald-conversation-http-")), "events.sqlite");
let server: Awaited<ReturnType<typeof startServer>>;
let worldId: string;

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  return { status: response.status, body: await response.json() as any };
}

describe("ConversationTurn HTTP integration", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const created = await api("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "conversation-create" },
      body: JSON.stringify({ characterName: "Зоя", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
    });
    expect(created.status).toBe(201);
    worldId = created.body.world.worldId;
  }, 10000);

  afterAll(async () => { await server.close(); });

  it("stores an action turn atomically and returns it in command and journal DTOs", async () => {
    const response = await api(`/api/worlds/${worldId}/command`, {
      method: "POST", body: JSON.stringify({ input: "move north", idempotencyKey: "conversation-action-1" }),
    });
    expect(response.status).toBe(200);
    expect(response.body.conversationTurn).toMatchObject({ playerText: "move north", inputClass: "action" });
    expect(response.body.conversationTurn.createdAt).toEqual(expect.any(Number));

    const events = await api(`/api/worlds/${worldId}/events?limit=500`);
    expect(JSON.stringify(events.body)).not.toContain("move north");
    const journal = await api(`/api/worlds/${worldId}/journal?limit=50`);
    expect(journal.body.conversationTurns).toHaveLength(1);
    expect(journal.body.conversationTurns[0]).not.toHaveProperty("requestHash");
  });

  it("persists inquiry and clarification without changing world time", async () => {
    const before = await api(`/api/worlds/${worldId}/state`);
    const inquiry = await api(`/api/worlds/${worldId}/command`, {
      method: "POST", body: JSON.stringify({ input: "где я?", idempotencyKey: "conversation-inquiry-1" }),
    });
    expect(inquiry.status).toBe(200);
    expect(inquiry.body.conversationTurn).toMatchObject({ inputClass: "inquiry", responseKind: "inquiry_answer", playerText: "где я?" });

    const clarification = await api(`/api/worlds/${worldId}/command`, {
      method: "POST", body: JSON.stringify({ input: "сделай совершенно непонятное действие", idempotencyKey: "conversation-clarification-1" }),
    });
    expect(clarification.status).toBe(200);
    expect(clarification.body.status).toBe("clarification");
    expect(clarification.body.conversationTurn).toMatchObject({ inputClass: "clarification", responseKind: "clarification" });

    const after = await api(`/api/worlds/${worldId}/state`);
    expect(after.body.state.worldTime).toBe(before.body.state.worldTime);
    const journal = await api(`/api/worlds/${worldId}/journal?limit=50`);
    expect(journal.body.conversationTurns.map((turn: any) => turn.idempotencyKey)).toEqual([
      "conversation-action-1", "conversation-inquiry-1", "conversation-clarification-1",
    ]);
  });

  it("replays a duplicate action without adding a second conversation turn", async () => {
    const duplicate = await api(`/api/worlds/${worldId}/command`, {
      method: "POST", body: JSON.stringify({ input: "move north", idempotencyKey: "conversation-action-1" }),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.conversationTurn.playerText).toBe("move north");
    const conflict = await api(`/api/worlds/${worldId}/command`, {
      method: "POST", body: JSON.stringify({ input: "move south", idempotencyKey: "conversation-action-1" }),
    });
    expect(conflict.status).toBe(409);
    const journal = await api(`/api/worlds/${worldId}/journal?limit=50`);
    expect(journal.body.conversationTurns.filter((turn: any) => turn.idempotencyKey === "conversation-action-1")).toHaveLength(1);
  });
});
