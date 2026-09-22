/**
 * Read-side answer narration over HTTP (full-master Stage 3).
 *
 * A read-only inquiry keeps its exact answer and moves no world time, yet a
 * provider-backed literary rephrase settles into the SAME conversation turn
 * (pending -> ready), so inquiry/clarification no longer speak in a different
 * register from actions.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";
import { FixedNarrationProvider } from "../src/acceptance/fixed-narration-provider.js";
import type { ChatMessage, ChatResult } from "@skald/world";
import { ProviderRequestError } from "@skald/world";

const dbPath = join(mkdtempSync(join(tmpdir(), "skald-read-side-narration-")), "events.sqlite");
let server: Awaited<ReturnType<typeof startServer>>;
let worldId: string;

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  return { status: response.status, body: await response.json() as any };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Rephrases an exact read-side answer; turn narration still goes to super. */
class ReadSideNarrationProvider extends FixedNarrationProvider {
  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category !== "narrate") return super.chat(category, messages);
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    let answer: string | null = null;
    try {
      const parsed = JSON.parse(user) as { answer?: unknown };
      if (typeof parsed.answer === "string" && parsed.answer.trim().length > 0) answer = parsed.answer.trim();
    } catch {
      answer = null;
    }
    if (answer === null) return super.chat(category, messages);
    const claim = answer.split(/(?<=[.!?])\s/u, 1)[0] || answer;
    return {
      model: "read-side-narrator",
      configuredModel: "read-side-narrator",
      responseModel: "read-side-narrator",
      usedFallback: false,
      text: JSON.stringify({ narration: claim, claims: [{ text: claim, sourceFactId: "answer", epistemicClass: "observed_fact" }] }),
      latencyMs: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: "opencode_zen",
    };
  }
}

async function waitForInquiryNarration(expected: string, maxMs = 3000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const response = await fetch(`${server.url}/api/worlds/${worldId}/journal?limit=10`);
    const body = await response.json() as any;
    const turn = body.conversationTurns?.find((candidate: any) => candidate.responseKind === "inquiry_answer");
    if (turn?.narrationState === expected) return turn;
    await tick();
  }
  throw new Error(`Timed out waiting for read-side narrationState=${expected}`);
}

describe("read-side answer narration", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath, router: new ReadSideNarrationProvider() });
    const created = await api("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "read-side-create" },
      body: JSON.stringify({ characterName: "Тест", backgroundId: "wanderer", entrypointId: "river_waystation_arrival" }),
    });
    expect(created.status).toBe(201);
    worldId = created.body.world.worldId;
  }, 10000);

  afterAll(async () => {
    await server.close();
  });

  it("keeps the exact answer, schedules a rephrase, and settles pending -> ready", async () => {
    const before = await api(`/api/worlds/${worldId}/state`);
    const cmd = await api(`/api/worlds/${worldId}/command`, {
      method: "POST",
      body: JSON.stringify({ input: "кто рядом?", idempotencyKey: "read-side-1" }),
    });
    expect(cmd.status).toBe(200);
    expect(cmd.body.status).toBe("inquiry");
    // The exact observer answer is present immediately.
    expect(typeof cmd.body.inquiry.answer).toBe("string");
    expect(cmd.body.inquiry.answer.length).toBeGreaterThan(0);
    // A rephrase was scheduled; the envelope reports it as pending.
    expect(cmd.body.conversationTurn.narrationState).toBe("pending");
    expect(cmd.body.masterTurn.narration.status).toBe("pending");

    const ready = await waitForInquiryNarration("ready");
    expect(typeof ready.narrationText).toBe("string");
    expect(ready.narrationText.length).toBeGreaterThan(0);
    // The rephrase is the same answer, not a new fact.
    expect(cmd.body.inquiry.answer).toContain(ready.narrationText.replace(/[.!?]+$/u, ""));

    // A read-only inquiry never advances world time.
    const after = await api(`/api/worlds/${worldId}/state`);
    expect(after.body.state.worldTime).toBe(before.body.state.worldTime);
  });
});

