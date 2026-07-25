import { describe, it, expect } from "vitest";
import {
  EventBus,
  type DomainEvent,
} from "@skald/event-bus";
import {
  RuleEngine,
  RuleRegistry,
  MAX_ITERATIONS,
  type ProjectionStore,
  type Rule,
  RuleProcessingError,
  MaxIterationsExceededError,
} from "@skald/rule-engine";

// ---- Minimal test-only fixtures -------------------------------------------

interface TestWorld {
  count: number;
  eventNumber: number;
}

function frozen(w: TestWorld): TestWorld {
  return Object.freeze({ ...w }) as TestWorld;
}

class CountStore implements ProjectionStore<TestWorld> {
  private state: TestWorld;
  constructor(state: TestWorld) {
    this.state = { ...state };
  }
  getSnapshot(): TestWorld {
    return frozen(this.state);
  }
  apply(event: DomainEvent): void {
    this.state = { ...this.state, eventNumber: this.state.eventNumber + 1 };
    if (event.type === "Count") {
      const amount = (event.payload as { amount: number }).amount;
      this.state = { ...this.state, count: this.state.count + amount };
    }
  }
  clone(): ProjectionStore<TestWorld> {
    return new CountStore(this.state);
  }
}

function evt(
  type: string,
  eventId: string,
  payload: unknown = {},
  causationId: string | null = null,
): DomainEvent {
  return {
    eventId,
    type,
    schemaVersion: 1,
    payload,
    timestamp: 1,
    correlationId: "cmd-1",
    causationId,
  };
}

function decideRule(): Rule<TestWorld> {
  return {
    id: "test.decide",
    phase: "physics",
    listens: ["StartRequested"],
    produces: ["DecidedOk", "DecidedNo"],
    handle: (event) => {
      const choice = (event.payload as { choice: string }).choice;
      if (choice === "ok") {
        return [evt("DecidedOk", "ok-0", { choice }, event.eventId)];
      }
      return [evt("DecidedNo", "no-0", { choice }, event.eventId)];
    },
  };
}

function followupRule(): Rule<TestWorld> {
  return {
    id: "test.followup",
    phase: "consequence",
    listens: ["DecidedOk"],
    produces: ["Count"],
    handle: (event) =>
      [evt("Count", "count-0", { amount: 1 }, event.eventId)],
  };
}

// --------------------------------------------------------------------------

describe("RuleEngine — queue drains to empty (success + block-style)", () => {
  it("processes a two-event success chain and commits atomically", () => {
    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();
    registry.register(decideRule());
    const engine = new RuleEngine(registry, projection, bus);

    const result = engine.process(evt("StartRequested", "start", { choice: "ok" }));

    expect(result.committed.map((e) => e.type)).toEqual([
      "StartRequested",
      "DecidedOk",
    ]);
    expect(bus.query().map((e) => e.eventId)).toEqual(["start", "ok-0"]);
    expect(projection.getSnapshot().eventNumber).toBe(2);
  });

  it("processes a blocked-style outcome the same way", () => {
    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();
    registry.register(decideRule());
    const engine = new RuleEngine(registry, projection, bus);

    const result = engine.process(evt("StartRequested", "start", { choice: "no" }));

    expect(result.committed.map((e) => e.type)).toEqual([
      "StartRequested",
      "DecidedNo",
    ]);
    expect(bus.size()).toBe(2);
  });

  it("drains a multi-level chain (StartRequested → DecidedOk → Count)", () => {
    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();
    registry.register(decideRule());
    registry.register(followupRule());
    const engine = new RuleEngine(registry, projection, bus);

    const result = engine.process(evt("StartRequested", "start", { choice: "ok" }));

    expect(result.committed.map((e) => e.type)).toEqual([
      "StartRequested",
      "DecidedOk",
      "Count",
    ]);
    expect(projection.getSnapshot().eventNumber).toBe(3);
    expect(projection.getSnapshot().count).toBe(1);
    expect(bus.size()).toBe(3);
  });
});

