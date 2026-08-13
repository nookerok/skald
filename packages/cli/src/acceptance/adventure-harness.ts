import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer, type StartedServer } from "../http-server.js";
import { evaluateAdventureChecks } from "./adventure-checks.js";
import { buildAdventureReport } from "./adventure-report.js";
import { FixedNarrationProvider } from "./fixed-narration-provider.js";
import type {
  AdventureScenario,
  AdventureSnapshot,
  AdventureStep,
  AdventureStepResult,
  AdventureRunResult,
} from "./adventure-types.js";

type Json = Record<string, unknown>;

function asJson(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

async function readResponse(response: Response): Promise<Json> {
  const parsed = await response.json() as unknown;
  return asJson(parsed);
}

export class AdventureHarness {
  readonly dbDir: string;
  readonly dbPath: string;
  readonly worldId: string;
  private server: StartedServer | null = null;
  private requestIndex = 0;
  private restartBefore: AdventureSnapshot | undefined;
  private offlineStart: AdventureSnapshot | undefined;
  private lastCommand: { readonly input: string; readonly idempotencyKey: string } | undefined;
  private idempotencyPassed = false;
  private previousIntentMode: string | undefined;
  private initial: AdventureSnapshot = {};
  private latest: AdventureSnapshot = {};
  private readonly results: AdventureStepResult[] = [];

  constructor(private readonly scenario: AdventureScenario) {
    this.dbDir = mkdtempSync(join(tmpdir(), "skald-adventure-"));
    this.dbPath = join(this.dbDir, "events.sqlite");
    this.worldId = scenario.worldId;
  }

  async start(): Promise<void> {
    this.previousIntentMode ??= process.env["SKALD_INTENT_LLM_MODE"];
    process.env["SKALD_INTENT_LLM_MODE"] = "off";
    this.server = await startServer({ host: "127.0.0.1", port: 0, dbPath: this.dbPath, router: new FixedNarrationProvider() });
  }

  async close(): Promise<void> {
    if (this.server) await this.server.close();
    this.server = null;
  }

  async dispose(): Promise<void> {
    await this.close();
    if (this.previousIntentMode === undefined) delete process.env["SKALD_INTENT_LLM_MODE"];
    else process.env["SKALD_INTENT_LLM_MODE"] = this.previousIntentMode;
    rmSync(this.dbDir, { recursive: true, force: true });
  }

  private async request(path: string, init?: RequestInit): Promise<{ statusCode: number; body: Json }> {
    if (!this.server) throw new Error("adventure server is not running");
    const response = await fetch(this.server.url + path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    return { statusCode: response.status, body: await readResponse(response) };
  }

  private key(prefix: string): string {
    this.requestIndex += 1;
    return `acceptance:${this.scenario.name}:${prefix}:${this.requestIndex}`;
  }

  private async capture(): Promise<AdventureSnapshot> {
    // Narration is intentionally asynchronous in production; settle the read side
    // before comparing restart/replay snapshots.
    await new Promise((resolve) => setTimeout(resolve, 10));
const get = async (path: string): Promise<Json> => (await this.request(path)).body;
    const getAllEvents = async (): Promise<Json> => {
      const collected: Json[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await get(`/api/worlds/${this.worldId}/events?limit=200&offset=${offset}`);
        const rows = Array.isArray(page.events) ? page.events as Json[] : [];
        collected.push(...rows);
        if (rows.length < 200) return { ok: true, events: collected, count: collected.length };
      }
    };
    const [state, shell, map, journal, discoveries, presence, observerThreads, events] = await Promise.all([
      get(`/api/worlds/${this.worldId}/state`),
      get(`/api/worlds/${this.worldId}/game-shell`),
      get(`/api/worlds/${this.worldId}/map`),
      get(`/api/worlds/${this.worldId}/journal?limit=50`),
      get(`/api/worlds/${this.worldId}/discoveries`),
      get(`/api/worlds/${this.worldId}/presence`),
            get(`/api/worlds/${this.worldId}/observer-threads`),
      getAllEvents(),
    ]);
    const snapshot: AdventureSnapshot = {
      state,
      shell,
      map,
      journal,
      discoveries,
      presence,
            observerThreads,
      events: Array.isArray(events.events) ? events.events as Json[] : [],
    };
    this.latest = snapshot;
    return snapshot;
  }

  async createWorld(): Promise<void> {
    const result = await this.request("/api/worlds", {
      method: "POST",
      body: JSON.stringify({
        worldId: this.worldId,
        idempotencyKey: this.key("create"),
        saveLabel: this.scenario.saveLabel,
        characterName: this.scenario.characterName,
        characterPresetId: this.scenario.characterPresetId,
        worldTemplateId: this.scenario.worldTemplateId,
      }),
    });
    if (result.statusCode !== 201 && result.statusCode !== 200) throw new Error(`world creation failed: ${result.statusCode}`);
    this.initial = await this.capture();
  }

  async say(input: string): Promise<{ statusCode: number; body: Json }> {
    const idempotencyKey = this.key("say");
    this.lastCommand = { input, idempotencyKey };
    const result = await this.request(`/api/worlds/${this.worldId}/command`, {
      method: "POST",
      body: JSON.stringify({ input, idempotencyKey }),
    });
    return result;
  }

  async advanceOffline(ticks: number): Promise<{ statusCode: number; body: Json }> {
    this.offlineStart = this.latest;
    const idempotencyKey = this.key("offline");
    this.lastCommand = { input: `advance ${ticks}`, idempotencyKey };
    return this.request(`/api/worlds/${this.worldId}/command`, {
      method: "POST",
      body: JSON.stringify({ input: "advance " + ticks, idempotencyKey }),
    });
  }

  async offlineCommand(input: string): Promise<{ statusCode: number; body: Json }> {
    const state = asJson(this.latest.state?.state);
    const revision = typeof state.eventNumber === "number" ? state.eventNumber : 0;
    return this.request(`/api/worlds/${this.worldId}/offline-command`, {
      method: "POST",
      body: JSON.stringify({ input, idempotencyKey: this.key("offline-intent"), baseRevision: revision }),
    });
  }

  async acknowledge(): Promise<{ statusCode: number; body: Json }> {
    const presence = asJson(this.latest.presence?.presence);
    const revision = asJson(presence.revision);
    return this.request(`/api/worlds/${this.worldId}/presence/acknowledge`, {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: this.key("ack"),
        worldTime: revision.worldTime,
        eventNumber: revision.eventNumber,
      }),
    });
  }

  async continueWorld(): Promise<{ statusCode: number; body: Json }> {
    const result = await this.request("/api/continue");
    if (result.statusCode === 200) await this.capture();
    return result;
  }

  async enterPresence(): Promise<{ statusCode: number; body: Json }> {
    return this.request(`/api/worlds/${this.worldId}/observer-session`);
  }

  async answerClarification(input: string): Promise<{ statusCode: number; body: Json }> {
    return this.say(input);
  }

  async disconnect(): Promise<void> {
    await this.close();
  }

  async getGameShell(): Promise<Json> {
    return (await this.request(`/api/worlds/${this.worldId}/game-shell`)).body;
  }

  async getMap(): Promise<Json> {
    return (await this.request(`/api/worlds/${this.worldId}/map`)).body;
  }

  async getJournal(): Promise<Json> {
    return (await this.request(`/api/worlds/${this.worldId}/journal?limit=50`)).body;
  }

  async getPresence(): Promise<Json> {
    return (await this.request(`/api/worlds/${this.worldId}/presence`)).body;
  }

  async getDiscoveries(): Promise<Json> {
    return (await this.request(`/api/worlds/${this.worldId}/discoveries`)).body;
  }

  async getObserverThreads(): Promise<Json> {
    return (await this.request(`/api/worlds/${this.worldId}/observer-threads`)).body;
  }
  async acknowledgePresence(): Promise<{ statusCode: number; body: Json }> {
    return this.acknowledge();
  }

  async restart(): Promise<void> {
    this.restartBefore = this.latest;
    await this.close();
    await this.start();
  }

  async reconnect(): Promise<void> {
    await this.capture();
  }

  async run(): Promise<AdventureRunResult> {
    await this.start();
    await this.createWorld();
    try {
      for (let index = 0; index < this.scenario.turns.length; index += 1) {
        const step = this.scenario.turns[index]!;
        const outcome = await this.runStep(step);
        const snapshot = "disconnect" in step ? this.latest : await this.capture();
        const failures = "assert" in step
          ? evaluateAdventureChecks(step.assert, this.context(snapshot))
          : [];
        this.results.push({ index, step, statusCode: outcome.statusCode, body: outcome.body, snapshot, failures });
      }
      await this.probeIdempotency();
      const report = buildAdventureReport(this.context(this.latest), this.idempotencyPassed);
      return { scenario: this.scenario, steps: [...this.results], report };
    } finally {
      await this.dispose();
    }
  }

  private async probeIdempotency(): Promise<void> {
    if (!this.lastCommand) return;
    const replay = await this.request(`/api/worlds/${this.worldId}/command`, {
      method: "POST",
      body: JSON.stringify(this.lastCommand),
    });
    this.idempotencyPassed = replay.statusCode === 409 && replay.body.error !== undefined;
  }

  private context(current: AdventureSnapshot) {
    return {
      scenario: this.scenario,
      steps: [...this.results],
      current,
      initial: this.initial,
      ...(this.restartBefore ? { restartBefore: this.restartBefore } : {}),
      events: current.events ?? [],
      previousClarification: this.results.at(-1)?.body.status === "clarification",
      ...(this.offlineStart ? { offlineStart: this.offlineStart } : {}),
    };
  }

  private async runStep(step: AdventureStep): Promise<{ statusCode: number; body: Json }> {
    if ("say" in step) return this.say(step.say);
    if ("choose" in step) return this.say(step.choose);
    if ("answerClarification" in step) return this.answerClarification(step.answerClarification);
    if ("offlineTicks" in step) return this.advanceOffline(step.offlineTicks);
    if ("acknowledge" in step) return this.acknowledgePresence();
    if ("restartServer" in step) { await this.restart(); return { statusCode: 200, body: { ok: true, restarted: true } }; }
    if ("reconnect" in step) { await this.reconnect(); return { statusCode: 200, body: { ok: true, reconnected: true } }; }
    if ("continueWorld" in step) return this.continueWorld();
    if ("enterPresence" in step) return this.enterPresence();
    if ("disconnect" in step) { await this.disconnect(); return { statusCode: 200, body: { ok: true, disconnected: true } }; }
    if ("inspect" in step) {
      const body = step.inspect === "shell" ? await this.getGameShell()
        : step.inspect === "map" ? await this.getMap()
        : step.inspect === "journal" ? await this.getJournal()
        : step.inspect === "discoveries" ? await this.getDiscoveries()
        : await this.request(`/api/worlds/${this.worldId}/presence`).then((result) => result.body);
      return { statusCode: 200, body: { ok: true, inspected: step.inspect, data: body } };
    }
    return { statusCode: 200, body: { ok: true } };
  }
}

export async function runAdventureScenario(scenario: AdventureScenario): Promise<AdventureRunResult> {
  return new AdventureHarness(scenario).run();
}
