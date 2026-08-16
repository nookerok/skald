import type { WorldRuntimeManager } from "../runtime/index.js";
import { listCharacterBackgrounds, listPlayerWorldTemplates, getCharacterBackground, getWorldTemplate, buildBootstrapEvents, listRegionEntrypoints, getRegionEntrypoint, getDefaultRegionEntrypoint, buildPrologueFromFirstEntry, buildFirstEntry } from "@skald/world";
import { createHash, randomUUID } from "node:crypto";
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

function publicBackground(background: ReturnType<typeof listCharacterBackgrounds>[number]) {
  return {
    id: background.id,
    title: background.title,
    shortDescription: background.shortDescription,
    formerRole: background.formerRole,
    rupture: background.rupture,
    reasonInRegion: background.reasonInRegion,
    knownConnection: background.knownConnection,
    obligation: background.obligation,
    description: background.description,
    wound: background.wound,
    promise: background.promise,
    principle: background.principle,
    history: background.history,
    startingKnowledge: background.startingKnowledge,
    openingHook: background.openingHook,
    startingTestimony: background.startingTestimony,
    startingContact: background.startingContact,
    startingItem: background.startingItem,
    familiarPlace: background.familiarPlace,
    procedureKnowledge: background.procedureKnowledge,
  };
}

export function handleCharacterPresets(): JsonResponse {
  const backgrounds = listCharacterBackgrounds().map(publicBackground);
  return json({ backgrounds, presets: backgrounds });
}

export function handleWorldTemplates(): JsonResponse {
  return json({ templates: listPlayerWorldTemplates() });
}

function playerEntrypoint(entry: ReturnType<typeof listRegionEntrypoints>[number]) {
  return {
    id: entry.id,
    title: entry.title,
    ...(entry.teaser ? { teaser: entry.teaser } : {}),
    description: entry.description,
    atmosphere: entry.atmosphere,
    openingSituation: entry.openingSituation,
    arrivalScene: entry.arrivalScene,
    localContact: entry.localContact,
    openingProblem: entry.openingProblem,
    availableRoutes: entry.availableRoutes,
    backgroundBridges: entry.backgroundBridges,
    backgroundConnections: entry.backgroundConnections,
  };
}

/** Player-facing onboarding catalog: one region, no world-template vocabulary. */
export function handleNewGameOptions(): JsonResponse {
  const backgrounds = listCharacterBackgrounds().map(publicBackground);
  return json({ schemaVersion: 1, region: { id: 'riverwatch-basin', title: 'Бассейн Речного Стража', description: 'Один живой регион: река, Чёрный лес и дороги, которые меняются вместе с теми, кто по ним идёт.' }, backgrounds, entrypoints: listRegionEntrypoints().map(playerEntrypoint) });
}

/** Read-only deterministic prologue composer; it creates no world or event. */
export function handleNewGamePrologue(body: unknown): JsonResponse {
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const input = body as Record<string, unknown>;
  const characterName = typeof input.characterName === "string" ? input.characterName.trim() : "";
  const backgroundId = typeof input.backgroundId === "string" ? input.backgroundId : "";
  const entrypointId = typeof input.entrypointId === "string" ? input.entrypointId : "";
  if (!characterName || characterName.length > 40) return error("invalid_name", "characterName required (1-40 chars)", 400);
  const background = getCharacterBackground(backgroundId);
  if (!background) return error("unknown_background", "unknown character background", 400);
  const entrypoint = getRegionEntrypoint(entrypointId);
  if (!entrypoint) return error("unknown_entrypoint", "unknown or unavailable story beginning", 400);
  if (!entrypoint.availableBackgroundIds.includes(background.id)) return error("incompatible_start", "this background cannot begin at the selected place", 400);
  const firstEntry = buildFirstEntry({
    characterName,
    background,
    entrypoint,
    playerContext: { locationTitle: entrypoint.title, locationDescription: entrypoint.description },
    initialTestimony: [background.startingTestimony],
    initialKnowledge: [background.startingKnowledge],
    accessibleItems: [background.startingItem],
    knownContactVisible: true,
  });
  return json({ ok: true, firstEntry, prologue: buildPrologueFromFirstEntry(firstEntry) });
}

