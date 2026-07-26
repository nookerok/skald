import { describe, it, expect } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine, RuleRegistry, type ProjectionStore, type Rule, type DurableCommitter } from "@skald/rule-engine";
import type { CommitContext } from "@skald/rule-engine";

interface TestWorld { count: number; eventNumber: number }
function frozen(w: TestWorld): TestWorld { return Object.freeze({ ...w }) as TestWorld; }

class CountStore implements ProjectionStore<TestWorld> {
  private state: TestWorld;
  constructor(state: TestWorld) { this.state = { ...state }; }
  getSnapshot(): TestWorld { return frozen(this.state); }
  apply(event: DomainEvent): void {
    this.state = { ...this.state, eventNumber: this.state.eventNumber + 1 };
    if (event.type === "Count") {
      const { amount } = event.payload as { amount: number };
      this.state = { ...this.state, count: this.state.count + amount };
    }
  }
  clone(): ProjectionStore<TestWorld> { return new CountStore(this.state); }
}

function evt(type: string, eventId: string, payload: unknown = {}, causationId: string | null = null): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 1, correlationId: "cmd-1", causationId };
}

describe("RuleEngine — durable committer", () => {
  it("receives full staged batch on commit", () => {
    let committed: DomainEvent[] = [];
    const committer: DurableCommitter = (events) => { committed = [...events]; };

    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();

    const rule: Rule<TestWorld> = {
      id: "test.r", phase: "physics", listens: ["Start"], produces: ["Count"],
      handle: (event) => [evt("Count", "c-0", { amount: 3 }, event.eventId)],
    };
    registry.register(rule);
    const engine = new RuleEngine(registry, projection, bus, committer);

    engine.process(evt("Start", "start"), { commitContext: {} as CommitContext });

    expect(committed.length).toBe(2);
    expect(committed[0]!.eventId).toBe("start");
    expect(committed[1]!.eventId).toBe("c-0");
  });

  it("durable commit error leaves bus empty", () => {
    const committer: DurableCommitter = () => { throw new Error("db error"); };

    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();

    const rule: Rule<TestWorld> = {
      id: "test.r", phase: "physics", listens: ["Start"], produces: [],
      handle: () => [],
    };
    registry.register(rule);
    const engine = new RuleEngine(registry, projection, bus, committer);

    expect(() => engine.process(evt("Start", "start"), { commitContext: {} as CommitContext })).toThrow("db error");
    expect(bus.size()).toBe(0);
    expect(projection.getSnapshot().eventNumber).toBe(0);
  });

  it("Rule error does not call durable commit", () => {
    let committed = false;
    const committer: DurableCommitter = () => { committed = true; };

    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();

    const rule: Rule<TestWorld> = {
      id: "test.r", phase: "physics", listens: ["Start"], produces: [],
      handle: () => { throw new Error("rule error"); },
    };
    registry.register(rule);
    const engine = new RuleEngine(registry, projection, bus, committer);

    expect(() => engine.process(evt("Start", "start"), { commitContext: {} as CommitContext })).toThrow('Rule "test.r" threw');
    expect(committed).toBe(false);
    expect(bus.size()).toBe(0);
  });

  it("subscriber exception does not break commit", () => {
    const bus = new EventBus();
    bus.subscribe("Count", () => { throw new Error("subscriber error"); });

    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();
    const rule: Rule<TestWorld> = {
      id: "test.r", phase: "physics", listens: ["Start"], produces: ["Count"],
      handle: (event) => [evt("Count", "c-0", { amount: 1 }, event.eventId)],
    };
    registry.register(rule);
    const engine = new RuleEngine(registry, projection, bus);

    const result = engine.process(evt("Start", "start"));
    expect(result.committed.length).toBe(2);
    expect(bus.size()).toBe(2);
    expect(projection.getSnapshot().count).toBe(1);
  });

  it("processSequence drains multiple roots atomically", () => {
    let committed: DomainEvent[] = [];
    const committer: DurableCommitter = (events) => { committed = [...events]; };

    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();

    const decide: Rule<TestWorld> = {
      id: "test.decide", phase: "physics", listens: ["Start"], produces: ["Decided"],
      handle: (event) => [evt("Decided", `${event.eventId}>ok`, {}, event.eventId)],
    };
    registry.register(decide);

    const engine = new RuleEngine(registry, projection, bus, committer);

    const a = evt("Start", "start-a");
    const b = evt("Start", "start-b");
    const result = engine.processSequence([a, b], { commitContext: {} as CommitContext });

    expect(result.committed.map((e) => e.eventId)).toEqual(["start-a", "start-a>ok", "start-b", "start-b>ok"]);
    expect(committed.map((e) => e.eventId)).toEqual(["start-a", "start-a>ok", "start-b", "start-b>ok"]);
    expect(bus.size()).toBe(4);
  });
});
