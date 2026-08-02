import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

const dbPath = join(mkdtempSync(join(tmpdir(), "skald-lifecycle-")), "events.sqlite");
let server: Awaited<ReturnType<typeof startServer>>;

async function api(path: string, opts?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: response.status, body: await response.json() as any };
}

async function session() {
  return api("/api/worlds/lifecycle-world/observer-session");
}

async function ack(key: string, worldTime: number, eventNumber: number) {
  return api("/api/worlds/lifecycle-world/presence/acknowledge", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: key, worldTime, eventNumber }),
  });
}

async function command(input: string, key: string) {
  return api("/api/worlds/lifecycle-world/command", {
    method: "POST",
    body: JSON.stringify({ input, idempotencyKey: key }),
  });
}

async function advance(count: number, key: string) {
  return api("/api/worlds/lifecycle-world/command", {
    method: "POST",
    body: JSON.stringify({ input: `advance ${count}`, idempotencyKey: key }),
  });
}

describe("Presence checkpoint lifecycle (UX-6.1D/F)", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const created = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: "lifecycle-world",
        idempotencyKey: "create-lifecycle",
        saveLabel: "Цикл",
        characterName: "Цикл",
        characterPresetId: "wanderer",
        worldTemplateId: "old_tower",
      }),
    });
    expect(created.status).toBe(201);
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("entry acknowledge at T0 → commands to T2 → graceful exit acknowledge pins the checkpoint at the latest revision", async () => {
    const s0 = await session();
    const t0 = s0.body.session.revision;
    const entryAck = await ack("entry-ack", t0.worldTime, t0.eventNumber);
    expect(entryAck.status).toBe(200);
    expect(entryAck.body.changed).toBe(true);

    const c1 = await command("wait", "cmd-1");
    expect(c1.status).toBe(200);
    const c2 = await command("wait", "cmd-2");
    expect(c2.status).toBe(200);
    expect(c2.body.state.worldTime).toBe(t0.worldTime + 2);

    // Acknowledge does not add Domain Events: eventNumber is unchanged.
    const beforeExit = await session();
    const exitRev = beforeExit.body.session.revision;
    expect(exitRev.worldTime).toBe(t0.worldTime + 2);

    const exitAck = await ack("exit-ack", exitRev.worldTime, exitRev.eventNumber);
    expect(exitAck.status).toBe(200);
    expect(exitAck.body.checkpoint.lastPresenceWorldTime).toBe(exitRev.worldTime);
    expect(exitAck.body.checkpoint.lastPresenceEventNumber).toBe(exitRev.eventNumber);

    const afterExit = await session();
    expect(afterExit.body.session.checkpoint.lastPresenceWorldTime).toBe(exitRev.worldTime);
    expect(afterExit.body.session.checkpoint.lastPresenceEventNumber).toBe(exitRev.eventNumber);
  });

  it("re-entry shows zero drift: the player's own actions are not offline changes", async () => {
    const s = await session();
    expect(s.body.summary.checkpointState).toBe("valid");
    expect(s.body.session.drift.worldTimeDelta).toBe(0);
    expect(s.body.summary.worldTimeDelta).toBe(0);
    expect(s.body.summary.lastPresenceWorldTime).toBe(s.body.session.revision.worldTime);
    expect(s.body.session.drift.level).toBe("none");
    // Dormant threads are informational and may produce known_thread lines,
    // but the player's own actions must never read as absence changes.
    for (const statement of s.body.session.statements) {
      expect(statement.source).not.toBe("observation_delta");
      expect(statement.source).not.toBe("belief_freshness");
      expect(statement.source).not.toBe("belief_contradiction");
    }
    expect(s.body.summary.presenceStatus).toBe("Мир кажется таким, каким ты его помнишь.");
    // A graceful exit never shows the return as a fresh entry.
    expect(s.body.session.checkpointState).not.toBe("missing");
  });

  it("repeating an exit acknowledge with the same key and body reproduces the original response", async () => {
    const s = await session();
    const rev = s.body.session.revision;
    const first = await ack("exit-repeat", rev.worldTime, rev.eventNumber);
    expect(first.status).toBe(200);
    const second = await ack("exit-repeat", rev.worldTime, rev.eventNumber);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("the same exit key with a different body conflicts with 409", async () => {
    const s = await session();
    const rev = s.body.session.revision;
    const ok = await ack("exit-conflict", rev.worldTime, rev.eventNumber);
    expect(ok.status).toBe(200);
    const conflict = await ack("exit-conflict", rev.worldTime - 1, rev.eventNumber);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("duplicate_request");
  });

  it("a stale exit acknowledge never overwrites the stored checkpoint", async () => {
    const before = await session();
    const stored = before.body.session.checkpoint;
    const stale = await ack("exit-stale", stored.lastPresenceWorldTime - 1, stored.lastPresenceEventNumber - 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_revision");
    const after = await session();
    expect(after.body.session.checkpoint).toEqual(stored);
  });

  it("offline ticks after a graceful exit produce observer-scoped absence, not hidden facts", async () => {
    const before = await session();
    const rev = before.body.session.revision;
    expect(before.body.summary.checkpointState).toBe("valid");

    const off = await advance(3, "offline-advance");
    expect(off.status).toBe(200);
    expect(off.body.tickEvents.filter((e: any) => e.type === "TickPassed").length).toBe(3);

    const returned = await session();
    expect(returned.body.summary.worldTimeDelta).toBe(3);
    expect(returned.body.summary.lastPresenceWorldTime).toBe(rev.worldTime);
    // Offline heat events are not observable: no observation-delta statements.
    expect(JSON.stringify(returned.body.session.statements)).not.toContain("нагрелся");
    expect(returned.body.session.presence.nearbyChanges).toEqual([]);
    expect(returned.body.session.drift.newlyObservedChangeCount).toBe(0);
  });

  it("a restart replays the same presence from the same checkpoint", async () => {
    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });

    const s = await session();
    expect(s.status).toBe(200);
    expect(s.body.session.checkpointState).toBe("valid");
    expect(s.body.summary.checkpointState).toBe("valid");
    expect(s.body.session.checkpoint.lastPresenceWorldTime).toBe(s.body.summary.lastPresenceWorldTime);
    expect(s.body.session.revision.worldTime).toBe(s.body.summary.currentWorldTime);

    const again = await session();
    expect(again.body.session.statements).toEqual(s.body.session.statements);
    expect(again.body.summary).toEqual(s.body.summary);
  });
});
