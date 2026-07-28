import type { WorldRuntimeManager } from "../runtime/index.js";

export interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function json(data: unknown, statusCode = 200): JsonResponse {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

function error(code: string, message: string, statusCode = 400): JsonResponse {
  return json({ ok: false, error: { code, message } }, statusCode);
}

// --- Catalog ---

export function handleWorlds(runtimes: WorldRuntimeManager) {
  const worlds = runtimes["store"].listWorlds();
  return json({ worlds });
}

export function handleContinue(_runtimes: WorldRuntimeManager) {
  const worlds = _runtimes["store"].listWorlds();
  const active = worlds.filter((w) => w.status === "active");
  if (active.length === 0) return error("not_found", "no active worlds", 404);

  // Sort: highest lastPlayedAt first, then highest createdAt, then worldId lex
  active.sort((a, b) => {
    if (a.lastPlayedAt && b.lastPlayedAt) return b.lastPlayedAt - a.lastPlayedAt;
    if (a.lastPlayedAt) return -1;
    if (b.lastPlayedAt) return 1;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.worldId.localeCompare(b.worldId);
  });

  return json({ worldId: active[0]!.worldId });
}
