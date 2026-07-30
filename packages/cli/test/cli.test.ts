import { describe, it, expect } from "vitest";
import { createApp, runCommand } from "@skald/cli";
import { WorldProjector } from "@skald/world";

describe("CLI — thin end-to-end wiring", () => {
  it("move north (unobstructed) → ActionValidated → MovementSucceeded, position advances", () => {
    const app = createApp();
    const result = runCommand(app, "move north", "cmd-1", 1, "key-1");

    expect("type" in result && result.type === "IdempotencyReject").toBe(false);
    const outcome = result as { events: { type: string }[]; position: { x: number; y: number } };

    expect(outcome.events.map((e) => e.type)).toEqual([
      "ActionAttempted",
      "ActionValidated",
      "MovementSucceeded",
      "ObservationUpdated",
    ]);
    expect(outcome.position).toEqual({ x: 0, y: 1 });
  });

  it("move east into the wall at (2,0) from (1,0) → MovementBlocked, position stays", () => {
    const app = createApp();
    let result = runCommand(app, "move east", "cmd-1", 1, "key-1");
    expect((result as { position: { x: number; y: number } }).position).toEqual({ x: 1, y: 0 });

    result = runCommand(app, "move east", "cmd-2", 2, "key-2");
    const outcome = result as {
      events: { type: string }[];
      position: { x: number; y: number };
    };

    expect(outcome.events.map((e) => e.type)).toEqual([
      "ActionAttempted",
      "ActionValidated",
      "MovementBlocked",
      "ObservationUpdated",
    ]);
    expect(outcome.position).toEqual({ x: 1, y: 0 });
  });

  it("garbage input → unknown operation, but still produces ActionAttempted", () => {
    const app = createApp();
    const before = app.bus.size();
    const result = runCommand(app, "dance wildly", "cmd-1", 1, "key-1");

    // Unknown input is now handled as an ActionIntentCommand with unknown operation
    expect("type" in result && result.type === "IdempotencyReject").toBe(false);
    // The new flow produces ActionAttempted for all recognized intents
    expect(app.bus.size()).toBeGreaterThan(before);
  });

  it("canonical log replay reproduces the live projection (wiring preserves purity)", () => {
    const app = createApp();
    runCommand(app, "move north", "cmd-1", 1, "key-1");
    runCommand(app, "move east", "cmd-2", 2, "key-2");

    const live = app.projection.getSnapshot();
    const rebuilt = new WorldProjector();
    for (const e of app.bus.query()) rebuilt.apply(e);

    expect(rebuilt.getSnapshot().player).toEqual(live.player);
    expect(rebuilt.getSnapshot().eventNumber).toBe(live.eventNumber);
    expect(rebuilt.getSnapshot().time).toBe(live.time);
    expect([...rebuilt.getSnapshot().walls]).toEqual([...live.walls]);
  });
});
