import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

let server: Awaited<ReturnType<typeof startServer>> | null = null;
const dbDir = mkdtempSync(join(tmpdir(), "skald-server-test-"));

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${server!.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: res.status, body: await res.json() as any };
}

describe("HTTP Server", () => {
  beforeAll(async () => {
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: join(dbDir, "events.sqlite"),
    });
  }, 10000);

  afterAll(async () => {
    if (server) await server.close();
  });

  it("GET / returns HTML", async () => {
    const res = await fetch(`${server!.url}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
  });

  it("GET /api/state returns world state", async () => {
    const { status, body } = await api("/api/state");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state.player).toBeDefined();
  });

  it("POST /api/command with move north succeeds", async () => {
    const { status, body } = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input: "move north", idempotencyKey: "test-cmd-1" }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.position).toEqual({ x: 0, y: 1 });
  });

  it("POST /api/command missing key returns 400", async () => {
    const { status } = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input: "move north" }),
    });
    expect(status).toBe(400);
  });

  it("duplicate idempotencyKey returns 409", async () => {
    const { status } = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input: "move north", idempotencyKey: "test-cmd-dup" }),
    });
    expect(status).toBe(200);
    const { status: status2 } = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input: "move north", idempotencyKey: "test-cmd-dup" }),
    });
    expect(status2).toBe(409);
  });

  it("POST /api/wait with valid count succeeds", async () => {
    const { status, body } = await api("/api/wait", {
      method: "POST",
      body: JSON.stringify({ count: 1, idempotencyKey: "test-wait-1" }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("GET /api/health returns health info", async () => {
    const { status, body } = await api("/api/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.persistence).toBe("sqlite");
  });

  it("GET /api/narrative returns narrative entries", async () => {
    const { status, body } = await api("/api/narrative");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("GET /api/events returns paginated events", async () => {
    const { status, body } = await api("/api/events?limit=5&offset=0");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("404 for unknown routes", async () => {
    const { status } = await api("/api/unknown");
    expect(status).toBe(404);
  });

  it("unknown method returns 405", async () => {
    const { status } = await api("/api/state", { method: "POST" });
    expect(status).toBe(405);
  });

  it("invalid JSON body returns 400", async () => {
    const res = await fetch(`${server!.url}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});
