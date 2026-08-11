import type { WorldRuntimeManager } from "../runtime/index.js";
import { listCharacterPresets, listWorldTemplates, getCharacterPreset, getWorldTemplate, buildBootstrapEvents } from "@skald/world";
import { createHash } from "node:crypto";
import type { CreateWorldParams } from "../persistence/sqlite-store.js";

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
  const store = _runtimes["store"];
  const primaryWorldId = store.getPrimaryWorldId();
  if (primaryWorldId) {
    const primary = store.getWorldRecord(primaryWorldId);
    if (primary?.status === "active") return json({ worldId: primaryWorldId, source: "primary" });
  }
  const worlds = store.listWorlds();
  const active = worlds.filter((w) => w.status === "active");
  if (active.length === 0) return error("not_found", "no active worlds", 404);

  active.sort((a, b) => {
    if (a.lastPlayedAt && b.lastPlayedAt) return b.lastPlayedAt - a.lastPlayedAt;
    if (a.lastPlayedAt) return -1;
    if (b.lastPlayedAt) return 1;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.worldId.localeCompare(b.worldId);
  });

  return json({ worldId: active[0]!.worldId });
}

export function handleCharacterPresets(): JsonResponse {
  return json({ presets: listCharacterPresets() });
}

export function handleWorldTemplates(): JsonResponse {
  return json({ templates: listWorldTemplates().filter((t) => t.available) });
}

export async function handleCreateWorld(runtimes: WorldRuntimeManager, body: unknown): Promise<JsonResponse> {
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const b = body as Record<string, unknown>;

  const worldId = b["worldId"];
  const idempotencyKey = b["idempotencyKey"];
  const saveLabelRaw = b["saveLabel"];
  const characterNameRaw = b["characterName"];
  const characterPresetId = b["characterPresetId"];
  const worldTemplateId = b["worldTemplateId"];

  // Strict typeof checks before any operations
  if (typeof worldId !== "string" || worldId.length < 1 || worldId.length > 128)
    return error("invalid_world_id", "worldId required (string, 1-128 chars)", 400);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(worldId as string))
    return error("invalid_world_id", "worldId must be alphanumeric", 400);
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("invalid_key", "idempotencyKey required (string, 1-128 chars)", 400);
  if (typeof saveLabelRaw !== "string")
    return error("invalid_label", "saveLabel must be a string", 400);
  if (typeof characterNameRaw !== "string")
    return error("invalid_name", "characterName must be a string", 400);
  if (typeof characterPresetId !== "string")
    return error("unknown_preset", "characterPresetId must be a string", 400);
  if (typeof worldTemplateId !== "string")
    return error("unknown_template", "worldTemplateId must be a string", 400);

  const saveLabel = (saveLabelRaw as string).trim();
  const characterName = (characterNameRaw as string).trim();

  if (saveLabel.length < 1 || saveLabel.length > 80) return error("invalid_label", "saveLabel required (1-80 chars)", 400);
  if (characterName.length < 1 || characterName.length > 40) return error("invalid_name", "characterName required (1-40 chars)", 400);

  const preset = getCharacterPreset(characterPresetId);
  if (!preset) return error("unknown_preset", `unknown character preset: ${characterPresetId}`, 400);

  const template = getWorldTemplate(worldTemplateId);
  if (!template || !template.available) return error("unknown_template", `unknown or unavailable world template: ${worldTemplateId}`, 400);

  // Compute request hash
  const requestDigest = createHash("sha256").update(JSON.stringify({ worldId, saveLabel, characterName, characterPresetId, worldTemplateId })).digest("hex");

  const bootstrapEvents = buildBootstrapEvents(worldTemplateId);

  const params: CreateWorldParams = {
    worldId,
    idempotencyKey,
    requestHash: requestDigest,
    saveLabel,
    characterName,
    characterPresetId,
    worldTemplateId,
    characterWound: preset.wound,
    characterPromise: preset.promise,
    characterPrinciple: preset.principle,
    characterProfileVersion: preset.profileVersion,
    bootstrapEvents,
  };

  try {
    const result = runtimes["store"].createWorld(params);
    return json({ ok: true, created: result.created, world: result.created ? result.worldRecord : result.worldRecord }, result.created ? 201 : 200);
  } catch (err: any) {
    if (err.code === "CONFLICT") return error("conflict", "different body for same idempotency key", 409);
    if (err.code === "DUPLICATE_WORLD") return error("conflict", "world already exists", 409);
    return error("internal_error", "failed to create world", 500);
  }
}
