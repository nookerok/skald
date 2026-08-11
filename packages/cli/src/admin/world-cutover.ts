import { createHash } from "node:crypto";
import { createMultiWorldStore, type CreateWorldParams } from "../persistence/index.js";
import type { WorldId } from "../persistence/types.js";
import {
  buildBootstrapEvents,
  buildObserverMap,
  buildSpatialWorldProjection,
  getCharacterPreset,
  getWorldTemplate,
} from "@skald/world";

export interface CutoverOptions {
  readonly dbPath: string;
  readonly fromWorldId: WorldId;
  readonly toWorldId: WorldId;
  readonly saveLabel: string;
  readonly characterName: string;
  readonly characterPresetId: string;
  readonly reason: string;
  readonly apply: boolean;
}

export interface CutoverPlan {
  readonly sourceWorldId: WorldId;
  readonly targetWorldId: WorldId;
  readonly targetTemplateId: "living_region";
  readonly targetRegionId: string;
  readonly bootstrapEventCount: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly apply: boolean;
}

function value(args: Map<string, string>, key: string, fallback?: string): string {
  const result = args.get(key) ?? fallback;
  if (!result) throw new Error(`Missing required argument --${key}`);
  return result;
}

export function parseCutoverArgs(argv: readonly string[]): CutoverOptions {
  const args = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]!;
    if (raw === "--apply") { apply = true; continue; }
    if (raw === "--dry-run") { apply = false; continue; }
    if (!raw.startsWith("--")) throw new Error(`Unknown argument: ${raw}`);
    const [key, inline] = raw.slice(2).split("=", 2);
    if (!key) throw new Error(`Invalid argument: ${raw}`);
    const next = inline ?? argv[++i];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args.set(key, next);
  }
  const dbPath = args.get("db") ?? process.env["SKALD_DB_PATH"] ?? "/home/nook/skald-data/events.sqlite";
  const fromWorldId = value(args, "from", "legacy-world");
  const toWorldId = value(args, "to", "riverwatch-main");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(fromWorldId) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(toWorldId)) {
    throw new Error("world IDs must be alphanumeric with '-' or '_' (1-128 chars)");
  }
  if (fromWorldId === toWorldId) throw new Error("--from and --to must differ");
  return {
    dbPath,
    fromWorldId,
    toWorldId,
    saveLabel: value(args, "save-label", "Бассейн Речного Стража"),
    characterName: value(args, "character-name"),
    characterPresetId: value(args, "character-preset"),
    reason: value(args, "reason", "Production cutover: legacy world replaced by the compiled Pilot Region."),
    apply,
  };
}

export function buildCutoverPlan(options: CutoverOptions): CutoverPlan {
  const template = getWorldTemplate("living_region");
  if (!template?.available || template.regionId !== "riverwatch-basin") {
    throw new Error("living_region template is unavailable or not bound to riverwatch-basin");
  }
  const preset = getCharacterPreset(options.characterPresetId);
  if (!preset) throw new Error(`unknown character preset: ${options.characterPresetId}`);
  const bootstrapEvents = buildBootstrapEvents("living_region");
  const request = {
    fromWorldId: options.fromWorldId,
    toWorldId: options.toWorldId,
    saveLabel: options.saveLabel,
    characterName: options.characterName,
    characterPresetId: options.characterPresetId,
    worldTemplateId: "living_region",
    reason: options.reason,
  };
  const requestHash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  return {
    sourceWorldId: options.fromWorldId,
    targetWorldId: options.toWorldId,
    targetTemplateId: "living_region",
    targetRegionId: template.regionId,
    bootstrapEventCount: bootstrapEvents.length,
    idempotencyKey: `world-cutover:${options.fromWorldId}:${options.toWorldId}`,
    requestHash,
    apply: options.apply,
  };
}

function verifyPilotWorld(store: ReturnType<typeof createMultiWorldStore>, worldId: WorldId): void {
  const events = store.loadEvents(worldId);
  const spatial = buildSpatialWorldProjection(events);
  const map = buildObserverMap(events, spatial);
  if (!spatial.region || spatial.region.id !== "riverwatch-basin") throw new Error("cutover verification failed: region is missing");
  if (!map.observer.locationRef || !map.knownArea || map.locations.length === 0) {
    throw new Error("cutover verification failed: observer geometry is still empty");
  }
}

export function runCutover(options: CutoverOptions): { plan: CutoverPlan; applied: boolean; primaryWorldId: WorldId | null } {
  const store = createMultiWorldStore(options.dbPath);
  try {
    const plan = buildCutoverPlan(options);
    const source = store.getWorldRecord(plan.sourceWorldId);
    if (!source) throw new Error(`source world not found: ${plan.sourceWorldId}`);
    const existingTarget = store.getWorldRecord(plan.targetWorldId);
    if (!options.apply) return { plan, applied: false, primaryWorldId: store.getPrimaryWorldId() };
    if (existingTarget && store.getWorldSuccessor(plan.sourceWorldId) !== plan.targetWorldId) {
      throw new Error(`target world already exists without the expected succession: ${plan.targetWorldId}`);
    }

    const preset = getCharacterPreset(options.characterPresetId)!;
    const params: CreateWorldParams = {
      worldId: plan.targetWorldId,
      idempotencyKey: plan.idempotencyKey,
      requestHash: plan.requestHash,
      saveLabel: options.saveLabel,
      characterName: options.characterName,
      characterPresetId: options.characterPresetId,
      worldTemplateId: "living_region",
      characterWound: preset.wound,
      characterPromise: preset.promise,
      characterPrinciple: preset.principle,
      characterProfileVersion: preset.profileVersion,
      bootstrapEvents: buildBootstrapEvents("living_region"),
    };
    store.createWorld(params);
    store.recordWorldSuccession({ fromWorldId: plan.sourceWorldId, toWorldId: plan.targetWorldId, reason: options.reason });
    store.setPrimaryWorld(plan.targetWorldId);
    verifyPilotWorld(store, plan.targetWorldId);
    return { plan, applied: true, primaryWorldId: store.getPrimaryWorldId() };
  } finally {
    store.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseCutoverArgs(process.argv.slice(2));
    const result = runCutover(options);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
