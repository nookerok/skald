import { startServer } from "./http-server.js";
import { existsSync } from "node:fs";

const host = process.env["SKALD_HOST"] ?? "127.0.0.1";
const port = parseInt(process.env["SKALD_PORT"] ?? "3000", 10);
const dbPath = process.env["SKALD_DB_PATH"] ?? "/home/nook/skald-data/events.sqlite";

const server = await startServer({ host, port, dbPath });

process.stdout.write(`Skald server started\n`);
process.stdout.write(`  Host: ${server.url}\n`);
process.stdout.write(`  DB:   ${dbPath} (${existsSync(dbPath) ? "exists" : "new"})\n`);
process.stdout.write(`  PID:  ${process.pid}\n`);
process.stdout.write(`  Press Ctrl-C to stop\n`);

const shutdown = async (signal: string) => {
  process.stdout.write(`\nReceived ${signal}, shutting down...\n`);
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