describe("RuleEngine — engineering errors roll back the transaction", () => {
  it("a thrown rule commits nothing to the canonical log", () => {
    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();
    registry.register(decideRule());

    const boom: Rule<TestWorld> = {
      id: "test.boom",
      phase: "notification",
      listens: ["DecidedOk"],
      produces: [],
      handle: () => {
        throw new Error("boom");
      },
    };
    registry.register(boom);

    const engine = new RuleEngine(registry, projection, bus);

    let thrown: RuleProcessingError | null = null;
    try {
      engine.process(evt("StartRequested", "start", { choice: "ok" }));
    } catch (e) {
      if (!(e instanceof RuleProcessingError)) throw e;
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RuleProcessingError);
    expect(thrown!.failedRuleId).toBe("test.boom");
    expect(thrown!.failedEventType).toBe("DecidedOk");

    expect(bus.size()).toBe(0);
    expect(projection.getSnapshot().eventNumber).toBe(0);
    expect(projection.getSnapshot().count).toBe(0);
  });
});

describe("RuleEngine — max iterations guard", () => {
  it("aborts a non-terminating rule and commits nothing", () => {
    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();

    const loop: Rule<TestWorld> = {
      id: "test.loop",
      phase: "physics",
      listens: ["StartRequested"],
      produces: ["StartRequested"],
      handle: (event) =>
        [evt("StartRequested", `${event.eventId}-n`, {}, event.eventId)],
    };
    registry.register(loop);

    const engine = new RuleEngine(registry, projection, bus);

    let thrown: MaxIterationsExceededError | null = null;
    try {
      engine.process(evt("StartRequested", "start", {}));
    } catch (e) {
      if (!(e instanceof MaxIterationsExceededError)) throw e;
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(MaxIterationsExceededError);
    expect(thrown!.iterations).toBe(MAX_ITERATIONS + 1);
    expect(thrown!.queueDump.length).toBeGreaterThan(0);
    expect(bus.size()).toBe(0);
    expect(projection.getSnapshot().eventNumber).toBe(0);
  });
});

describe("RuleEngine — multi-rule same-phase independence (§12.3 + §9.10)", () => {
  it("two rules in the same phase both react to the same event independently", () => {
    const bus = new EventBus();
    const projection = new CountStore({ count: 0, eventNumber: 0 });
    const registry = new RuleRegistry<TestWorld>();

    const alpha: Rule<TestWorld> = {
      id: "test.alpha",
      phase: "consequence",
      listens: ["DecidedOk"],
      produces: ["Count"],
      handle: (event) =>
        [evt("Count", "count-a", { amount: 2 }, event.eventId)],
    };
    const beta: Rule<TestWorld> = {
      id: "test.beta",
      phase: "consequence",
      listens: ["DecidedOk"],
      produces: ["Count"],
      handle: (event) =>
        [evt("Count", "count-b", { amount: 3 }, event.eventId)],
    };
    registry.register(alpha);
    registry.register(beta);

    const decide: Rule<TestWorld> = {
      id: "test.decide",
      phase: "physics",
      listens: ["StartRequested"],
      produces: ["DecidedOk"],
      handle: (event) =>
        [evt("DecidedOk", "ok-0", { choice: "ok" }, event.eventId)],
    };
    registry.register(decide);

    const engine = new RuleEngine(registry, projection, bus);

    const result = engine.process(evt("StartRequested", "start", { choice: "ok" }));

    expect(result.committed.map((e) => e.type)).toEqual([
      "StartRequested",
      "DecidedOk",
      "Count",
      "Count",
    ]);
    // snapshot-consistency: both alpha and beta read the same snapshot,
    // then the working projection is updated once for each committed event.
    // The projection sees one Count event with amount 2 and one with amount 3.
    expect(projection.getSnapshot().count).toBe(5);
    expect(projection.getSnapshot().eventNumber).toBe(4);
    expect(bus.size()).toBe(4);
  });
});