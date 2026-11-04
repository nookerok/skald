/**
 * Read-side inquiry answers remain exact until free narration can prove
 * relevance between every claim and the question being answered.
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

/** Shape of the closed allowed set as it reaches the model. */
type AllowedShape = { facts?: readonly { ref?: unknown; content?: unknown; assertion?: unknown }[]; mandatory?: unknown };

/** Composes over the closed allowed set; turn narration still goes to super. */
class ReadSideNarrationProvider extends FixedNarrationProvider {
  readonly mandatorySeen: string[] = [];

  /** The fact carrying the mandatory result when one exists, else the first fact. */
  protected pickFact(allowed: AllowedShape | null): { ref?: unknown; content?: unknown; assertion?: unknown } | undefined {
    const mandatory = Array.isArray(allowed?.mandatory)
      ? (allowed!.mandatory as unknown[]).filter((entry): entry is string => typeof entry === "string")
      : [];
    const facts = allowed?.facts ?? [];
    const chosen = (mandatory.length > 0 ? facts.find((entry) => mandatory.includes(String(entry.content))) : undefined)
      ?? facts.find((entry) => typeof entry.content === "string" && entry.content.trim().length > 0);
    return chosen;
  }

  protected parseAllowed(messages: readonly ChatMessage[]): AllowedShape | null {
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    try {
      const parsed = JSON.parse(user) as { allowed?: AllowedShape };
      if (parsed.allowed && Array.isArray(parsed.allowed.facts)) {
        const mandatory = Array.isArray(parsed.allowed.mandatory)
          ? (parsed.allowed.mandatory as unknown[]).filter((entry): entry is string => typeof entry === "string")
          : [];
        this.mandatorySeen.push(...mandatory);
        return parsed.allowed;
      }
    } catch {
      return null;
    }
    return null;
  }

  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category !== "narrate") return super.chat(category, messages);
    const allowed = this.parseAllowed(messages);
    const fact = this.pickFact(allowed);
    if (!fact) return super.chat(category, messages);
    const claim = String(fact.content).trim().split(/(?<=[.!?])\s/u, 1)[0] || String(fact.content).trim();
    return {
      model: "read-side-narrator",
      configuredModel: "read-side-narrator",
      responseModel: "read-side-narrator",
      usedFallback: false,
      text: JSON.stringify({ narration: claim, claims: [{ text: claim, ref: fact.ref, assertion: fact.assertion }], coveredMandatory: Array.isArray(allowed?.mandatory) ? allowed!.mandatory : [] }),
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

const readSideProvider = new ReadSideNarrationProvider();

describe("read-side answer narration", () => {
  beforeAll(async () => {
    server = await startServer({ host: "127.0.0.1", port: 0, dbPath, router: readSideProvider });
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

  it("keeps the exact answer without scheduling an unscoped rephrase", async () => {
    // Keep the exact read-side answer; its free narration has no relevance proof.
    const before = await api(`/api/worlds/${worldId}/state`);
    const cmd = await api(`/api/worlds/${worldId}/command`, {
      method: "POST",
      body: JSON.stringify({ input: "где я?", idempotencyKey: "read-side-1" }),
    });
    expect(cmd.status).toBe(200);
    expect(cmd.body.status).toBe("inquiry");
    // The exact observer answer is present immediately.
    expect(typeof cmd.body.inquiry.answer).toBe("string");
    expect(cmd.body.inquiry.answer.length).toBeGreaterThan(0);
    // No unscoped narration is scheduled for this question answer.
    expect(cmd.body.conversationTurn.narrationState).toBe("not_requested");
    expect(cmd.body.masterTurn.narration.status).toBe("not_requested");
    const saved = await waitForInquiryNarration("not_requested");
    expect(saved.responseText).toBe(cmd.body.inquiry.answer);
    expect(saved.narrationText).toBeUndefined();
    expect(readSideProvider.mandatorySeen).toHaveLength(0);

    // A read-only inquiry never advances world time.
    const after = await api(`/api/worlds/${worldId}/state`);
    expect(after.body.state.worldTime).toBe(before.body.state.worldTime);
  });
});

/** Model-proposed inquiry: the gateway reaches `runValidatedMasterTurnResponse`
 * with `execution: null` and `postActionInquiries`, a different path from the
 * deterministic classifier short-circuit. */
const MODEL_INQUIRY_PROPOSAL = {
  schemaVersion: 2,
  kind: "inquiry",
  primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: "опиши место, где я нахожусь" },
  supportingClauses: [],
  referents: [],
};

class PlanPathNarrationProvider extends ReadSideNarrationProvider {
  readonly allowedSeen: boolean[] = [];

  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category === "interpret") {
      return {
        model: "plan-path-interpreter",
        configuredModel: "plan-path-interpreter",
        responseModel: "plan-path-interpreter",
        usedFallback: false,
        text: JSON.stringify(MODEL_INQUIRY_PROPOSAL),
        latencyMs: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        provider: "opencode_zen",
      };
    }
    if (category === "narrate") {
      const user = messages.find((message) => message.role === "user")?.content ?? "";
      let sawAllowed = false;
      try {
        const parsed = JSON.parse(user) as { allowed?: AllowedShape };
        sawAllowed = Boolean(parsed.allowed && Array.isArray(parsed.allowed.facts));
      } catch {
        sawAllowed = false;
      }
      this.allowedSeen.push(sawAllowed);
    }
    return super.chat(category, messages);
  }
}

