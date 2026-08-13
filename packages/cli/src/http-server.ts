import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createMultiWorldStore, type MultiWorldStore } from "./persistence/index.js";
import { WorldRuntimeManager } from "./runtime/index.js";
import { readJsonBody } from "./http-body.js";
import {
  handleWorlds,
  handleContinue,
  handleCharacterPresets,
  handleWorldTemplates,
  handleCreateWorld,
} from "./http/catalog-handlers.js";
import {
  handleWorldState,
  handleWorldCommand,
  handleWorldWait,
  handleOfflineCommand,
  handleWorldJournal,
  handleWorldDiscoveries,
  handleWorldGuidance,
  handleWorldNarrative,
  handleWorldEvents,
  handleWorldGameShell,
  handleWorldBeliefModel,
  handleObserverSession,
  handleObserverThreads,
  handleWorldPresence,
  handleWorldMap,
  mapDetailIsAvailable,
  handlePresenceAcknowledge,
} from "./http/world-handlers.js";
import { LEGACY_WORLD_ID } from "./persistence/types.js";
import { getMapDetailAsset } from "./http/map-detail-catalog.js";
import type { ModelRouter } from "@skald/world";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const PUBLIC_DIR = resolve(__dirname, "../public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
};

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'";

export interface ServerApp {
  store: MultiWorldStore;
  runtimes: WorldRuntimeManager;
}

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
  readonly app: ServerApp;
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

const WORLD_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function validateWorldId(id: string): boolean {
  return WORLD_ID_RE.test(id);
}

type PoisonResponse = {
  readonly writableFinished?: boolean;
  readonly destroyed?: boolean;
  once(event: string, listener: () => void): unknown;
};

type PoisonSchedule = (callback: () => void, delay: number) => unknown;

export function createPoisonExitScheduler(
  exit: (code: number) => void = (code) => process.exit(code),
  schedule: PoisonSchedule = (callback, delay) => setTimeout(callback, delay),
): (res: PoisonResponse) => void {
  let scheduled = false;
  return (res) => {
    if (scheduled) return;
    scheduled = true;
    let queued = false;
    const exitAfterResponse = () => {
      if (queued) return;
      queued = true;
      schedule(() => exit(1), 0);
    };
    if (res.writableFinished || res.destroyed) exitAfterResponse();
    else {
      res.once("finish", exitAfterResponse);
      res.once("close", exitAfterResponse);
    }
  };
}

