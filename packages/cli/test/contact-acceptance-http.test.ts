/**
 * Contact acceptance (contact-identity T5), API path with no model.
 *
 * One canonical ferryman, one entity and one relation; the person questions are
 * answered deterministically; a read-only inquiry creates no Event and moves no
 * time; and a known but absent person is not reported as present.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";

let server: Awaited<ReturnType<typeof startServer>>;
let worldId: string;
let cityWorldId: string;

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  return { status: response.status, body: await response.json() as any };
}

async function createWorld(key: string, entrypointId: string): Promise<string> {
  const created = await api("/api/worlds", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ characterName: "Tester", backgroundId: "wanderer", entrypointId }),
  });
  expect(created.status).toBe(201);
  return created.body.world.worldId;
}

async function ask(world: string, input: string, key: string) {
  const response = await api(`/api/worlds/${world}/command`, { method: "POST", body: JSON.stringify({ input, idempotencyKey: key }) });
  expect(response.status).toBe(200);
  return response.body;
}

describe("contact acceptance (API, no model)", () => {
  beforeAll(async () => {
    // A dead router models LLM-off: every answer must still be deterministic.
    const dead = { apiKey: "", chat: () => { throw new Error("model down"); } } as any;
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath: join(mkdtempSync(join(tmpdir(), "skald-contact-accept-")), "events.sqlite"), router: dead });
    worldId = await createWorld("contact-accept", "river_waystation_arrival");
    cityWorldId = await createWorld("contact-accept-city", "riverwatch_city_arrival");
  }, 15000);

  afterAll(async () => {
    await server.close();
  });

  it("has one ferryman, and answers the person questions deterministically", async () => {
    const nearby = await ask(worldId, "кто рядом?", "acc-1");
    expect(nearby.status).toBe("inquiry");
    expect(nearby.inquiry.queryId).toBe("who_is_nearby");
    expect(nearby.inquiry.answer.match(/Перевозчик у переправы/g)?.length).toBe(1);

    const look = await ask(worldId, "как выглядит перевозчик?", "acc-2");
    expect(look.inquiry.queryId).toBe("visible_scene");
    expect(look.inquiry.answer).toMatch(/плащ|седина/i);
    expect(look.inquiry.answer).toMatch(/знаешь/i);

    const who = await ask(worldId, "кто этот перевозчик?", "acc-3");
    expect(who.inquiry.queryId).toBe("visible_scene");
    expect(who.inquiry.answer).toContain("Перевозчик у переправы");

    const known = await ask(worldId, "я его знаю?", "acc-4");
    expect(known.inquiry.queryId).toBe("known_contacts");
    expect(known.inquiry.answer).toContain("Перевозчик у переправы");

    const address = await ask(worldId, "как обратиться к перевозчику?", "acc-5");
    expect(address.inquiry.queryId).toBe("visible_scene");
    expect(address.inquiry.answer).toMatch(/обратиться/i);
    expect(address.inquiry.answer).toContain("перевозчик");
  });

  it("changes no Event and no world time for read-only inquiries", async () => {
    const before = await api(`/api/worlds/${worldId}/state`);
    await ask(worldId, "кто рядом?", "acc-r1");
    await ask(worldId, "как выглядит перевозчик?", "acc-r2");
    await ask(worldId, "как он на меня смотрит?", "acc-r3");
    const after = await api(`/api/worlds/${worldId}/state`);
    expect(after.body.state.eventNumber).toBe(before.body.state.eventNumber);
    expect(after.body.state.worldTime).toBe(before.body.state.worldTime);
  });

  it("does not describe a known but absent ferryman as present", async () => {
    const nearby = await ask(cityWorldId, "кто рядом?", "acc-city-1");
    expect(nearby.inquiry.answer).not.toContain("Перевозчик у переправы");
  });
});
