import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";
import { createMultiWorldStore } from "../src/persistence/index.js";
import { bootstrapWorldEvents } from "@skald/world";

const dbPath = join(mkdtempSync(join(tmpdir(), "skald-threads-http-")), "events.sqlite");
let server: Awaited<ReturnType<typeof startServer>>;

function createLegacyWorld(store: ReturnType<typeof createMultiWorldStore>, worldId: string): void {
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: worldId,
    characterName: "Ирина",
    characterPresetId: "p1",
    worldTemplateId: "legacy",
    characterWound: "wound",
    characterPromise: "promise",
    characterPrinciple: "principle",
    characterProfileVersion: 1,
    bootstrapEvents: bootstrapWorldEvents(),
  });
}

async function api(path: string, opts?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return { status: response.status, body: await response.json() as any };
}

async function session() {
  return api("/api/worlds/thread-world/observer-session");
}

async function threads() {
  return api("/api/worlds/thread-world/observer-threads");
}

async function ack(key: string, worldTime: number, eventNumber: number) {
  return api("/api/worlds/thread-world/presence/acknowledge", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: key, worldTime, eventNumber }),
  });
}

async function command(input: string, key: string) {
  return api("/api/worlds/thread-world/command", {
    method: "POST",
    body: JSON.stringify({ input, idempotencyKey: key }),
  });
}

function fireThread(journal: any) {
  return journal.threads.find((t: any) => t.title === "Лесной пожар");
}

/**
 * Risk-taking playthrough that starts a forest fire at tick 14:
 * 3 moves (t1-3) → audacity at t8 (fear 1) → 1 move (t9, second audacity
 * created) → fear 2 at t14 → ForestFireStarted + SituationStarted.
 */
async function startFire() {
  for (let i = 1; i <= 3; i++) await command("move north", `thr-move-${i}`);
  for (let i = 4; i <= 8; i++) await command("wait", `thr-wait-${i}`);
  await command("move north", "thr-move-9");
  for (let i = 10; i <= 14; i++) await command("wait", `thr-wait-${i}`);
}

