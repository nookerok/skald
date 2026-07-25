import * as readline from "node:readline";
import { createApp, runCommand, runTick } from "./index.js";
import type { DomainEvent } from "@skald/event-bus";

function formatEvent(e: DomainEvent): string {
  return `  [${e.type}] ${JSON.stringify(e.payload)} (id=${e.eventId})`;
}

function main(): void {
  const app = createApp();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  process.stdout.write("Living World MVP-0. Commands: move north/south/east/west, wait/advance N. Ctrl-D to quit.\n");
  process.stdout.write(`Player at ${JSON.stringify(app.projection.getSnapshot().player)}\n`);
  rl.prompt();

  let tick = app.projection.getSnapshot().time;

  rl.on("line", (line: string) => {
    const trimmed = line.trim().toLowerCase();

    // Meta-commands: wait / advance N
    if (trimmed === "wait") {
      const ts = tick + 1;
      const tickResult = runTick(app, ts, `tick-offline-${ts}`, true);
      tick = ts;
      process.stdout.write(`Tick ${ts} (offline):\n`);
      for (const e of tickResult.events) process.stdout.write(formatEvent(e) + "\n");
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("advance ")) {
      const n = parseInt(trimmed.slice(8), 10);
      if (!isNaN(n) && n > 0 && n <= 100) {
        for (let i = 0; i < n; i++) {
          const ts = tick + 1;
          const tickResult = runTick(app, ts, `tick-offline-${ts}`, true);
          tick = ts;
          if (tickResult.events.length > 0) {
            process.stdout.write(`Tick ${ts} (offline):\n`);
            for (const e of tickResult.events) process.stdout.write(formatEvent(e) + "\n");
          }
        }
      } else {
        process.stdout.write("Usage: advance <N> (1-100)\n");
      }
      rl.prompt();
      return;
    }

    const timestamp = tick + 1;
    const correlationId = `cmd-${timestamp}`;
    const idempotencyKey = `key-${timestamp}-${trimmed}`;
    const result = runCommand(app, line, correlationId, timestamp, idempotencyKey);

    if ("type" in result && result.type === "ParseError") {
      process.stdout.write(`Parse error: ${result.reason}\n`);
    } else if ("type" in result && result.type === "IdempotencyReject") {
      process.stdout.write("Duplicate command ignored.\n");
    } else {
      const outcome = result as { events: DomainEvent[]; position: { x: number; y: number } };
      tick = timestamp;
      process.stdout.write("Events:\n");
      for (const e of outcome.events) process.stdout.write(formatEvent(e) + "\n");
      process.stdout.write(`Player at ${JSON.stringify(outcome.position)}\n`);
      const obs = app.projection.getSnapshot().observations;
      if (obs.size > 0) {
        const parts: string[] = [];
        for (const [k, v] of obs) parts.push(`${k}=${v}`);
        process.stdout.write(`Observations: ${parts.join(", ")}\n`);
      }

      // Clock: emit TickPassed after every successful command
      const tickResult = runTick(app, timestamp, `tick-${timestamp}`);
      if (tickResult.events.length > 0) {
        process.stdout.write("Tick events:\n");
        for (const e of tickResult.events) process.stdout.write(formatEvent(e) + "\n");
      }

      const cons = app.projection.getSnapshot().consequences;
      if (cons.size > 0) {
        const cparts: string[] = [];
        for (const [, c] of cons) cparts.push(`${c.type}(exp=${c.expiresAt})`);
        process.stdout.write(`Consequences: ${cparts.join(", ")}\n`);
      }
    }
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write("\nbye.\n");
    process.exit(0);
  });
}

main();