export async function startServer(options?: {
  host?: string;
  port?: number;
  dbPath?: string;
  corsOrigin?: string;
  /** Optional non-network router used by deterministic acceptance harnesses. */
  router?: ModelRouter | null;
}): Promise<StartedServer> {
  const dbPath = options?.dbPath ?? process.env["SKALD_DB_PATH"] ?? "/home/nook/skald-data/events.sqlite";
  const store = createMultiWorldStore(dbPath);
  const runtimes = new WorldRuntimeManager(store, options?.router);
  const serverApp: ServerApp = { store, runtimes };
  const corsOrigin = options?.corsOrigin ?? process.env["SKALD_CORS_ORIGIN"] ?? "";
  let closed = false;
  const schedulePoisonExit = process.env.NODE_ENV === "test"
    ? (_res: PoisonResponse): void => {}
    : createPoisonExitScheduler();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const handle = (s: number, d: unknown) => writeJson(res, s, d, corsOrigin);
    const errHandle = (s: number, c: string, m: string) => writeError(res, s, c, m, corsOrigin);
    try {
      let url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";

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

      // Static files
      if (method === "GET") {
        if (url.pathname === "/" || url.pathname === "/index.html") { serveStatic("/index.html", res, corsOrigin); return; }
        const jsFiles = ["/app.js", "/api-client.js", "/world-api-client.js", "/offline-queue.js", "/presentation-view.js", "/journal-view.js", "/ui-state.js", "/client-state.js", "/status-view.js", "/discovery-view.js", "/guidance-view.js", "/menu-view.js", "/new-game-view.js", "/new-game-state.js", "/game-shell-view.js", "/chat-feed-view.js", "/living-world-shell.js", "/dom-helpers.js", "/world-stage-view.js", "/world-sidebar-view.js", "/context-rail-view.js", "/threads-view.js", "/activity-view.js", "/causal-view.js", "/critical-check-view.js", "/turn-history-view.js", "/belief-view.js", "/known-worlds-view.js", "/presence-card-view.js", "/presence-entry-state.js", "/presence-entry-controller.js", "/presence-view.js", "/focus-view.js", "/presence-lease.js", "/presence-route.js", "/presence-exit-state.js", "/presence-exit-controller.js", "/map-view.js", "/map-presentation-view.js", "/presentation-map.js", "/map-layout.js", "/map-state.js", "/map-client.js", "/map-legend.js", "/map-accessibility.js", "/narration-poll.js"];
        if (jsFiles.includes(url.pathname)) { serveStatic(url.pathname, res, corsOrigin); return; }
        const cssFiles = ["/styles.css", "/guidance.css", "/menu.css", "/new-game.css", "/game-shell.css", "/living-world.css", "/presence-entry.css", "/skald-aaa.css"];
        if (cssFiles.includes(url.pathname)) { serveStatic(url.pathname, res, corsOrigin); return; }
        if (url.pathname.startsWith("/assets/")) {
          // Region detail artwork is observer-scoped. Do not let a guessed
          // filename or public manifest bypass the map knowledge boundary.
          if (url.pathname === "/assets/maps/riverwatch-basin.manifest.json" || /riverwatch-basin-(central-valley|blackwood-crater|northern-pass|eastern-uplands|southern-borough)(?:\.png|\.manifest\.json)$/.test(url.pathname)) {
            res.writeHead(404, secHeaders(corsOrigin));
            res.end("Not Found");
            return;
          }
          serveStatic(url.pathname, res, corsOrigin); return;
        }
      }

      // Catalog
      if (method === "GET" && url.pathname === "/api/worlds") { const r = handleWorlds(runtimes); handle(r.statusCode, JSON.parse(r.body)); return; }
      if (method === "GET" && url.pathname === "/api/continue") { const r = handleContinue(runtimes); handle(r.statusCode, JSON.parse(r.body)); return; }
      if (method === "GET" && url.pathname === "/api/character-presets") { const r = handleCharacterPresets(); handle(r.statusCode, JSON.parse(r.body)); return; }
      if (method === "GET" && url.pathname === "/api/world-templates") { const r = handleWorldTemplates(); handle(r.statusCode, JSON.parse(r.body)); return; }
      if (method === "GET" && url.pathname === "/api/health") {
        const poisoned = runtimes.isAnyPoisoned();
        handle(poisoned ? 503 : 200, { status: poisoned ? "poisoned" : "ok", uptimeSeconds: Math.floor(process.uptime()), persistence: "sqlite", multiWorld: true });
        return;
      }

      // POST /api/worlds — create new world (before unscoped mapping)
      if (method === "POST" && url.pathname === "/api/worlds") {
        if (parseContentType(req.headers["content-type"]) !== "application/json") { errHandle(415, "unsupported_media_type", "Content-Type must be application/json"); return; }
        let body: unknown;
        try { body = await readJsonBody(req); } catch (err) {
          errHandle((err as any)?.message?.includes("too large") ? 413 : 400, "invalid_request", "invalid body"); return;
        }
        const r = await handleCreateWorld(runtimes, body);
        handle(r.statusCode, JSON.parse(r.body)); return;
      }

      // Mapping from unscoped paths to world-scoped sub-paths
      const defaultWorldId = store.getPrimaryWorldId() ?? LEGACY_WORLD_ID;
      const UNSCoped_PATH: Record<string, string> = {
        "/api/state": "/state", "/api/command": "/command", "/api/wait": "/wait",
        "/api/narrative": "/narrative", "/api/narrative-llm": "/narrative",
        "/api/journal": "/journal", "/api/discoveries": "/discoveries",
        "/api/guidance": "/guidance", "/api/beliefs": "/beliefs", "/api/events": "/events",
      };
      const scopedSub = UNSCoped_PATH[url.pathname];
      if (scopedSub) {
        const newPath = `/api/worlds/${defaultWorldId}${scopedSub}`;
        url = new URL(newPath + url.search, `http://${req.headers.host ?? "localhost"}`);
      }

      // 405 for catalog GET-only endpoints with wrong method
      const catalogGets = ["/api/worlds", "/api/character-presets", "/api/world-templates", "/api/continue"];
      if (method !== "GET" && catalogGets.includes(url.pathname)) {
        errHandle(405, "method_not_allowed", `method ${method} not allowed`); return;
      }

      // World-scoped
      const m = url.pathname.match(/^\/api\/worlds\/([^/]+)(\/.*)?$/);
      if (m) {
        const worldId = m[1]!;
        const sub = m[2] ?? "";
        if (!validateWorldId(worldId)) { errHandle(400, "invalid_world_id", "world ID must be 1-128 chars"); return; }

        const successorWorldId = store.getWorldSuccessor(worldId);
        if (successorWorldId) {
          handle(410, { ok: false, error: { code: "world_superseded", message: "world has been superseded", replacementWorldId: successorWorldId } });
          return;
        }

        let runtime;
        try { runtime = await runtimes.get(worldId); } catch (err: any) {
          const status = err?.statusCode === 404 || err?.statusCode === 409 ? err.statusCode : 500;
          if (status === 500) console.error(`[runtime-load-error] world="${worldId}"`, err);
          errHandle(status, status === 500 ? "internal_error" : "world_not_found", status === 500 ? "internal error" : err.message); return;
        }

        if (method === "GET") {
          if (sub === "/state" || sub === "") { const r = handleWorldState(runtime); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/journal") { const r = handleWorldJournal(runtime, url); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/discoveries") { const r = handleWorldDiscoveries(runtime); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/guidance") { const r = handleWorldGuidance(runtime); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/narrative") { const r = handleWorldNarrative(runtime); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/events") { const r = handleWorldEvents(runtime, url); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/game-shell") { const r = handleWorldGameShell(runtime, worldId); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/beliefs") { const r = handleWorldBeliefModel(runtime); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/observer-session") { const r = handleObserverSession(runtime, worldId); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/presence") { const r = handleWorldPresence(runtime, worldId); handle(r.statusCode, JSON.parse(r.body)); return; }
          if (sub === "/map") { const r = handleWorldMap(runtime); handle(r.statusCode, JSON.parse(r.body)); return; }
          const detailMatch = sub.match(/^\/map-details\/([^/]+)$/);
          if (detailMatch) {
            const asset = getMapDetailAsset(detailMatch[1]!);
            if (!asset || !mapDetailIsAvailable(runtime, asset.id)) {
              errHandle(404, "map_detail_locked", "map detail is not available to this observer"); return;
            }
            serveStatic(asset.src, res, corsOrigin); return;
          }
          if (sub === "/observer-threads") { const r = handleObserverThreads(runtime, worldId); handle(r.statusCode, JSON.parse(r.body)); return; }
        }

        if (method === "POST") {
          if (sub === "/command" || sub === "/wait") {
            if (parseContentType(req.headers["content-type"]) !== "application/json") {
              errHandle(415, "unsupported_media_type", "Content-Type must be application/json"); return;
            }
            let body: unknown;
            try { body = await readJsonBody(req); } catch (err) {
              errHandle((err as any)?.message?.includes("too large") ? 413 : 400, "invalid_request", "invalid body"); return;
            }
            const handler = sub === "/wait" ? handleWorldWait : handleWorldCommand;
            const r = await handler(runtime, body);
            handle(r.statusCode, JSON.parse(r.body)); return;
          }
          if (sub === "/presence/acknowledge") {
            if (parseContentType(req.headers["content-type"]) !== "application/json") {
              errHandle(415, "unsupported_media_type", "Content-Type must be application/json"); return;
            }
            let body: unknown;
            try { body = await readJsonBody(req); } catch (err) {
              errHandle((err as any)?.message?.includes("too large") ? 413 : 400, "invalid_request", "invalid body"); return;
            }
            const r = await handlePresenceAcknowledge(runtime, worldId, body);
            handle(r.statusCode, JSON.parse(r.body)); return;
          }
          if (sub === "/offline-command") {
            if (parseContentType(req.headers["content-type"]) !== "application/json") {
              errHandle(415, "unsupported_media_type", "Content-Type must be application/json"); return;
            }
            let body: unknown;
            try { body = await readJsonBody(req); } catch (err) {
              errHandle((err as any)?.message?.includes("too large") ? 413 : 400, "invalid_request", "invalid body"); return;
            }
            const r = await handleOfflineCommand(runtime, body);
            handle(r.statusCode, JSON.parse(r.body)); return;
          }
        }

        // Known sub-path but wrong method → 405
        const knownGetSubs = ["/state", "", "/journal", "/discoveries", "/guidance", "/beliefs", "/narrative", "/events", "/game-shell", "/observer-session", "/presence", "/map", "/observer-threads"];
        const knownPostSubs = ["/command", "/wait", "/presence/acknowledge", "/offline-command"];
        if (knownGetSubs.includes(sub) && method !== "GET") { errHandle(405, "method_not_allowed", `method ${method} not allowed`); return; }
        if (knownPostSubs.includes(sub) && method !== "POST") { errHandle(405, "method_not_allowed", `method ${method} not allowed`); return; }
      }

      errHandle(404, "not_found", "not found");
    } catch (err) {
      console.error("[http-error]", err);
      errHandle(500, "internal_error", "internal error");
    } finally {
      if (runtimes.isAnyPoisoned()) schedulePoisonExit(res);
    }
  });

  return new Promise<StartedServer>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options?.port ?? 0, options?.host ?? "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolvePromise({
        app: serverApp,
        server,
        url: `http://${options?.host ?? "127.0.0.1"}:${port}`,
        close: () => new Promise((res) => {
          if (closed) { res(); return; }
          closed = true;
          server.close(() => { store.close(); res(); });
        }),
      });
    });
  });
}
