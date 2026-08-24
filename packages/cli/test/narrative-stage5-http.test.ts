import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";
import { handleWorldNarrativeLLM } from "../src/http/world-handlers.js";
import { ModelRouter } from "@skald/world";
import { EventBus } from "@skald/event-bus";
import { WorldProjector } from "@skald/world";
import type { ChatMessage, ChatResult } from "@skald/world";
import { describe, expect, it } from "vitest";

class ContextNarrator extends ModelRouter {
  readonly prompts: Record<string, unknown>[] = [];

  constructor() {
    super({ apiKey: "stage5-test", providerId: "opencode_zen", availableProviders: ["opencode_zen"], timeoutMs: 1 });
  }

  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category !== "narrate") throw new Error("stage5 test provider only serves narration");
    const raw = messages.find((message) => message.role === "user")?.content ?? "{}";
    const payload = JSON.parse(raw) as { turnFacts?: readonly { id?: unknown; text?: unknown; epistemicClass?: unknown }[]; backgroundFacts?: readonly { id?: unknown; text?: unknown; epistemicClass?: unknown }[]; openingWindow?: boolean };
    this.prompts.push(payload);
    const turn = payload.turnFacts?.find((fact) => typeof fact.id === "string" && typeof fact.text === "string" && typeof fact.epistemicClass === "string");
    const background = payload.backgroundFacts?.find((fact) => typeof fact.id === "string" && (fact.id === "background:obligation" || fact.id === "arrival:reason" || fact.id === "arrival:hook" || fact.id === "situation:opening-problem" || fact.id.startsWith("item:") || fact.id.startsWith("contact:") || fact.id.startsWith("testimony:")));
    const turnText = typeof turn?.text === "string" ? (turn.text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? turn.text) : undefined;
    const claims = [
      ...(turn && turnText ? [{ text: turnText, sourceFactId: turn.id!, epistemicClass: turn.epistemicClass! }] : []),
      ...(payload.openingWindow && background ? [{ text: background.text!, sourceFactId: background.id!, epistemicClass: background.epistemicClass! }] : []),
    ];
    const firstText = claims[0]?.text ?? "Мир продолжал дышать вокруг тебя.";
    return {
      model: "stage5-test-narrator",
      configuredModel: "stage5-test-narrator",
      responseModel: "stage5-test-narrator",
      usedFallback: false,
      text: JSON.stringify({ narration: firstText, claims }),
      latencyMs: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: "opencode_zen",
    };
  }
}

