import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { startServer } from "../src/http-server.js";

const nodeRequire = createRequire(import.meta.url);

let server: Awaited<ReturnType<typeof startServer>>;
const dbPath = join(mkdtempSync(join(tmpdir(), "skald-presence-http-")), "events.sqlite");

async function api(path: string, opts?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: response.status, body: await response.json() as any };
}
async function events(worldId: string) {
  const result = await api(`/api/worlds/${worldId}/events?limit=200`);
  return result.body.events as any[];
}


async function createWorld(worldId: string, name: string) {
  return api("/api/worlds", {
    method: "POST",
    body: JSON.stringify({
      worldId,
      idempotencyKey: `create-${worldId}`,
      saveLabel: name,
      characterName: name,
      characterPresetId: "wanderer",
      worldTemplateId: "old_tower",
    }),
  });
}

async function session() {
  return api("/api/worlds/presence-world/observer-session");
}

async function ack(key: string, worldTime: number, eventNumber: number) {
  return api("/api/worlds/presence-world/presence/acknowledge", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: key, worldTime, eventNumber }),
  });
}

describe("Observer presence HTTP contract", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const created = await createWorld("presence-world", "Ирина");
    expect(created.status).toBe(201);
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("returns a full observer session aligned with world state", async () => {
    const { status, body } = await session();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.session.schemaVersion).toBe(1);
    expect(body.session.checkpoint).toBeNull();
    expect(body.session.presence.schemaVersion).toBe(1);
    expect(body.session.drift.level).toBe("none");
    expect(body.session.revision.worldTime).toBeGreaterThanOrEqual(0);
    expect(body.session.revision.eventNumber).toBeGreaterThan(0);
    expect(body.session.beliefModel.observerId).toBe("player");
  });

  it("never leaks hidden world state into the session", async () => {
    const { body } = await session();
    const text = JSON.stringify(body.session);
    expect(text).not.toContain("eventId");
    expect(text).not.toContain("activeSituations");
    expect(text).not.toContain("consequences");
    expect(text).not.toContain("trueState");
    expect(text).not.toContain("actualState");
  });

  it("returns a lightweight presence read", async () => {
    const { status, body } = await api("/api/worlds/presence-world/presence");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checkpoint).toBeNull();
    expect(body.presence.drift.level).toBe("none");
    expect(body.presence.location.title).toBeTruthy();
  });

  it("returns the known-worlds card summary with ready player-facing texts", async () => {
    const { status, body } = await api("/api/worlds/presence-world/presence");
    expect(status).toBe(200);
    const summary = body.summary;
    expect(summary.schemaVersion).toBe(1);
    expect(summary.worldId).toBe("presence-world");
    expect(summary.checkpointState).toBe("missing");
    expect(summary.lastPresenceWorldTime).toBeNull();
    expect(summary.currentWorldTime).toBeGreaterThanOrEqual(0);
    expect(summary.worldTimeDelta).toBe(0);
    expect(summary.driftLevel).toBe("none");
    expect(summary.presenceStatus).toBe("Ты ещё не входил в этот мир.");
    expect(summary.knowledgeStatus).toBeNull();
    expect(summary.staleBeliefCount).toBe(0);
    expect(summary.dormantThreadCount).toBe(0);
  });

  it("acknowledges a fresh revision and persists the checkpoint", async () => {
    const { body: s } = await session();
    const { status, body } = await ack("ack-1", s.session.revision.worldTime, s.session.revision.eventNumber);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(true);
    expect(body.checkpoint.lastPresenceWorldTime).toBe(s.session.revision.worldTime);

    const after = await session();
    expect(after.body.session.checkpoint).not.toBeNull();
    expect(after.body.session.checkpoint.beliefRevision).toBe(body.checkpoint.beliefRevision);
  });

  it("card summary reflects a valid acknowledged presence", async () => {
    const { body: s } = await session();
    const ackRes = await ack("card-ack", s.session.revision.worldTime, s.session.revision.eventNumber);
    expect(ackRes.status).toBe(200);

    const { body } = await api("/api/worlds/presence-world/presence");
    const summary = body.summary;
    expect(summary.checkpointState).toBe("valid");
    expect(summary.lastPresenceWorldTime).toBe(s.session.revision.worldTime);
    expect(summary.worldTimeDelta).toBe(0);
    expect(summary.driftLevel).toBe("none");
    expect(summary.presenceStatus).toBe("Мир кажется таким, каким ты его помнишь.");
    expect(summary.knowledgeStatus).toBeNull();
  });

  it("duplicate acknowledge key replays the original response", async () => {
    const { body: s } = await session();
    const first = await ack("ack-dup", s.session.revision.worldTime, s.session.revision.eventNumber);
    const second = await ack("ack-dup", s.session.revision.worldTime, s.session.revision.eventNumber);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("rejects a stale revision with 409 stale_revision", async () => {
    const { body: s } = await session();
    const { worldTime, eventNumber } = s.session.revision;
    const stale = eventNumber > 0
      ? { worldTime, eventNumber: eventNumber - 1 }
      : { worldTime: worldTime + 1, eventNumber };
    const { status, body } = await ack("ack-stale", stale.worldTime, stale.eventNumber);
    expect(status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("stale_revision");
  });

  it("requires an idempotency key", async () => {
    const { body: s } = await session();
    const { status, body } = await api("/api/worlds/presence-world/presence/acknowledge", {
      method: "POST",
      body: JSON.stringify({ worldTime: s.session.revision.worldTime, eventNumber: s.session.revision.eventNumber }),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("missing_idempotency_key");
  });

  it("acknowledge retry reproduces the original response even after the world moved", async () => {
    // Move the world first so the acknowledge is a genuine checkpoint change.
    await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "wait", idempotencyKey: "retry-move-0" }),
    });
    const { body: s } = await session();
    const first = await ack("ack-retry", s.session.revision.worldTime, s.session.revision.eventNumber);
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);

    await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "wait", idempotencyKey: "retry-move-1" }),
    });

    // The body is now stale, but the same key+hash replays the original answer.
    const retry = await ack("ack-retry", s.session.revision.worldTime, s.session.revision.eventNumber);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
  });

  it("same acknowledge key with a different body conflicts even when stale", async () => {
    const { body: s } = await session();
    const first = await ack("ack-conflict", s.session.revision.worldTime, s.session.revision.eventNumber);
    expect(first.status).toBe(200);
    const { status, body } = await ack("ack-conflict", s.session.revision.worldTime, s.session.revision.eventNumber - 1);
    expect(status).toBe(409);
    expect(body.error.code).toBe("duplicate_request");
  });

  it("wait ticks are present ticks and advance N ticks are offline", async () => {
    const w = await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "wait", idempotencyKey: "pres-wait-present" }),
    });
    expect(w.status).toBe(200);
    // Query events via diagnostics endpoint instead of command response.
    const evWait = await events("presence-world");
    const waitTicks = evWait.filter((e: any) => e.type === "TickPassed" && e.correlationId === `tick-${w.body.state.worldTime}`);
    expect(waitTicks.length).toBe(1);
    expect(waitTicks[0].payload.playerOffline).toBeUndefined();

    const a = await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "advance 2", idempotencyKey: "pres-advance-offline" }),
    });
    expect(a.status).toBe(200);
    const evAdv = await events("presence-world");
    const advTicks = evAdv.filter((e: any) => e.type === "TickPassed" && e.payload.playerOffline === true && e.timestamp > w.body.state.worldTime);
    expect(advTicks.length).toBe(2);
    for (const tick of advTicks) expect(tick.payload.playerOffline).toBe(true);

    const p = await api("/api/worlds/presence-world/wait", {
      method: "POST",
      body: JSON.stringify({ count: 1, idempotencyKey: "pres-wait-endpoint" }),
    });
    expect(p.status).toBe(200);
    const evPost = await events("presence-world");
    const postTicks = evPost.filter((e: any) => e.type === "TickPassed" && e.correlationId === `tick-${p.body.state.worldTime}`);
    expect(postTicks.length).toBe(1);
    expect(postTicks[0].payload.playerOffline).toBeUndefined();
  });

  it("a change near the player is observed during wait but hidden during advance N", async () => {
    // HeatRadiated fires on every tick; observability depends on presence.
    const { body: s0 } = await session();
    const ack0 = await ack("ack-heat-0", s0.session.revision.worldTime, s0.session.revision.eventNumber);
    expect(ack0.status).toBe(200);

    const w = await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "wait", idempotencyKey: "heat-wait" }),
    });
    expect(w.status).toBe(200);
    // Verify HeatRadiated fired via events endpoint.
    const evWait = await events("presence-world");
    expect(evWait.some((e: any) => e.type === "HeatRadiated" && e.timestamp === w.body.state.worldTime)).toBe(true);

    const s1 = await session();
    expect(s1.body.session.drift.newlyObservedChangeCount).toBeGreaterThan(0);
    expect(JSON.stringify({ ...s1.body.session, beliefModel: undefined })).toContain("нагрелся");

    const ack1 = await ack("ack-heat-1", s1.body.session.revision.worldTime, s1.body.session.revision.eventNumber);
    expect(ack1.status).toBe(200);

    const a = await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "advance 2", idempotencyKey: "heat-advance" }),
    });
    expect(a.status).toBe(200);
    const evAdv = await events("presence-world");
    expect(evAdv.some((e: any) => e.type === "HeatRadiated" && e.timestamp > w.body.state.worldTime)).toBe(true);

    const s2 = await session();
    // The advance-N heat events are not observable: no changes, no
    // observation-delta statements. Focus may still keep the heat knowledge
    // the player legitimately observed during the earlier wait, and the
    // fresh staleness statement reflects the time the advance skipped.
    expect(s2.body.session.drift.newlyObservedChangeCount).toBe(0);
    expect(s2.body.session.presence.nearbyChanges).toEqual([]);
    expect(JSON.stringify(s2.body.session.statements)).not.toContain("нагрелся");
  });

  it("commands and advance N never move the checkpoint; only explicit acknowledge does", async () => {
    const { body: before } = await session();
    const beforeCheckpoint = before.session.checkpoint;

    await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "move north", idempotencyKey: "pres-move" }),
    });
    const afterCmd = await session();
    expect(afterCmd.body.session.checkpoint).toEqual(beforeCheckpoint);

    await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "advance 2", idempotencyKey: "pres-advance" }),
    });
    const afterAdvance = await session();
    expect(afterAdvance.body.session.checkpoint).toEqual(beforeCheckpoint);

    const { status, body } = await ack("ack-explicit", afterAdvance.body.session.revision.worldTime, afterAdvance.body.session.revision.eventNumber);
    expect(status).toBe(200);
    expect(body.changed).toBe(true);
    const after = await session();
    expect(after.body.session.checkpoint.lastPresenceWorldTime).toBe(afterAdvance.body.session.revision.worldTime);
  });

  it("rejects an acknowledge that reuses a command key", async () => {
    await api("/api/worlds/presence-world/command", {
      method: "POST",
      body: JSON.stringify({ input: "wait", idempotencyKey: "shared-key" }),
    });
    const { body: s } = await session();
    const { status, body } = await ack("shared-key", s.session.revision.worldTime, s.session.revision.eventNumber);
    expect(status).toBe(409);
    expect(body.error.code).toBe("duplicate_request");
  });

  it("returns 405 for wrong methods", async () => {
    const post = await api("/api/worlds/presence-world/observer-session", { method: "POST", body: "{}" });
    expect(post.status).toBe(405);
    const get = await api("/api/worlds/presence-world/presence/acknowledge");
    expect(get.status).toBe(405);
  });

  it("observer-session carries session and summary together", async () => {
    const { status, body } = await session();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.session.schemaVersion).toBe(1);
    expect(body.summary.schemaVersion).toBe(1);
    expect(body.summary.worldId).toBe("presence-world");
  });

  it("session and summary are derived from one revision", async () => {
    const { body } = await session();
    expect(body.session.revision.worldTime).toBe(body.summary.currentWorldTime);
    expect(body.session.revision.eventNumber).toBeGreaterThanOrEqual(0);
  });

  it("session and summary report the same checkpoint state", async () => {
    const { body } = await session();
    expect(body.session.checkpointState).toBe(body.summary.checkpointState);
    if (body.session.checkpoint) {
      expect(body.summary.lastPresenceWorldTime).toBe(body.session.checkpoint.lastPresenceWorldTime);
    }
  });

  it("an incompatible checkpoint is reflected identically in session and summary", async () => {
    // Corrupt the stored belief revision through a second SQLite connection.
    const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      close(): void;
    } };
    const corrupt = new DatabaseSync(dbPath);
    corrupt.exec("UPDATE observer_checkpoints SET belief_revision = belief_revision + 1 WHERE world_id = 'presence-world'");
    corrupt.close();

    const { body } = await session();
    expect(body.session.checkpointState).toBe("incompatible");
    expect(body.summary.checkpointState).toBe("incompatible");
    expect(body.summary.lastPresenceWorldTime).toBeNull();
    expect(body.session.checkpoint).not.toBeNull();
    expect(body.session.drift.level).toBe("none");
    expect(body.session.statements).toEqual([]);
    expect(body.summary.presenceStatus).toContain("Мир приходится воспринимать заново.");

    // Restore so later suites see a valid checkpoint again.
    const restore = new DatabaseSync(dbPath);
    restore.exec("UPDATE observer_checkpoints SET belief_revision = belief_revision - 1 WHERE world_id = 'presence-world'");
    restore.close();
  });

  it("the atomic response carries no forbidden truth fields", async () => {
    const { body } = await session();
    const text = JSON.stringify({ session: body.session, summary: body.summary });
    expect(text).not.toContain("eventId");
    expect(text).not.toContain("correlationId");
    expect(text).not.toContain("causationId");
    expect(text).not.toContain("activeSituations");
    expect(text).not.toContain("consequences");
    expect(text).not.toContain("trueState");
    expect(text).not.toContain("actualState");
    expect(text).not.toContain("threadKey");
    // targetId/patternId/evidenceId are observer-scoped BeliefModelDTO
    // contract fields; only hidden world truth and log plumbing are banned.
  });

  it("fetching the session never changes the Event Log or the checkpoint", async () => {
    const beforeState = await api("/api/worlds/presence-world/state");
    const beforeSession = await session();
    await session();
    await session();
    const afterState = await api("/api/worlds/presence-world/state");
    const afterSession = await session();
    expect(afterState.body.state.eventNumber).toBe(beforeState.body.state.eventNumber);
    expect(afterState.body.state.worldTime).toBe(beforeState.body.state.worldTime);
    expect(afterSession.body.session.checkpoint).toEqual(beforeSession.body.session.checkpoint);
  });
});
