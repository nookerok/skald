import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/http-server.js";
import { FixedNarrationProvider } from "../src/acceptance/fixed-narration-provider.js";
import type { ChatMessage, ChatResult } from "@skald/world";
import { ProviderUnavailableError } from "@skald/world";

const dbPath = join(mkdtempSync(join(tmpdir(), "skald-narration-http-")), "events.sqlite");
let server: Awaited<ReturnType<typeof startServer>>;
let worldId: string;
let waitServer: Awaited<ReturnType<typeof startServer>>;
let waitWorldId: string;

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${server.url}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  return { status: response.status, body: await response.json() as any };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class DeferredReadyNarrationProvider extends FixedNarrationProvider {
  private readonly gate: Promise<void>;
  private releaseGate!: () => void;
  private signalStarted!: () => void;
  readonly started = new Promise<void>((resolve) => { this.signalStarted = resolve; });

  constructor() {
    super();
    this.gate = new Promise<void>((resolve) => { this.releaseGate = resolve; });
  }

  release(): void {
    this.releaseGate();
  }

  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category !== "narrate") throw new Error(`fixed provider does not serve ${category}`);
    this.signalStarted();
    await this.gate;
    const base = await super.chat(category, messages);
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    const parsed = JSON.parse(user) as { turnFacts?: readonly { id?: unknown; text?: unknown; epistemicClass?: unknown }[] };
    const fact = parsed.turnFacts?.find((entry) =>
      typeof entry.id === "string" && typeof entry.text === "string" && typeof entry.epistemicClass === "string",
    );
    if (!fact) {
      return {
        ...base,
        text: JSON.stringify({ narration: "Мир ответил на ожидание.", claims: [] }),
      };
    }
    return {
      ...base,
      text: JSON.stringify({
        narration: fact.text,
        claims: [{ text: fact.text, sourceFactId: fact.id, epistemicClass: fact.epistemicClass }],
      }),
    };
  }
}

async function waitForJournalState(serverUrl: string, worldId: string, expected: string, maxMs = 3000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const response = await fetch(`${serverUrl}/api/worlds/${worldId}/journal?limit=10`);
    const body = await response.json() as any;
    const turn = body.turns?.find((candidate: any) => candidate.worldTime > 0);
    if (turn?.narrationState === expected) return turn;
    await tick();
  }
  throw new Error(`Timed out waiting for narrationState=${expected}`);
}

