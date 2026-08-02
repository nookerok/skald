import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

let server: Awaited<ReturnType<typeof startServer>>;
const dbPath = join(mkdtempSync(join(tmpdir(), "skald-offline-http-")), "events.sqlite");

async function api(path: string, opts?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: response.status, body: await response.json() as any };
}

async function createWorld(worldId: string, template: string) {
  return api("/api/worlds", {
    method: "POST",
    body: JSON.stringify({
      worldId,
      idempotencyKey: `create-${worldId}`,
      saveLabel: worldId,
      characterName: worldId,
      characterPresetId: "wanderer",
      worldTemplateId: template,
    }),
  });
}

async function state(worldId: string) {
  const { body } = await api(`/api/worlds/${worldId}/state`);
  return body.state as { eventNumber: number; worldTime: number };
}

async function offline(worldId: string, body: Record<string, unknown>) {
  return api(`/api/worlds/${worldId}/offline-command`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function command(worldId: string, input: string, idempotencyKey: string) {
  return api(`/api/worlds/${worldId}/command`, {
    method: "POST",
    body: JSON.stringify({ input, idempotencyKey }),
  });
}

describe("Offline intent queue HTTP contract", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const created = await createWorld("offline-world", "old_tower");
    expect(created.status).toBe(201);
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("rejects an invalid envelope with 400", async () => {
    const s = await state("offline-world");
    const missing = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-400-1" });
    expect(missing.status).toBe(400);
    const negative = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-400-2", baseRevision: -1 });
    expect(negative.status).toBe(400);
    const nonInteger = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-400-3", baseRevision: 1.5 });
    expect(nonInteger.status).toBe(400);
    const noKey = await offline("offline-world", { input: "examine cart", baseRevision: s.eventNumber });
    expect(noKey.status).toBe(400);
  });

  it("rejects a base revision ahead of the world", async () => {
    const s = await state("offline-world");
    const r = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-ahead", baseRevision: s.eventNumber + 10 });
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe("rejected");
    expect(r.body.reason).toBe("invalid_envelope");
  });

  it("classifies unsupported intents as rejected", async () => {
    const s = await state("offline-world");
    // Parser fall-through (unknown operation) → understood but outside the slice.
    const unsupported = await offline("offline-world", { input: "qqq zzz xxx", idempotencyKey: "k-unsupported", baseRevision: s.eventNumber });
    expect(unsupported.body.resolution).toBe("rejected");
    expect(unsupported.body.reason).toBe("unsupported_offline_intent");
    expect(unsupported.body.message).toBeTruthy();

    const wait = await offline("offline-world", { input: "wait", idempotencyKey: "k-unsupported-2", baseRevision: s.eventNumber });
    expect(wait.body.resolution).toBe("rejected");
    expect(wait.body.reason).toBe("unsupported_offline_intent");
  });

  it("classifies a missing target as rejected without committing events", async () => {
    const before = await state("offline-world");
    const r = await offline("offline-world", { input: "examine nothing", idempotencyKey: "k-missing", baseRevision: before.eventNumber });
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe("rejected");
    expect(r.body.reason).toBe("no_such_target");
    const after = await state("offline-world");
    expect(after.eventNumber).toBe(before.eventNumber);
  });

  it("accepts a still-valid examine and executes the normal cycle", async () => {
    const before = await state("offline-world");
    const r = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-accept", baseRevision: before.eventNumber });
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe("accepted");
    // Check presentation for EntityExamined outcome instead of raw events.
    expect(r.body.presentation).toBeTruthy();
    const pres = r.body.presentation as any;
    const entries = [pres.primary, ...(pres.notable ?? [])].filter(Boolean);
    const examined = entries.some((p: any) => p.kind === "observation" && p.text.includes("рассматриваешь") && p.text.includes("cart"));
    expect(examined).toBe(true);
    expect(r.body.state.eventNumber).toBeGreaterThan(before.eventNumber);
  });

  it("replays a processed key as already_processed without new events", async () => {
    const before = await state("offline-world");
    const r = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-replay", baseRevision: before.eventNumber });
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe("accepted");
    const afterAccept = await state("offline-world");

    const replay = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-replay", baseRevision: before.eventNumber });
    expect(replay.status).toBe(200);
    expect(replay.body.resolution).toBe("already_processed");
    expect(replay.body.message).toBeTruthy();

    const after = await state("offline-world");
    expect(after.eventNumber).toBe(afterAccept.eventNumber);
  });

  it("stays already_processed across a server restart (durable key)", async () => {
    const before = await state("offline-world");
    const r = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-restart", baseRevision: before.eventNumber });
    expect(r.body.resolution).toBe("accepted");
    const committedEventNumber = r.body.state.eventNumber as number;

    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });

    const after = await state("offline-world");
    const replay = await offline("offline-world", { input: "examine cart", idempotencyKey: "k-restart", baseRevision: before.eventNumber });
    expect(replay.body.resolution).toBe("already_processed");
    expect(after.eventNumber).toBe(committedEventNumber);
  });

  it("classifies a vanished target as conflict and executes nothing", async () => {
    const created = await createWorld("conflict-world", "crossroads");
    expect(created.status).toBe(201);

    const base = await state("conflict-world");
    const m1 = await command("conflict-world", "move north", "mv-1");
    expect(m1.status).toBe(200);
    const m2 = await command("conflict-world", "move north", "mv-2");
    expect(m2.status).toBe(200);

    const r = await offline("conflict-world", { input: "examine cart", idempotencyKey: "k-conflict", baseRevision: base.eventNumber });
    expect(r.status).toBe(200);
    expect(r.body.resolution).toBe("conflict");
    expect(r.body.message).toBe("Ты хотел осмотреть «cart», но теперь это невозможно.");
    expect(r.body.reason).toBeNull();

    const after = await state("conflict-world");
    const afterMovements = (await state("conflict-world")).eventNumber;
    expect(after.eventNumber).toBe(afterMovements);
  });

  it("answers 405 for GET on the offline-command path", async () => {
    const r = await api("/api/worlds/offline-world/offline-command");
    expect(r.status).toBe(405);
  });
});