describe("Observer threads HTTP contract (UX-6.2)", () => {
  beforeAll(async () => {
    const store = createMultiWorldStore(dbPath);
    createLegacyWorld(store, "thread-world");
    createLegacyWorld(store, "thread-world-b");
    store.close();
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("returns an empty journal before any process is observed", async () => {
    const { status, body } = await threads();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.journal.schemaVersion).toBe(1);
    expect(body.journal.threads).toEqual([]);
    expect(body.journal.counts).toEqual({ observedActive: 0, changedSincePresence: 0, uncertain: 0, recentlyResolved: 0 });
  });

  it("rejects POST with 405 and unknown worlds with 404", async () => {
    const post = await api("/api/worlds/thread-world/observer-threads", { method: "POST", body: "{}" });
    expect(post.status).toBe(405);
    const missing = await api("/api/worlds/ghost-world/observer-threads");
    expect(missing.status).toBe(404);
  });

  it("the entry response carries threads at the session revision", async () => {
    const s = await session();
    expect(s.status).toBe(200);
    expect(s.body.threads.schemaVersion).toBe(1);
    expect(s.body.threads.revision.worldTime).toBe(s.body.session.revision.worldTime);
    expect(s.body.threads.revision.eventNumber).toBe(s.body.session.revision.eventNumber);
  });

  it("a fully observed fire playthrough produces an active observed fire thread and a consequence thread", async () => {
    const baseline = await session();
    const ackRes = await ack("thr-ack-baseline", baseline.body.session.revision.worldTime, baseline.body.session.revision.eventNumber);
    expect(ackRes.status).toBe(200);

    await startFire();
    await command("wait", "thr-wait-15");

    const { status, body } = await threads();
    expect(status).toBe(200);
    expect(body.journal.threads.length).toBeGreaterThanOrEqual(2);

    const fire = fireThread(body.journal);
    expect(fire).toBeDefined();
    expect(fire.knownLifecycle).toBe("active");
    expect(fire.knowledgeState).toBe("observed");
    expect(fire.changeSincePresence.kind).toBe("appeared");
    expect(fire.evidenceCount).toBeGreaterThanOrEqual(2);
    expect(fire.evidence.length).toBeLessThanOrEqual(3);
    expect(fire.ref).toMatch(/^ot-[0-9a-z]+$/);
    expect(fire.summary).toBe("При последнем наблюдении пожар продолжался.");
    expect(fire.uncertaintyText).toBeNull();

    const consequence = body.journal.threads.find((t: any) => t.knownLifecycle === "active" && t.title !== "Лесной пожар");
    expect(consequence).toBeDefined();
    expect(consequence.changeSincePresence.kind).toBe("appeared");

    expect(body.journal.counts.observedActive).toBe(1);
    expect(body.journal.counts.changedSincePresence).toBe(2);
  });

  it("never leaks hidden world state or internal ids into the journal", async () => {
    const { body } = await threads();
    const text = JSON.stringify(body.journal);
    expect(text).not.toContain("eventId");
    expect(text).not.toContain("correlationId");
    expect(text).not.toContain("causationId");
    expect(text).not.toContain("threadKey");
    expect(text).not.toContain("situation:");
    expect(text).not.toContain("activeSituations");
    expect(text).not.toContain("ForestFireStarted");
    expect(text).not.toContain("TreeBurned");
    expect(text).not.toContain("SituationEnded");
  });

  it("command responses carry observerThreads and observerThreadDelta at the new revision", async () => {
    const before = await threads();
    const fire = fireThread(before.body.journal);
    expect(fire).toBeDefined();
    const r = await command("wait", "thr-wait-16");
    expect(r.status).toBe(200);
    expect(r.body.observerThreads.schemaVersion).toBe(1);
    expect(r.body.observerThreads.revision.worldTime).toBe(r.body.state.worldTime);
    // The fire started after the baseline checkpoint: the change is "appeared",
    // so the delta reports it as opened, not changed.
    expect(r.body.observerThreadDelta.opened).toContain(fire.ref);
    expect(r.body.observerThreadDelta.changed).toEqual([]);
    expect(r.body.observerThreadDelta.resolved).toEqual([]);
  });

  it("an exit acknowledge pins the checkpoint; re-entry reports no change until re-observation", async () => {
    const s = await session();
    const exit = await ack("thr-ack-exit", s.body.session.revision.worldTime, s.body.session.revision.eventNumber);
    expect(exit.status).toBe(200);

    const re = await threads();
    const fire = fireThread(re.body.journal);
    expect(fire).toBeDefined();
    expect(fire.changeSincePresence).toBeNull();
    expect(re.body.journal.counts.changedSincePresence).toBe(0);

    // Each wait advances exactly one tick. Tick 17 has no spread burn
    // (spread burns at even offsets), so no change yet...
    const r1 = await command("wait", "thr-wait-17");
    expect(r1.body.observerThreadDelta.changed).toEqual([]);

    // ...but tick 18 burns again: the re-observation develops the thread.
    const r2 = await command("wait", "thr-wait-18");
    expect(r2.body.observerThreadDelta.changed).toContain(fire.ref);
    expect(r2.body.observerThreadDelta.opened).toEqual([]);
    expect(r2.body.observerThreadDelta.resolved).toEqual([]);
  });

  it("offline advance ages the thread but never resolves it from a hidden end", async () => {
    const before = await threads();
    const fire = fireThread(before.body.journal);
    const ref = fire!.ref;

    // The fire ends at tick 22 while the player is offline (started at 14,
    // duration 8); ticks 19-28 are all offline.
    const r = await command("advance 10", "thr-advance-19to28");
    expect(r.status).toBe(200);
    expect(r.body.observerThreadDelta.resolved).toEqual([]);

    const after = await threads();
    const thread = fireThread(after.body.journal);
    expect(thread.ref).toBe(ref);
    expect(thread.knownLifecycle).toBe("active");
    expect(thread.knowledgeState).toBe("uncertain");
    expect(thread.summary).toContain("продолжался");
    expect(JSON.stringify(thread.summary)).not.toContain("завершился");
    expect(thread.uncertaintyText).toBeTruthy();
    expect(thread.changeSincePresence.kind).toBe("developed");
    expect(after.body.journal.counts.uncertain).toBe(2);
    expect(after.body.journal.counts.observedActive).toBe(0);
  });

  it("worlds do not mix thread journals", async () => {
    const other = await api("/api/worlds/thread-world-b/observer-threads");
    expect(other.status).toBe(200);
    expect(other.body.journal.threads).toEqual([]);
    const own = await threads();
    expect(fireThread(own.body.journal)).toBeDefined();
  });

  it("a restart replays the identical journal from the Event Log", async () => {
    const before = (await threads()).body.journal;
    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath });
    const after = (await threads()).body.journal;
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