/** Fails the first read-side rephrase with a transient 5xx, then succeeds. */
class FlakyReadSideProvider extends FixedNarrationProvider {
  private failed = false;
  readonly rephraseCalls: string[] = [];
  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category !== "narrate") return super.chat(category, messages);
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    let answer: string | null = null;
    try {
      const parsed = JSON.parse(user) as { answer?: unknown };
      if (typeof parsed.answer === "string" && parsed.answer.trim().length > 0) answer = parsed.answer.trim();
    } catch {
      answer = null;
    }
    if (answer === null) return super.chat(category, messages);
    this.rephraseCalls.push(answer);
    if (!this.failed) {
      this.failed = true;
      throw new ProviderRequestError({ provider: "opencode_zen", model: "flaky-narrator", phase: "response_shape", httpStatus: 503 });
    }
    const claim = answer.split(/(?<=[.!?])\s/u, 1)[0] || answer;
    return {
      model: "read-side-narrator",
      configuredModel: "read-side-narrator",
      responseModel: "read-side-narrator",
      usedFallback: false,
      text: JSON.stringify({ narration: claim, claims: [{ text: claim, sourceFactId: "answer", epistemicClass: "observed_fact" }] }),
      latencyMs: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: "opencode_zen",
    };
  }
}

describe("read-side narration retry (transient failure once, then success)", () => {
  it("retries into the SAME turn with no second Event or ConversationTurn", async () => {
    const provider = new FlakyReadSideProvider();
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: join(mkdtempSync(join(tmpdir(), "skald-read-side-retry-")), "events.sqlite"),
      router: provider,
    });
    try {
      const created = await fetch(`${server.url}/api/worlds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "read-side-retry-create" },
        body: JSON.stringify({ characterName: "Тест", backgroundId: "wanderer", entrypointId: "river_waystation_arrival" }),
      });
      const world = (await created.json() as any).world.worldId as string;
      const getState = async () => (await (await fetch(`${server.url}/api/worlds/${world}/state`)).json() as any).state;

      const before = await getState();
      const cmd = await (await fetch(`${server.url}/api/worlds/${world}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "кто рядом?", idempotencyKey: "read-side-retry-1" }),
      })).json() as any;
      expect(cmd.status).toBe("inquiry");
      expect(cmd.conversationTurn.narrationState).toBe("pending");
      const masterTurnKey = cmd.masterTurn.turnKey as string;

      // Poll for the retried rephrase to settle ready.
      let ready: any = null;
      const started = Date.now();
      while (Date.now() - started < 8000) {
        const journal = await (await fetch(`${server.url}/api/worlds/${world}/journal?limit=10`)).json() as any;
        const turn = journal.conversationTurns?.find((candidate: any) => candidate.responseKind === "inquiry_answer");
        if (turn?.narrationState === "ready") { ready = turn; break; }
        await tick();
      }
      expect(ready).not.toBeNull();
      // The transient failure was retried (two provider attempts for one turn).
      expect(provider.rephraseCalls.length).toBeGreaterThanOrEqual(2);

      const journal = await (await fetch(`${server.url}/api/worlds/${world}/journal?limit=10`)).json() as any;
      const inquiryTurns = journal.conversationTurns.filter((candidate: any) => candidate.responseKind === "inquiry_answer");
      // One input, one turn: the retry did not append a second conversation turn.
      expect(inquiryTurns).toHaveLength(1);
      expect(inquiryTurns[0].turnKey).toBe(masterTurnKey);

      // Retrying narration created no Domain Event and moved no world time.
      const after = await getState();
      expect(after.eventNumber).toBe(before.eventNumber);
      expect(after.worldTime).toBe(before.worldTime);
    } finally {
      await server.close();
    }
  }, 20000);
});
