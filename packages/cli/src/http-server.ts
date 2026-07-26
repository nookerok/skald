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
} from "./http-handlers.js";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const PUBLIC_DIR = resolve(__dirname, "../public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'";
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": CSP,
};

export interface StartedServer {
  readonly app: App;
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

function serveStatic(pathname: string, res: ServerResponse): void {
  const safePath = pathname.replace(/\.\./g, "");
  const filePath = resolve(PUBLIC_DIR, safePath.startsWith("/") ? safePath.slice(1) : safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, SECURITY_HEADERS);
    res.end("Not Found");
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", ...SECURITY_HEADERS });
  res.end(readFileSync(filePath));
}

export async function startServer(options?: {
  host?: string;
  port?: number;
  dbPath?: string;
  corsOrigin?: string;
}): Promise<StartedServer> {
  const app = createPersistentApp({ dbPath: options?.dbPath ?? undefined });
  const corsOrigin = options?.corsOrigin ?? process.env["SKALD_CORS_ORIGIN"] ?? "";
  const startTime = Date.now();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const writeJson = (statusCode: number, data: unknown) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...SECURITY_HEADERS,
      };
      if (corsOrigin) headers["Access-Control-Allow-Origin"] = corsOrigin;
      res.writeHead(statusCode, headers);
      res.end(JSON.stringify(data));
    };

    const writeError = (statusCode: number, code: string, message: string) => {
      writeJson(statusCode, { ok: false, error: { code, message } });
    };

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";

      // Static files
      if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        serveStatic("/index.html", res);
        return;
      }
      if (method === "GET" && url.pathname === "/app.js") {
        serveStatic("/app.js", res);
        return;
      }
      if (method === "GET" && url.pathname === "/styles.css") {
        serveStatic("/styles.css", res);
        return;
      }

      // API
      if (method === "GET" && url.pathname === "/api/state") {
        const result = handleState(app);
        res.writeHead(result.statusCode, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/command") {
        if (req.headers["content-type"] !== "application/json") {
          writeError(415, "unsupported_media_type", "Content-Type must be application/json");
          return;
        }
        let body: unknown;
        try { body = await readJsonBody(req); } catch {
          writeError(400, "invalid_request", "invalid or too large JSON body");
          return;
        }
        const result = await handleCommand(app, body);
        res.writeHead(result.statusCode, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/wait") {
        if (req.headers["content-type"] !== "application/json") {
          writeError(415, "unsupported_media_type", "Content-Type must be application/json");
          return;
        }
        let body: unknown;
        try { body = await readJsonBody(req); } catch {
          writeError(400, "invalid_request", "invalid or too large JSON body");
          return;
        }
        const result = await handleWait(app, body);
        res.writeHead(result.statusCode, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/narrative") {
        const result = handleNarrative(app, url);
        res.writeHead(result.statusCode, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/narrative-llm") {
        const result = await handleNarrativeLLM(app, url);
        res.writeHead(result.statusCode, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/events") {
        const result = handleEvents(app, url);
        res.writeHead(result.statusCode, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/health") {
        const result = handleHealth(app, startTime);
        res.writeHead(result.statusCode, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        res.end(result.body);
        return;
      }

      // 405 for known routes with wrong method
      const knownRoutes = ["/api/state", "/api/narrative", "/api/narrative-llm", "/api/events", "/api/health"];
      const knownPost = ["/api/command", "/api/wait"];
      if (knownRoutes.includes(url.pathname) || knownPost.includes(url.pathname)) {
        writeError(405, "method_not_allowed", "method not allowed");
        return;
      }

      writeError(404, "not_found", "not found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeError(500, "internal_error", msg);
    }
  });

  return new Promise<StartedServer>((resolve) => {
    server.listen(options?.port ?? 0, options?.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        app,
        server,
        url: `http://${options?.host ?? "127.0.0.1"}:${port}`,
        close: () => new Promise((res) => {
          server.close(() => {
            if (app.store) app.store.close();
            res();
          });
        }),
      });
    });
  });
}
