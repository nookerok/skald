import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPersistentApp, type App } from "./index.js";
import { readJsonBody } from "./http-body.js";
import {
  handleState,
  handleCommand,
  handleWait,
  handleNarrative,
  handleNarrativeLLM,
  handleEvents,
  handleHealth,
  handleJournal,
} from "./http-handlers.js";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const PUBLIC_DIR = resolve(__dirname, "../public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'";

function secHeaders(corsOrigin?: string): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CSP,
    "Cache-Control": "no-store",
  };
  if (corsOrigin) h["Access-Control-Allow-Origin"] = corsOrigin;
  return h;
}

export interface StartedServer {
  readonly app: App;
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

function serveStatic(pathname: string, res: ServerResponse, corsOrigin?: string): void {
  const safePath = pathname.replace(/\.\./g, "");
  const filePath = resolve(PUBLIC_DIR, safePath.startsWith("/") ? safePath.slice(1) : safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, secHeaders(corsOrigin));
    res.end("Not Found");
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", ...secHeaders(corsOrigin) });
  res.end(readFileSync(filePath));
}

function parseContentType(raw: string | undefined): string {
  if (!raw) return "";
  return raw.split(";")[0]!.trim().toLowerCase();
}

function writeJson(res: ServerResponse, statusCode: number, data: unknown, corsOrigin?: string): void {
  res.writeHead(statusCode, { "Content-Type": "application/json", ...secHeaders(corsOrigin) });
  res.end(JSON.stringify(data));
}

function writeError(res: ServerResponse, statusCode: number, code: string, message: string, corsOrigin?: string): void {
  writeJson(res, statusCode, { ok: false, error: { code, message } }, corsOrigin);
}

export async function startServer(options?: {
  host?: string;
  port?: number;
  dbPath?: string;
  corsOrigin?: string;
}): Promise<StartedServer> {
  const app = createPersistentApp({ dbPath: options?.dbPath ?? undefined });
  const startTime = Date.now();
  const corsOrigin = options?.corsOrigin ?? process.env["SKALD_CORS_ORIGIN"] ?? "";
  let closed = false;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const handle = (s: number, d: unknown) => writeJson(res, s, d, corsOrigin);
    const errHandle = (s: number, c: string, m: string) => writeError(res, s, c, m, corsOrigin);
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";

      // CORS preflight
      if (corsOrigin && method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          ...secHeaders(corsOrigin),
        });
        res.end();
        return;
      }

      if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        serveStatic("/index.html", res, corsOrigin);
        return;
      }
      if (method === "GET" && (url.pathname === "/app.js" || url.pathname === "/api-client.js" || url.pathname === "/presentation-view.js" || url.pathname === "/journal-view.js")) {
        serveStatic(url.pathname, res, corsOrigin);
        return;
      }
      if (method === "GET" && url.pathname === "/styles.css") {
        serveStatic("/styles.css", res, corsOrigin);
        return;
      }

      if (method === "GET" && url.pathname === "/api/state") {
        const r = handleState(app);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      if (method === "POST" && url.pathname === "/api/command") {
        if (parseContentType(req.headers["content-type"]) !== "application/json") {
          errHandle(415, "unsupported_media_type", "Content-Type must be application/json");
          return;
        }
        let body: unknown;
        try { body = await readJsonBody(req); } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          errHandle(msg.includes("too large") ? 413 : 400, "invalid_request", msg.includes("too large") ? "body too large" : "invalid JSON body");
          return;
        }
        const r = await handleCommand(app, body);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      if (method === "POST" && url.pathname === "/api/wait") {
        if (parseContentType(req.headers["content-type"]) !== "application/json") {
          errHandle(415, "unsupported_media_type", "Content-Type must be application/json");
          return;
        }
        let body: unknown;
        try { body = await readJsonBody(req); } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          errHandle(msg.includes("too large") ? 413 : 400, "invalid_request", msg.includes("too large") ? "body too large" : "invalid JSON body");
          return;
        }
        const r = await handleWait(app, body);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      if (method === "GET" && url.pathname === "/api/narrative") {
        const r = handleNarrative(app, url);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      if (method === "GET" && url.pathname === "/api/narrative-llm") {
        const r = await handleNarrativeLLM(app, url);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      if (method === "GET" && url.pathname === "/api/journal") {
        const r = handleJournal(app, url);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      if (method === "GET" && url.pathname === "/api/events") {
        const r = handleEvents(app, url);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      if (method === "GET" && url.pathname === "/api/health") {
        const r = handleHealth(app, startTime);
        handle(r.statusCode, JSON.parse(r.body));
        return;
      }

      // 405 for known routes with wrong method
      const getRoutes = ["/api/state", "/api/narrative", "/api/narrative-llm", "/api/events", "/api/health", "/api/journal"];
      const postRoutes = ["/api/command", "/api/wait"];
      if (getRoutes.includes(url.pathname) && method !== "GET") {
        errHandle(405, "method_not_allowed", "method not allowed");
      } else if (postRoutes.includes(url.pathname) && method !== "POST") {
        errHandle(405, "method_not_allowed", "method not allowed");
      } else {
        errHandle(404, "not_found", "not found");
      }
    } catch (err) {
      errHandle(500, "internal_error", "internal error");
    } finally {
      const poisoned = (app.engine as any).isPoisoned?.();
      if (poisoned) {
        setImmediate(() => { process.exit(1); });
      }
    }
  });

  return new Promise<StartedServer>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options?.port ?? 0, options?.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolvePromise({
        app,
        server,
        url: `http://${options?.host ?? "127.0.0.1"}:${port}`,
        close: () => new Promise((res) => {
          if (closed) { res(); return; }
          closed = true;
          server.close(() => {
            if (app.store) app.store.close();
            res();
          });
        }),
      });
    });
  });
}
