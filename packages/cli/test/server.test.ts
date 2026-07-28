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

  it("GET /ui-state.js serves the pending-state browser module", async () => {
    const res = await fetch(`${server!.url}/ui-state.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("export function setControlsBusy");
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

  it("GET /api/journal pagination: limit and hasMore", async () => {
    // Create several turns via wait commands
    await api("/api/command", { method: "POST", body: JSON.stringify({ input: "wait", idempotencyKey: "page-test-w1" }) });
    await api("/api/command", { method: "POST", body: JSON.stringify({ input: "wait", idempotencyKey: "page-test-w2" }) });
    await api("/api/command", { method: "POST", body: JSON.stringify({ input: "wait", idempotencyKey: "page-test-w3" }) });

    const { body } = await api("/api/journal?limit=2");
    expect(body.ok).toBe(true);
    expect(body.turns.length).toBe(2);
    expect(body.hasMore).toBe(true);
    expect(body.nextBefore).toBeGreaterThan(0);

    // Second page
    const { body: body2 } = await api("/api/journal?limit=10&before=" + body.nextBefore);
    expect(body2.ok).toBe(true);
    expect(body2.turns.length).toBeGreaterThan(0);
    expect(body2.turns.every((t: any) => t.worldTime < body.nextBefore)).toBe(true);
  });

  it("GET /api/journal exact limit boundary: hasMore=false, nextBefore=null", async () => {
    const { body: all } = await api("/api/journal?limit=50");
    expect(all.ok).toBe(true);
    const total = all.turns.length;
    // Ensure at least 1 turn exists
    expect(total).toBeGreaterThan(0);
    // Request exactly total — should return all, hasMore=false
    const { body } = await api("/api/journal?limit=" + total);
    expect(body.ok).toBe(true);
    expect(body.turns.length).toBe(total);
    expect(body.hasMore).toBe(false);
    expect(body.nextBefore).toBeNull();
  });

  it("GET /api/journal with invalid before returns 400", async () => {
    const { status } = await api("/api/journal?before=10abc");
    expect(status).toBe(400);
  });

  it("POST /api/journal returns 405", async () => {
    const { status } = await api("/api/journal", { method: "POST" });
    expect(status).toBe(405);
  });

  it("404 for unknown routes", async () => {
    const { status } = await api("/api/unknown");
    expect(status).toBe(404);
  });

  it("unknown method returns 405", async () => {
    const { status } = await api("/api/state", { method: "POST" });
    expect(status).toBe(405);
  });

  it("GET /api/journal returns turns after commands", async () => {
    const { body } = await api("/api/journal");
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.turns)).toBe(true);
    expect(Array.isArray(body.threads)).toBe(true);
  });

  it("GET /api/journal with limit returns correct count", async () => {
    const { body } = await api("/api/journal?limit=1");
    expect(body.ok).toBe(true);
    expect(body.turns.length).toBeLessThanOrEqual(1);
  });

  it("GET /client-state.js serves the pure state machine module", async () => {
    const res = await fetch(`${server!.url}/client-state.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    const text = await res.text();
    expect(text).toContain("export const APP");
    expect(text).toContain("export function transition");
  });

  it("GET /status-view.js serves the status renderer module", async () => {
    const res = await fetch(`${server!.url}/status-view.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("export function renderStatus");
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
