import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createPoisonExitScheduler, startServer } from "../src/http-server.js";
import { EventEmitter } from "node:events";

let server: Awaited<ReturnType<typeof startServer>> | null = null;
const dbDir = mkdtempSync(join(tmpdir(), "skald-server-test-"));

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${server!.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: res.status, body: await res.json() as any };
}

describe("HTTP Server poison lifecycle", () => {
  it("schedules exactly one exit after the response finishes", () => {
    const exit = vi.fn();
    const schedule = vi.fn((callback: () => void) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    const scheduleExit = createPoisonExitScheduler(exit, schedule);
    const response = new EventEmitter() as EventEmitter & { writableFinished: boolean; destroyed: boolean };
    response.writableFinished = false;
    response.destroyed = false;

    scheduleExit(response);
    response.emit("finish");
    response.emit("close");
    scheduleExit(response);

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

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

  it("serves every browser module referenced by the presence entry path", async () => {
    const js = [
      "/known-worlds-view.js",
      "/presence-card-view.js",
      "/presence-entry-state.js",
      "/presence-entry-controller.js",
      "/presence-view.js",
      "/focus-view.js",
    ];
    for (const path of js) {
      const res = await fetch(`${server!.url}${path}`);
      expect(res.status, path).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(50);
    }
    const css = await fetch(`${server!.url}/presence-entry.css`);
    expect(css.status).toBe(200);
    const premiumCss = await fetch(`${server!.url}/skald-aaa.css`);
    expect(premiumCss.status).toBe(200);
    expect(await premiumCss.text()).toContain("#panel-game .latest-response");
  });

  it("serves the whole app.js module graph (no 404 kills the boot)", async () => {
    const publicDir = resolve(import.meta.dirname, "../public");
    const srcCache = new Map<string, string>();
    const readSrc = (name: string): string => {
      const cached = srcCache.get(name);
      if (cached !== undefined) return cached;
      const text = readFileSync(join(publicDir, `${name}.js`), "utf-8");
      srcCache.set(name, text);
      return text;
    };
    const localImports = (name: string): string[] => {
      const matches = [...readSrc(name).matchAll(/from ["']\.\/([A-Za-z0-9_-]+)\.js["']/g)];
      return [...new Set(matches.map((m) => m[1]!))];
    };

    const seen = new Set<string>();
    const queue = ["app"];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of localImports(current)) queue.push(next);
    }

    expect(seen.size).toBeGreaterThan(5);
    for (const name of [...seen].sort()) {
      const res = await fetch(`${server!.url}/${name}.js`);
      expect(res.status, `/${name}.js should be served`).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/javascript");
      expect((await res.text()).length).toBeGreaterThan(50);
    }
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

  it("GET /api/beliefs returns a JSON-safe belief model", async () => {
    const { status, body } = await api("/api/beliefs");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.beliefModel.schemaVersion).toBe(2);
    expect(Array.isArray(body.beliefModel.beliefs)).toBe(true);
    expect(JSON.stringify(body.beliefModel)).not.toMatch(/actual|true|real/i);
  });

  it("POST /api/beliefs returns 405", async () => {
    const { status } = await api("/api/beliefs", { method: "POST" });
    expect(status).toBe(405);
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

  it("GET /api/discoveries returns discovery cards", async () => {
    // Make some moves to collect risk_taken observations
    await api("/api/command", { method: "POST", body: JSON.stringify({ input: "move north", idempotencyKey: "disc-setup-1" }) });
    await api("/api/command", { method: "POST", body: JSON.stringify({ input: "move north", idempotencyKey: "disc-setup-2" }) });

    const { status, body } = await api("/api/discoveries");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.worldTime).toBeGreaterThan(0);
    expect(Array.isArray(body.recentEvidence)).toBe(true);
  });

  it("POST /api/discoveries returns 405", async () => {
    const { status } = await api("/api/discoveries", { method: "POST" });
    expect(status).toBe(405);
  });

  it("GET /api/discoveries on empty world returns cards: []", async () => {
    // Use a fresh server without moves
    const tmpDir2 = mkdtempSync(join(tmpdir(), "skald-disc-empty-"));
    const s2 = await startServer({ host: "127.0.0.1", port: 0, dbPath: join(tmpDir2, "events.sqlite") });
    try {
      const res = await fetch(`${s2.url}/api/discoveries`);
      const body = await res.json() as any;
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.cards).toEqual([]);
      expect(body.recentEvidence).toEqual([]);
      expect(body.worldTime).toBe(0);
    } finally {
      await s2.close();
    }
  });

  it("SQLite restart returns identical DiscoveryJournal", async () => {
    const tmpDir3 = mkdtempSync(join(tmpdir(), "skald-disc-id-"));
    const dbPath = join(tmpDir3, "events.sqlite");
    const s3 = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    // Make moves
    await fetch(`${s3.url}/api/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "move north", idempotencyKey: "disc-id-n1" }) });
    await fetch(`${s3.url}/api/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "move east", idempotencyKey: "disc-id-e2" }) });
    const { body: before } = await (await fetch(`${s3.url}/api/discoveries`)).json() as any;
    await s3.close();

    // Restart
    const s4 = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    try {
      const { body: after } = await (await fetch(`${s4.url}/api/discoveries`)).json() as any;
      expect(after).toEqual(before);
    } finally {
      await s4.close();
    }
  });

  it("GET /discovery-view.js serves the discovery browser module", async () => {
    const res = await fetch(`${server!.url}/discovery-view.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("export async function loadDiscoveries");
  });

  it("GET /api/guidance returns 200 with guidance DTO", async () => {
    const { status, body } = await api("/api/guidance");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.guidance).toBeDefined();
    expect(body.guidance.schemaVersion).toBe(1);
    expect(body.guidance.suggestions).toBeInstanceOf(Array);
    expect(body.guidance.worldTime).toBeGreaterThanOrEqual(0);
  });

  it("POST /api/guidance returns 405", async () => {
    const { status } = await api("/api/guidance", { method: "POST" });
    expect(status).toBe(405);
  });

  it("fresh world returns first_action guidance", async () => {
    const tmpDirG = mkdtempSync(join(tmpdir(), "skald-guid-fresh-"));
    const sFresh = await startServer({ host: "127.0.0.1", port: 0, dbPath: join(tmpDirG, "events.sqlite") });
    try {
      const res = await fetch(`${sFresh.url}/api/guidance`);
      const body = await res.json() as any;
      expect(body.guidance.phase).toBe("first_action");
      expect(body.guidance.mode).toBe("onboarding");
    } finally {
      await sFresh.close();
    }
  });

  it("command response includes inline guidance", async () => {
    const { status, body } = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input: "move north", idempotencyKey: "guidance-cmd-1" }),
    });
    expect(status).toBe(200);
    expect(body.guidance).toBeDefined();
    expect(body.guidance.worldTime).toBe(body.state.worldTime);
  });

  it("wait response includes inline guidance", async () => {
    const { status, body } = await api("/api/wait", {
      method: "POST",
      body: JSON.stringify({ count: 1, idempotencyKey: "guidance-wait-1" }),
    });
    expect(status).toBe(200);
    expect(body.guidance).toBeDefined();
  });

  it("guidance, state and presentation worldTime are consistent", async () => {
    const { body } = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input: "move north", idempotencyKey: "guidance-cons-1" }),
    });
    expect(body.guidance.worldTime).toBe(body.state.worldTime);
    expect(body.presentation.worldTime).toBe(body.state.worldTime);
  });

  it("GET /guidance.css serves the guidance stylesheet", async () => {
    const res = await fetch(`${server!.url}/guidance.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("GET /guidance-view.js serves the guidance browser module", async () => {
    const res = await fetch(`${server!.url}/guidance-view.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("export async function loadGuidance");
  });

  it("SQLite restart returns identical guidance", async () => {
    const tmpDir4 = mkdtempSync(join(tmpdir(), "skald-guid-id-"));
    const dbPath = join(tmpDir4, "events.sqlite");
    const s5 = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    await fetch(`${s5.url}/api/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "move north", idempotencyKey: "guid-restart-1" }) });
    const { body: before } = await (await fetch(`${s5.url}/api/guidance`)).json() as any;
    await s5.close();

    const s6 = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    try {
      const { body: after } = await (await fetch(`${s6.url}/api/guidance`)).json() as any;
      expect(after).toEqual(before);
    } finally {
      await s6.close();
    }
  });

  it("invalid JSON body returns 400", async () => {
    const res = await fetch(`${server!.url}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
  it("serves Visual Shell modules without region artwork", async () => {
    const moduleResponse = await fetch(server!.url + "/living-world-shell.js");
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get("content-type")).toContain("application/javascript");
    expect(await moduleResponse.text()).toContain("renderLivingWorld");
    const cssResponse = await fetch(server!.url + "/living-world.css");
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("content-type")).toContain("text/css");
    const imageResponse = await fetch(server!.url + "/assets/maps/visual-shell-region.webp");
    expect(imageResponse.status).toBe(404);
    const mapResponse = await fetch(server!.url + "/assets/maps/pilot-region-map.png");
    expect(mapResponse.status).toBe(404);
  });

});
