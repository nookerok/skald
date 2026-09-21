import { describe, expect, it, vi } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { WorldProjector, buildMasterTurnSceneContext } from "@skald/world";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import type { MasterTurnSnapshot } from "../src/runtime/master-turn-gateway.js";
import { LIVE_INTENT_PHRASES, probeLiveIntentContract } from "../src/acceptance/live-intent-contract.js";

function event(type: string, eventId: string, payload: unknown, timestamp = 0): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "bootstrap", causationId: null };
}

function snapshot(): MasterTurnSnapshot {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const log = [
    event("PlayerSpawned", "boot-player", { x: 0, y: 0 }),
    event("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: ["fence"], connections: {},
    }),
    event("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }),
    event("WorldObjectPlaced", "boot-object-fence", {
      id: "fence", name: "Ограда", aliases: ["ограду", "оградой", "ограде"], description: "Почерневшая ограда.",
      material: "wood", locationId: "camp", integrity: 100, temperature: 20, state: {},
    }),
  ];
  for (const entry of log) { projection.apply(entry); bus.append(entry); }
  const events = bus.query();
  const world = projection.getSnapshot();
  return { events, world, scene: buildMasterTurnSceneContext(events, world), conversation: buildMasterConversationContext([], "test-world") };
}

const ACTION_PROPOSAL = JSON.stringify({
  schemaVersion: 2,
  kind: "action",
  primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваюсь" },
  supportingClauses: [],
  referents: [],
});

describe("live intent contract probe (plan: real acceptance)", () => {
  it("exposes the plan's three live phrases", () => {
    expect(LIVE_INTENT_PHRASES).toEqual([
      "я осматриваюсь",
      "подхожу к ограде",
      "подхожу к ограде и осматриваю двор, что я вижу?",
    ]);
  });

  it("resolves the deterministic phrases without a provider", async () => {
    const report = await probeLiveIntentContract(snapshot(), null, { timeoutMs: 50 });
    expect(report.pass).toBe(false);
    expect(report.status).toBe("unavailable");
    // Ambient observe and approach need no model and never fall back.
    expect(report.phrases[0]!.ok).toBe(true);
    expect(report.phrases[1]!.ok).toBe(true);
    expect(report.phrases.every((entry) => !entry.genericFallback)).toBe(true);
    // Without a router the narration route cannot be proven.
    expect(report.narration.ok).toBe(false);
  });

  it("passes with a live router that answers both routes", async () => {
    const router = {
      apiKey: "test",
      chat: vi.fn(async (category: string) => category === "narrate"
        ? { text: "Тихая переправа ждёт рассвета." }
        : { text: ACTION_PROPOSAL }),
    } as any;
    const report = await probeLiveIntentContract(snapshot(), router, { timeoutMs: 50 });
    expect(report.pass).toBe(true);
    expect(report.status).toBe("ready");
    expect(report.phrases.every((entry) => entry.ok)).toBe(true);
    expect(report.phrases.every((entry) => !entry.genericFallback)).toBe(true);
    expect(report.narration.ok).toBe(true);
    // Deterministic phrases must not need the model.
    const interpretCalls = router.chat.mock.calls.filter((call: any[]) => call[0] === "interpret").length;
    expect(interpretCalls).toBeLessThanOrEqual(1);
  });
});