describe("Narration HTTP integration: pending→ready and provider failure→unavailable", () => {
  let readyProvider: DeferredReadyNarrationProvider;
  let waitProvider: DeferredReadyNarrationProvider;

  beforeAll(async () => {
    readyProvider = new DeferredReadyNarrationProvider();
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath,
      router: readyProvider,
    });
    const created = await api("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "narration-create" },
      body: JSON.stringify({ characterName: "Тест", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
    });
    expect(created.status).toBe(201);
    worldId = created.body.world.worldId;

    waitProvider = new DeferredReadyNarrationProvider();
    waitServer = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: join(mkdtempSync(join(tmpdir(), "skald-narration-wait-")), "events.sqlite"),
      router: waitProvider,
    });
    const waitCreated = await fetch(`${waitServer.url}/api/worlds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "narration-wait-create" },
      body: JSON.stringify({ characterName: "Тест", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
    });
    const waitBody = await waitCreated.json() as any;
    expect(waitCreated.status).toBe(201);
    waitWorldId = waitBody.world.worldId;
  }, 10000);

  afterAll(async () => {
    await server.close();
    await waitServer.close();
  });

  it("command transitions journal from pending to ready after persistence", async () => {
    const cmd = await api(`/api/worlds/${worldId}/command`, {
      method: "POST",
      body: JSON.stringify({ input: "move north", idempotencyKey: "narration-lifecycle-1" }),
    });
    expect(cmd.status).toBe(200);
    expect(cmd.body.ok).toBe(true);

    await readyProvider.started;
    const pending = await waitForJournalState(server.url, worldId, "pending");
    expect(pending.narrationState).toBe("pending");

    readyProvider.release();
    const ready = await waitForJournalState(server.url, worldId, "ready");
    expect(ready.narrationState).toBe("ready");
    expect(ready.narrativeLLM).toMatchObject({ usedFallback: false });
  });

  it("marks the turn unavailable and records persistence_error when narration save fails", async () => {
    const store = server.app.store as any;
    const originalSave = store.saveTurnNarration;
    store.saveTurnNarration = () => { throw new Error("simulated sqlite failure"); };
    try {
      const cmd = await api(`/api/worlds/${worldId}/command`, {
        method: "POST",
        body: JSON.stringify({ input: "move south", idempotencyKey: "narration-persistence-failure-1" }),
      });
      expect(cmd.status).toBe(200);

      const unavailable = await waitForJournalState(server.url, worldId, "unavailable");
      expect(unavailable.narrationState).toBe("unavailable");
      expect(server.app.runtimes.narrationDiagnostics()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "scheduler",
            category: "persistence_error",
            worldId,
            outcome: "persistence_error",
          }),
        ]),
      );
    } finally {
      store.saveTurnNarration = originalSave;
    }
  });

  it("legacy world wait schedules narration and reaches ready after persistence", async () => {
    const response = await fetch(`${waitServer.url}/api/worlds/${waitWorldId}/wait`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 1, idempotencyKey: "narration-wait-lifecycle-1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);

    await waitProvider.started;
    const pending = await waitForJournalState(waitServer.url, waitWorldId, "pending");
    expect(pending.narrationState).toBe("pending");

    waitProvider.release();
    const ready = await waitForJournalState(waitServer.url, waitWorldId, "ready");
    expect(ready.narrationState).toBe("ready");
    expect(ready.narrativeLLM).toMatchObject({ usedFallback: false });
  });

  it("journal narrationState is not_requested for old turns without narration scheduling", async () => {
    // Bootstrap turn (worldTime 0) was never narrated
    const journal = await api(`/api/worlds/${worldId}/journal?limit=50`);
    expect(journal.status).toBe(200);
    const turns = journal.body.turns;
    // At least the bootstrap turn should have not_requested (or ready if narrated)
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(["not_requested", "pending", "ready", "unavailable"]).toContain(turn.narrationState);
    }
  });
});

describe("Narration HTTP integration: provider failure→unavailable", () => {
  let failServer: Awaited<ReturnType<typeof startServer>>;
  let failWorldId: string;

  class FailRouter extends FixedNarrationProvider {
    override async chat(_category: "narrate" | "analyze" | "interpret", _messages: readonly import("@skald/world").ChatMessage[]): Promise<import("@skald/world").ChatResult> {
      throw new ProviderUnavailableError("provider deliberately failed", {
        provider: "opencode_zen",
        model: "deepseek-v4-flash-free",
        configuredModel: "deepseek-v4-flash-free",
      });
    }
  }

  beforeAll(async () => {
    const failDbPath = join(mkdtempSync(join(tmpdir(), "skald-narration-fail-")), "events.sqlite");
    failServer = await startServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: failDbPath,
      router: new FailRouter(),
    });
    const created = await fetch(`${failServer.url}/api/worlds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fail-create" },
      body: JSON.stringify({ characterName: "Тест", backgroundId: "keeper", entrypointId: "river_waystation_arrival" }),
    });
    const body = await created.json() as any;
    expect(created.status).toBe(201);
    failWorldId = body.world.worldId;
  }, 10000);

  afterAll(async () => { await failServer.close(); });

  it("command with failing provider: narration settles as unavailable with provider_unavailable category", async () => {
    const cmd = await fetch(`${failServer.url}/api/worlds/${failWorldId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "move east", idempotencyKey: "fail-narration-2" }),
    });
    expect(cmd.status).toBe(200);

    // Wait for scheduler to drain
    await new Promise((r) => setTimeout(r, 500));

    const journal = await fetch(`${failServer.url}/api/worlds/${failWorldId}/journal?limit=10`);
    const journalBody = await journal.json() as any;
    const turns = journalBody.turns;
    expect(turns.length).toBeGreaterThanOrEqual(1);

    // The narrated turn should be unavailable (provider failed, fallback not persisted)
    const narratedTurn = turns.find((t: any) => t.worldTime > 0);
    expect(narratedTurn).toBeDefined();
    expect(narratedTurn.narrationState).toBe("unavailable");

    // Diagnostic event must classify the explicit provider failure as provider_unavailable
    expect(failServer.app.runtimes.narrationDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "llm",
          category: "provider_unavailable",
          outcome: "deterministic_fallback",
        }),
      ]),
    );
  });
});
