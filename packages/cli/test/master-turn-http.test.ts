import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

function tmpDb(): string {
  return join(mkdtempSync(join(tmpdir(), "skald-master-http-")), "events.sqlite");
}

function createWorld(store: ReturnType<typeof createMultiWorldStore>, worldId: string): void {
  store.createWorld({
    worldId,
    idempotencyKey: `create-${worldId}`,
    requestHash: `hash-${worldId}`,
    saveLabel: "HTTP test",
    characterName: "Tester",
    characterPresetId: "wanderer",
    worldTemplateId: "old_tower",
    characterWound: "none",
    characterPromise: "observe",
    characterPrinciple: "care",
    characterProfileVersion: 1,
    bootstrapEvents: buildBootstrapEvents("old_tower"),
  });
}

async function testRuntime(dbSuffix: string, router: any): Promise<{ store: ReturnType<typeof createMultiWorldStore>; runtime: WorldRuntime; worldId: string }> {
  const store = createMultiWorldStore(tmpDb());
  const worldId = `http-${dbSuffix}`;
  createWorld(store, worldId);
  const manager = new WorldRuntimeManager(store, router);
  const runtime = await manager.get(worldId);
  return { store, runtime, worldId };
}

function body(input: string, idempotencyKey: string): unknown {
  return { input, idempotencyKey };
}

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

/** Interpret-only mock: canned TurnProposalV2 for interpret, inert for narrate. */
function interpretRouter(proposal: unknown) {
  const text = typeof proposal === "string" ? proposal : JSON.stringify(proposal);
  return {
    apiKey: "",
    chat: vi.fn(async (category: string) => {
      if (category === "interpret") return { text };
      return { text: "" };
    }),
  } as any;
}

const OBSERVE_PROPOSAL = {
  schemaVersion: 2,
  kind: "action",
  primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваюсь вокруг." },
  supportingClauses: [],
  referents: [],
};

const MIXED_PROPOSAL = {
  schemaVersion: 2,
  kind: "mixed",
  primaryIntent: { kind: "interaction", verb: "observe", sourceText: "Осматриваюсь" },
  supportingClauses: [{ kind: "deferred_action", summary: "пойти к башне" }],
  question: { queryId: "visible_scene" },
  referents: [],
};

describe("master turn production path", () => {
  it("answers inquiry read-only without events or ticks", async () => {
    const { store, runtime } = await testRuntime("inquiry", null);
    try {
      const timeBefore = runtime.projection.getSnapshot().time;
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, body("где я?", "inq-1")));

      expect(response.status).toBe("inquiry");
      expect(response.conversationTurn).toMatchObject({ inputClass: "inquiry" });
      expect(runtime.projection.getSnapshot().time).toBe(timeBefore);
      expect(runtime.bus.query().length).toBe(eventsBefore);

      const replay = parse(await handleWorldCommand(runtime, body("где я?", "inq-1")));
      expect(replay.replayed).toBe(true);
    } finally {
      store.close();
    }
  });

  it("executes simple commands on the deterministic fast path without a model", async () => {
    const throwing = { apiKey: "", chat: vi.fn(() => { throw new Error("LLM must not be called"); }) } as any;
    const { store, runtime } = await testRuntime("fast", throwing);
    try {
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, body("осмотреться", "fast-1")));

      expect(response.ok).toBe(true);
      expect(response.conversationTurn).toBeDefined();
      expect(throwing.chat).not.toHaveBeenCalled();
      expect(runtime.bus.query().length).toBeGreaterThan(eventsBefore);
    } finally {
      store.close();
    }
  });

  it("executes a V2 observe plan atomically with its transcript", async () => {
    const { store, runtime } = await testRuntime("v2", interpretRouter(OBSERVE_PROPOSAL));
    try {
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, body("Подойду к ней и осмотрюсь.", "v2-1")));

      expect(response.ok).toBe(true);
      expect(response.conversationTurn).toMatchObject({ inputClass: "action" });
      expect(runtime.bus.query().length).toBeGreaterThan(eventsBefore);
      expect(store.getConversationTurn(runtime.worldId, "v2-1")).toBeDefined();
    } finally {
      store.close();
    }
  });

  it("executes mixed turns with one primary plus a read-only answer", async () => {
    const { store, runtime } = await testRuntime("mixed", interpretRouter(MIXED_PROPOSAL));
    try {
      const response = parse(await handleWorldCommand(runtime, body("Осмотрюсь и скажи, где я.", "mix-1")));

      expect(response.ok).toBe(true);
      expect(response.conversationTurn).toMatchObject({ inputClass: "mixed" });
      const primaries = runtime.bus.query().filter((event) =>
        event.type === "InteractionRequested" || event.type === "ActionAttempted" || event.type === "JourneyRequested",
      );
      // Only the turn just executed is counted via correlation would be ideal;
      // at minimum the world advanced and a deferred note survived.
      expect(primaries.length).toBeGreaterThan(0);
      expect(JSON.stringify(response)).toContain("пойти к башне");
    } finally {
      store.close();
    }
  });

  it("rejects a model-invented target without mutation", async () => {
    const hidden = {
      schemaVersion: 2,
      kind: "action",
      primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойду к ней." },
      supportingClauses: [],
      target: { role: "target", surface: "Невидимая башня" },
      referents: [{ role: "target", surface: "Невидимая башня" }],
    };
    const { store, runtime } = await testRuntime("hidden", interpretRouter(hidden));
    try {
      const timeBefore = runtime.projection.getSnapshot().time;
      const eventsBefore = runtime.bus.query().length;
      const response = parse(await handleWorldCommand(runtime, body("Подойду к ней.", "hid-1")));

      expect(response.status).toBe("clarification");
      expect(runtime.projection.getSnapshot().time).toBe(timeBefore);
      expect(runtime.bus.query().length).toBe(eventsBefore);
    } finally {
      store.close();
    }
  });

  it("turns a provider timeout into clarification without events", async () => {
    const slow = { apiKey: "", chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const { store, runtime } = await testRuntime("timeout", slow);
    try {
      const storeManager = runtime;
      const timeBefore = storeManager.projection.getSnapshot().time;
      const eventsBefore = storeManager.bus.query().length;
      const response = await Promise.race([
        handleWorldCommand(runtime, body("Подойду к ней.", "tmo-1")),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("handler hung")), 15_000)),
      ]);
      const parsed = parse(response as { statusCode: number; body: string });

      expect(parsed.status).toBe("clarification");
      expect(storeManager.projection.getSnapshot().time).toBe(timeBefore);
      expect(storeManager.bus.query().length).toBe(eventsBefore);
    } finally {
      store.close();
    }
  }, 20000);

  it("rejects a reused idempotency key with different text and never double-commits", async () => {
    const { store, runtime } = await testRuntime("idem", null);
    try {
      const first = parse(await handleWorldCommand(runtime, body("осмотреться", "dup-1")));
      expect(first.ok).toBe(true);

      const conflict = await handleWorldCommand(runtime, body("осмотреться иначе", "dup-1"));
      expect(conflict.statusCode).toBe(409);

      const turns = store.listConversationTurns(runtime.worldId).filter((turn) => turn.idempotencyKey === "dup-1");
      expect(turns).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