export async function handleCreateWorld(runtimes: WorldRuntimeManager, body: unknown, requestMeta: { readonly idempotencyKey?: string | undefined; readonly allowLegacy?: boolean | undefined } = {}): Promise<JsonResponse> {
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const b = body as Record<string, unknown>;

  const legacyMode = requestMeta.allowLegacy === true && (
    Object.prototype.hasOwnProperty.call(b, "worldId") ||
    Object.prototype.hasOwnProperty.call(b, "idempotencyKey") ||
    Object.prototype.hasOwnProperty.call(b, "worldTemplateId") ||
    Object.prototype.hasOwnProperty.call(b, "saveLabel")
  );
  const allowedPublicKeys = new Set(["characterName", "backgroundId", "entrypointId"]);
  if (!legacyMode && Object.keys(b).some((key) => !allowedPublicKeys.has(key))) return error("invalid_request", "public story creation accepts only characterName, backgroundId and entrypointId", 400);
  const worldId = legacyMode ? b["worldId"] : "world-" + randomUUID();
  const idempotencyKey = legacyMode ? b["idempotencyKey"] : requestMeta.idempotencyKey;
  const saveLabelRaw = legacyMode ? b["saveLabel"] : undefined;
  const characterNameRaw = b["characterName"];
  const backgroundId = b["backgroundId"] ?? (legacyMode ? b["characterPresetId"] : undefined);
  const characterPresetId = backgroundId;
  const entrypointId = b["entrypointId"];
  const legacyWorldTemplateId = legacyMode ? b["worldTemplateId"] : undefined;
  const worldTemplateId = legacyMode && typeof legacyWorldTemplateId === "string" ? legacyWorldTemplateId : "living_region";

  // Strict typeof checks before any operations
  if (typeof worldId !== "string" || worldId.length < 1 || worldId.length > 128)
    return error("invalid_world_id", "worldId required (string, 1-128 chars)", 400);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(worldId as string))
    return error("invalid_world_id", "worldId must be alphanumeric", 400);
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("invalid_key", "Idempotency-Key header required (string, 1-128 chars)", 400);
  if (saveLabelRaw !== undefined && typeof saveLabelRaw !== "string")
    return error("invalid_label", "saveLabel must be a string", 400);
  if (typeof characterNameRaw !== "string")
    return error("invalid_name", "characterName must be a string", 400);
  if (typeof characterPresetId !== "string")
    return error("unknown_background", "backgroundId must be a string", 400);
  if ((!legacyMode && typeof entrypointId !== "string") || (entrypointId !== undefined && typeof entrypointId !== "string"))
    return error("unknown_entrypoint", "entrypointId must be a string", 400);

  const characterName = (characterNameRaw as string).trim();
  const saveLabel = (typeof saveLabelRaw === "string" && saveLabelRaw.trim().length > 0)
    ? saveLabelRaw.trim()
    : `${characterName} — Бассейн Речного Стража`;

  if (saveLabel.length < 1 || saveLabel.length > 80) return error("invalid_label", "saveLabel must be 1-80 chars", 400);
  if (characterName.length < 1 || characterName.length > 40) return error("invalid_name", "characterName required (1-40 chars)", 400);

  const background = typeof characterPresetId === "string" ? getCharacterBackground(characterPresetId) : null;
  if (!background) return error("unknown_background", "unknown character background", 400);

  if (!legacyMode && worldTemplateId !== "living_region") return error("unknown_template", "new stories must use living_region", 400);
  const template = getWorldTemplate(worldTemplateId);
  if (!template || !template.available) return error("unknown_template", `unknown or unavailable world template: ${worldTemplateId}`, 400);
  const entrypoint = worldTemplateId === "living_region"
    ? (typeof entrypointId === "string" ? getRegionEntrypoint(entrypointId) : getDefaultRegionEntrypoint())
    : null;
  if (worldTemplateId === "living_region" && !entrypoint) return error("unknown_entrypoint", "unknown or unavailable entrypoint", 400);
  if (entrypoint && !entrypoint.availableBackgroundIds.includes(String(backgroundId))) return error("incompatible_start", "this background cannot begin at the selected place", 400);

  // Creation metadata selects the authored start; location truth remains in bootstrap events.
  const digestPayload = legacyMode
    ? { worldId, saveLabel, characterName, backgroundId, worldTemplateId, entrypointId: entrypoint?.id ?? null }
    : { characterName, backgroundId, worldTemplateId, entrypointId: entrypoint?.id ?? null };
  const requestDigest = createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex");

  const bootstrapEvents = buildBootstrapEvents({
    templateId: worldTemplateId,
    entrypointId: entrypoint?.id,
    backgroundId: worldTemplateId === "living_region" ? characterPresetId : undefined,
  });

  const params: CreateWorldParams = {
    worldId,
    idempotencyKey,
    requestHash: requestDigest,
    saveLabel,
    characterName,
    characterPresetId: String(characterPresetId),
    backgroundId: String(backgroundId),
    worldTemplateId,
    entrypointId: entrypoint?.id,
    characterWound: background.wound,
    characterPromise: background.promise,
    characterPrinciple: background.principle,
    characterProfileVersion: background.profileVersion,
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