describe("Stage 5 narrative context HTTP path", () => {
  it("persists the first conversation replies, reloads them, and closes the opening window after three turns", async () => {
    const provider = new ContextNarrator();
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: join(mkdtempSync(join(tmpdir(), "skald-stage5-http-")), "events.sqlite"),
      router: provider,
    });
    try {
      const create = await fetch(`${server.url}/api/worlds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "stage5-create" },
        body: JSON.stringify({ characterName: "Виктор", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
      });
      expect(create.status).toBe(201);
      const created = await create.json() as any;
      const worldId = created.world.worldId as string;
      const sessionResponse = await fetch(`${server.url}/api/worlds/${worldId}/observer-session`);
      const session = await sessionResponse.json() as any;
      const ack = await fetch(`${server.url}/api/worlds/${worldId}/presence/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "stage5-ack", worldTime: session.session.revision.worldTime, eventNumber: session.session.revision.eventNumber }),
      });
      expect(ack.status).toBe(200);
      const submit = async (input: string, idempotencyKey: string) => {
        const response = await fetch(`${server.url}/api/worlds/${worldId}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, idempotencyKey }),
        });
        expect(response.status).toBe(200);
        return await response.json() as any;
      };
      const waitForNarration = async (worldTime: number) => {
        const started = Date.now();
        let latest: any;
        while (Date.now() - started < 3000) {
          const response = await fetch(`${server.url}/api/worlds/${worldId}/journal?limit=20`);
          latest = await response.json() as any;
          const turn = latest.turns.find((candidate: any) => candidate.worldTime === worldTime);
          if (turn?.narrationState === "ready") return latest;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(`narration did not become ready for worldTime=${worldTime}: ${JSON.stringify(latest)}`);
      };

      const first = await submit("осмотреться", "stage5-action-1");
      expect(first.presentation.primary?.sourceEventIds ?? []).toEqual([]);
      expect(first.presentation.response?.sourceEventIds ?? []).toEqual([]);
      await waitForNarration(first.conversationTurn.worldTimeAfter);

      const inquiry = await submit("где я?", "stage5-inquiry-1");
      expect(inquiry.status).toBe("inquiry");
      expect(inquiry.conversationTurn.inputClass).toBe("inquiry");

      const second = await submit("проверить вокруг", "stage5-action-2");
      await waitForNarration(second.conversationTurn.worldTimeAfter);

      // A fourth player turn makes the all-turns rule observable: the third
      // action is outside the opening window even though only two actions
      // preceded it.
      const third = await submit("осмотреться", "stage5-action-3");
      const finalJournal = await waitForNarration(third.conversationTurn.worldTimeAfter);

      expect(provider.prompts.map((prompt) => prompt.openingWindow)).toEqual([true, true, false]);
      const openingPrompt = provider.prompts[0]!;
      expect(openingPrompt.backgroundFacts).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("архив") })]));
      expect(openingPrompt.accessibleItems).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("Письменные принадлежности") })]));
      expect(openingPrompt.accessibleItems).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringMatching(/письмо|уцелевш.*запис|физическ/i) })]));

      const conversationTurns = finalJournal.conversationTurns as any[];
      expect(conversationTurns.map((turn) => turn.playerText)).toEqual(["осмотреться", "где я?", "проверить вокруг", "осмотреться"]);
      expect(new Set(conversationTurns.map((turn) => turn.turnSeq)).size).toBe(conversationTurns.length);
      expect(conversationTurns.every((turn) => typeof turn.responseText === "string" && turn.responseText.length > 0)).toBe(true);
      const actionNarrations = finalJournal.turns
        .filter((turn: any) => [first.conversationTurn.worldTimeAfter, second.conversationTurn.worldTimeAfter, third.conversationTurn.worldTimeAfter].includes(turn.worldTime))
        .sort((a: any, b: any) => a.worldTime - b.worldTime);
      expect(actionNarrations.every((turn: any) => turn.narrationState === "ready")).toBe(true);
      expect(actionNarrations.slice(0, 2).every((turn: any) => /запис|архив|обязательств/i.test(turn.narrativeLLM?.text ?? ""))).toBe(true);

      // A second read is the reload boundary: the server reconstructs both
      // sides of the conversation from SQLite, without local pending state.
      const reloaded = await (await fetch(`${server.url}/api/worlds/${worldId}/journal?limit=20`)).json() as any;
      expect(reloaded.conversationTurns.map((turn: any) => turn.idempotencyKey)).toEqual([
        "stage5-action-1", "stage5-inquiry-1", "stage5-action-2", "stage5-action-3",
      ]);
      expect(reloaded.conversationTurns).toHaveLength(conversationTurns.length);
      expect(JSON.stringify(reloaded)).not.toContain("fallbackReason");

      const narrative = await fetch(`${server.url}/api/worlds/${worldId}/narrative`);
      const narrativeBody = await narrative.json() as any;
      expect(JSON.stringify(narrativeBody)).not.toContain("eventId");
      expect(JSON.stringify(narrativeBody)).not.toContain("canonicalRefs");
      expect((narrativeBody.entries ?? []).every((entry: any) => (entry.sourceEventIds ?? []).length === 0)).toBe(true);
      expect(narrativeBody.backgroundContext).toBeUndefined();

      const eventsResponse = await fetch(`${server.url}/api/worlds/${worldId}/events?limit=200`);
      expect(eventsResponse.status).toBe(200);
      const events = await eventsResponse.json() as any;
      expect(events.events.some((event: any) => String(event.type).toLowerCase().includes("narrat"))).toBe(false);
    } finally {
      await server.close();
    }
  }, 15_000);

  it("restores the world, transcript, and narration after reopening the SQLite database", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-stage5-restart-")), "events.sqlite");
    const firstProvider = new ContextNarrator();
    const firstServer = await startServer({ host: "127.0.0.1", port: 0, dbPath, router: firstProvider });
    let worldId = "";
    let worldTime = 0;
    try {
      const create = await fetch(`${firstServer.url}/api/worlds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "stage5-restart-create" },
        body: JSON.stringify({ characterName: "Виктор", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
      });
      expect(create.status).toBe(201);
      worldId = (await create.json() as any).world.worldId as string;
      const session = await (await fetch(`${firstServer.url}/api/worlds/${worldId}/observer-session`)).json() as any;
      const ack = await fetch(`${firstServer.url}/api/worlds/${worldId}/presence/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "stage5-restart-ack", worldTime: session.session.revision.worldTime, eventNumber: session.session.revision.eventNumber }),
      });
      expect(ack.status).toBe(200);
      const command = await fetch(`${firstServer.url}/api/worlds/${worldId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "осмотреться", idempotencyKey: "stage5-restart-command" }),
      });
      expect(command.status).toBe(200);
      worldTime = ((await command.json()) as any).conversationTurn.worldTimeAfter as number;
      const started = Date.now();
      while (Date.now() - started < 3000) {
        const journal = await (await fetch(`${firstServer.url}/api/worlds/${worldId}/journal?limit=10`)).json() as any;
        const turn = journal.turns.find((candidate: any) => candidate.worldTime === worldTime);
        if (turn?.narrationState === "ready") {
          expect(turn.narrativeLLM?.text).toEqual(expect.any(String));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      await firstServer.close();
    }

    const restartedProvider = new ContextNarrator();
    const restartedServer = await startServer({ host: "127.0.0.1", port: 0, dbPath, router: restartedProvider });
    try {
      const stateResponse = await fetch(`${restartedServer.url}/api/worlds/${worldId}/state`);
      expect(stateResponse.status).toBe(200);
      const state = await stateResponse.json() as any;
      expect(state.state.worldTime).toBe(worldTime);

      const journalResponse = await fetch(`${restartedServer.url}/api/worlds/${worldId}/journal?limit=10`);
      expect(journalResponse.status).toBe(200);
      const journal = await journalResponse.json() as any;
      expect(journal.conversationTurns).toHaveLength(1);
      expect(journal.conversationTurns[0]).toMatchObject({
        idempotencyKey: "stage5-restart-command",
        playerText: "осмотреться",
      });
      const turn = journal.turns.find((candidate: any) => candidate.worldTime === worldTime);
      expect(turn).toMatchObject({ narrationState: "ready" });
      expect(turn.narrativeLLM?.text).toEqual(expect.any(String));

      const replay = await fetch(`${restartedServer.url}/api/worlds/${worldId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "осмотреться", idempotencyKey: "stage5-restart-command" }),
      });
      expect(replay.status).toBe(409);
      const replayBody = await replay.json() as any;
      expect(replayBody.conversationTurn).toMatchObject({
        idempotencyKey: "stage5-restart-command",
        playerText: "осмотреться",
      });
      const afterReplay = await (await fetch(`${restartedServer.url}/api/worlds/${worldId}/journal?limit=10`)).json() as any;
      expect(afterReplay.conversationTurns).toHaveLength(1);
    } finally {
      await restartedServer.close();
    }
  }, 15_000);

  it("uses the same observer-safe adapter context on the legacy narrative-llm route", async () => {
    const provider = new ContextNarrator();
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: join(mkdtempSync(join(tmpdir(), "skald-stage5-legacy-http-")), "events.sqlite"),
      router: provider,
    });
    try {
      const create = await fetch(`${server.url}/api/worlds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "stage5-legacy-create" },
        body: JSON.stringify({ characterName: "Виктор", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
      });
      expect(create.status).toBe(201);
      const created = await create.json() as any;
      const worldId = created.world.worldId as string;
      const response = await fetch(`${server.url}/api/worlds/${worldId}/narrative-llm`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body).toMatchObject({ ok: true, usedFallback: false });
      expect(provider.prompts.at(-1)?.backgroundFacts).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("архив") })]));
    } finally {
      await server.close();
    }
  }, 10_000);

  it("records a structured context diagnostic while preserving deterministic narration", async () => {
    const diagnostics: unknown[] = [];
    const projection = new WorldProjector();
    const runtime = {
      worldId: "context-error-world",
      bus: new EventBus(),
      projection,
      router: null,
      diagnostics: (event: unknown) => diagnostics.push(event),
      store: {
        getWorldRecord: () => { throw new Error("read-side profile unavailable"); },
      },
    } as any;
    const response = await handleWorldNarrativeLLM(runtime, new URL("http://localhost/narrative-llm"));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, usedFallback: true });
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "context", category: "context_error", outcome: "context_error", worldId: "context-error-world" }),
    ]));
  });
});