describe("model-proposed inquiry read-side safety", () => {
  it("keeps the exact response and does not invoke unscoped narration", async () => {
    const provider = new PlanPathNarrationProvider();
    const planServer = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: join(mkdtempSync(join(tmpdir(), "skald-plan-narration-")), "events.sqlite"),
      router: provider,
    });
    try {
      const created = await fetch(`${planServer.url}/api/worlds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "plan-path-create" },
        body: JSON.stringify({ characterName: "Тест", backgroundId: "wanderer", entrypointId: "river_waystation_arrival" }),
      });
      expect(created.status).toBe(201);
      const world = (await created.json() as any).world.worldId as string;
      const state = async () => (await (await fetch(`${planServer.url}/api/worlds/${world}/state`)).json() as any).state;
      const before = await state();

      const cmd = await (await fetch(`${planServer.url}/api/worlds/${world}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "опиши место, где я нахожусь", idempotencyKey: "plan-path-1" }),
      })).json() as any;
      expect(cmd.status).toBe("inquiry");
      // The plan path is the only inquiry branch that returns `inquiries`.
      expect(Array.isArray(cmd.inquiries)).toBe(true);
      expect(cmd.conversationTurn.narrationState).toBe("not_requested");
      expect(cmd.masterTurn.narration.status).toBe("not_requested");
      const journal = await (await fetch(`${planServer.url}/api/worlds/${world}/journal?limit=10`)).json() as any;
      const saved = journal.conversationTurns?.find((candidate: any) => candidate.responseKind === "inquiry_answer");
      expect(saved.responseText).toBe(cmd.conversationTurn.responseText);
      expect(saved.narrationText).toBeUndefined();
      expect(provider.allowedSeen).toHaveLength(0);
      expect(provider.mandatorySeen).toHaveLength(0);

      const after = await state();
      expect(after.worldTime).toBe(before.worldTime);
      expect(after.eventNumber).toBe(before.eventNumber);
    } finally {
      await planServer.close();
    }
  }, 20000);
});

/** Fails the first read-side rephrase with a transient 5xx, then succeeds. */
class FlakyReadSideProvider extends ReadSideNarrationProvider {
  private failed = false;
  readonly rephraseCalls: string[] = [];
  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category !== "narrate") return super.chat(category, messages);
    const allowed = this.parseAllowed(messages);
    const fact = this.pickFact(allowed);
    if (!fact) return super.chat(category, messages);
    // Flaky path records the call before failing once.
    this.rephraseCalls.push(String(fact.content));
    if (!this.failed) {
      this.failed = true;
      throw new ProviderRequestError({ provider: "opencode_zen", model: "flaky-narrator", phase: "response_shape", httpStatus: 503 });
    }
    const claim = String(fact.content).trim().split(/(?<=[.!?])\s/u, 1)[0] || String(fact.content).trim();
    return {
      model: "read-side-narrator",
      configuredModel: "read-side-narrator",
      responseModel: "read-side-narrator",
      usedFallback: false,
      text: JSON.stringify({ narration: claim, claims: [{ text: claim, ref: fact.ref, assertion: fact.assertion }], coveredMandatory: Array.isArray(allowed?.mandatory) ? allowed!.mandatory : [] }),
      latencyMs: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: "opencode_zen",
    };
  }
}

describe("read-side inquiry narration guard", () => {
  it("does not schedule narration retries or duplicate the ConversationTurn", async () => {
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
        // A question without relevance proof must keep its exact answer.
        body: JSON.stringify({ input: "где я?", idempotencyKey: "read-side-retry-1" }),
      })).json() as any;
      expect(cmd.status).toBe("inquiry");
      expect(cmd.conversationTurn.narrationState).toBe("not_requested");
      const masterTurnKey = cmd.masterTurn.turnKey as string;
      const journal = await (await fetch(`${server.url}/api/worlds/${world}/journal?limit=10`)).json() as any;
      const inquiryTurns = journal.conversationTurns.filter((candidate: any) => candidate.responseKind === "inquiry_answer");
      expect(inquiryTurns).toHaveLength(1);
      expect(inquiryTurns[0].turnKey).toBe(masterTurnKey);
      expect(inquiryTurns[0].narrationText).toBeUndefined();

      expect(provider.rephraseCalls).toHaveLength(0);
      // Retrying narration created no Domain Event and moved no world time.
      const after = await getState();
      expect(after.eventNumber).toBe(before.eventNumber);
      expect(after.worldTime).toBe(before.worldTime);
    } finally {
      await server.close();
    }
  }, 20000);
});
