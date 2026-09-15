import { describe, expect, it, vi } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { WorldProjector, buildMasterTurnSceneContext } from "@skald/world";
import { isGenericFallbackText } from "@skald/intent-parser";
import { buildMasterConversationContext } from "../src/conversation/context-builder.js";
import {
  bindSpeakAddressee,
  interpretMasterTurn,
  type MasterTurnSnapshot,
} from "../src/runtime/master-turn-gateway.js";

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
      objectIds: [], connections: {},
    }),
    event("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }),
  ];
  for (const entry of log) {
    projection.apply(entry);
    bus.append(entry);
  }
  const events = bus.query();
  const world = projection.getSnapshot();
  const scene = buildMasterTurnSceneContext(events, world);
  const conversation = buildMasterConversationContext([], "test-world");
  return { events, world, scene, conversation };
}

function person(observerRef: string, label: string) {
  return { observerRef, kind: "person" as const, label, knownAs: [label] };
}

function snapshotWithPeople(people: ReturnType<typeof person>[]): MasterTurnSnapshot {
  const snap = snapshot();
  return {
    ...snap,
    scene: { ...snap.scene, context: { ...snap.scene.context, knownPeople: people } },
  };
}

function deadRouter() {
  return { chat: vi.fn(() => { throw new Error("model down"); }) } as any;
}

describe("bindSpeakAddressee", () => {
  const ferrymen = [person("person_1", "Перевозчик у переправы"), person("person_2", "Перевозчик у переправы")];
  it("binds a declined addressee to one display label, collapsing identical names", () => {
    const binding = bindSpeakAddressee("к перевозчику", ferrymen);
    expect(binding.status).toBe("unique");
    if (binding.status !== "unique") return;
    expect(binding.addressee.label).toBe("Перевозчик у переправы");
  });
  it("asks a naming question for distinct labels", () => {
    const binding = bindSpeakAddressee("к перевозчику", [
      person("person_1", "Перевозчик у переправы"),
      person("person_2", "Ночной перевозчик"),
    ]);
    expect(binding.status).toBe("ambiguous");
    if (binding.status !== "ambiguous") return;
    expect(binding.labels).toEqual(["Перевозчик у переправы", "Ночной перевозчик"]);
  });
  it("reports a bare greeting as unnamed absence", () => {
    expect(bindSpeakAddressee(null, ferrymen)).toEqual({ status: "absent", named: false });
    expect(bindSpeakAddressee("  ", ferrymen)).toEqual({ status: "absent", named: false });
  });
  it("treats a pronoun-only utterance as unnamed (pronoun path owns it)", () => {
    expect(bindSpeakAddressee("к нему", ferrymen)).toEqual({ status: "absent", named: false });
  });
  it("reports an unknown name as named absence", () => {
    expect(bindSpeakAddressee("к стражнику", ferrymen)).toEqual({ status: "absent", named: true });
    expect(bindSpeakAddressee("к перевозчику", [])).toEqual({ status: "absent", named: true });
  });
});

describe("degraded speak/call fallback (plan_9 §14 beat 4)", () => {
  const ferrymen = [person("person_1", "Перевозчик у переправы"), person("person_2", "Перевозчик у переправы")];
  it("executes speech to a known NPC after a model failure", async () => {
    const router = deadRouter();
    const result = await interpretMasterTurn("обратиться к перевозчику", snapshotWithPeople(ferrymen), router, { timeoutMs: 50 });
    expect(router.chat).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("deterministic");
    if (result.status !== "deterministic") return;
    expect(result.intent.type).toBe("ActionIntentCommand");
    if (result.intent.type !== "ActionIntentCommand") return;
    expect(result.intent.operation).toBe("speak");
    expect(result.intent.target?.raw).toBe("Перевозчик у переправы");
  });
  it("binds in mode off exactly like after a model failure", async () => {
    const result = await interpretMasterTurn("обратиться к перевозчику", snapshotWithPeople(ferrymen), null, { mode: "off" });
    expect(result.status).toBe("deterministic");
  });
  it("emits the speak_addressee_bound diagnostic on binding", async () => {
    const seen: string[] = [];
    const result = await interpretMasterTurn("обратиться к перевозчику", snapshotWithPeople(ferrymen), deadRouter(), {
      timeoutMs: 50,
      diagnostics: ((event: { category: string }) => { seen.push(event.category); }) as never,
    });
    expect(result.status).toBe("deterministic");
    expect(seen).toContain("speak_addressee_bound");
    expect(seen).not.toContain("generic_clarification_fallback");
  });
  it("names distinct candidates instead of the generic fallback", async () => {
    const result = await interpretMasterTurn("обратиться к перевозчику", snapshotWithPeople([
      person("person_1", "Перевозчик у переправы"),
      person("person_2", "Ночной перевозчик"),
    ]), deadRouter(), { timeoutMs: 50 });
    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(isGenericFallbackText(result.question)).toBe(false);
    expect(result.question).toContain("Перевозчик у переправы");
    expect(result.question).toContain("Ночной перевозчик");
  });
  it("clarifies a bare greeting specifically instead of the generic fallback", async () => {
    const result = await interpretMasterTurn("поздороваться", snapshotWithPeople(ferrymen), deadRouter(), { timeoutMs: 50 });
    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(isGenericFallbackText(result.question)).toBe(false);
    expect(result.options.length).toBeGreaterThan(0);
  });
  it("asks whom to address for a targetless appeal", async () => {
    const result = await interpretMasterTurn("обратиться", snapshotWithPeople(ferrymen), deadRouter(), { timeoutMs: 50 });
    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(isGenericFallbackText(result.question)).toBe(false);
    expect(result.question).toContain("Кого ты имеешь в виду?");
  });
  it("quotes an unknown addressee back instead of the generic fallback", async () => {
    const result = await interpretMasterTurn("позвать стражника", snapshotWithPeople(ferrymen), deadRouter(), { timeoutMs: 50 });
    expect(result.status).toBe("clarification");
    if (result.status !== "clarification") return;
    expect(isGenericFallbackText(result.question)).toBe(false);
    expect(result.question).toContain("стражника");
  });
});
