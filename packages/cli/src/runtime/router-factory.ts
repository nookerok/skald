import { createHash } from "node:crypto";
import {
  discoverLiveRoutes,
  liveModelSelectionFingerprint,
  LLM_CONFIG,
  ModelRouter,
  type LiveModelSelectionOptions,
  type LiveModelSelectionReport,
  type LiveRouteDiscoveryOptions,
  type ProviderId,
  type RouteCandidate,
} from "@skald/world";

export interface RouterConfiguration {
  readonly router: ModelRouter | null;
  readonly required: boolean;
  readonly missingProviders: readonly ProviderId[];
  readonly configFingerprint: string;
  readonly selectionReport?: LiveModelSelectionReport;
}

export interface LiveRouterConfigurationOptions {
  readonly timeoutMs?: number;
  readonly preferredModels?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly probe?: LiveModelSelectionOptions["probe"];
}

function keyValue(env: NodeJS.ProcessEnv, provider: ProviderId): string {
  const name = LLM_CONFIG.providers[provider]?.apiKeyEnv;
  return name ? (env[name] ?? "") : "";
}

function routerMaterial(env: NodeJS.ProcessEnv, providers: readonly ProviderId[], providerKeys: Partial<Record<ProviderId, string>>): string {
  return [
    `required=${env.SKALD_AI_REQUIRED === "1" ? "1" : "0"}`,
    ...providers.map((provider) => `${provider}:${providerKeys[provider] ? "configured" : "missing"}`),
  ].join("|");
}

function providerKeysFromEnv(env: NodeJS.ProcessEnv): { providers: readonly ProviderId[]; providerKeys: Partial<Record<ProviderId, string>> } {
  const providers = Object.keys(LLM_CONFIG.providers) as ProviderId[];
  const providerKeys: Partial<Record<ProviderId, string>> = {};
  for (const provider of providers) {
    const key = keyValue(env, provider);
    if (key) providerKeys[provider] = key;
  }
  return { providers, providerKeys };
}

function baseConfigFingerprint(env: NodeJS.ProcessEnv, providers: readonly ProviderId[], providerKeys: Partial<Record<ProviderId, string>>): string {
  return createHash("sha256").update(routerMaterial(env, providers, providerKeys), "utf8").digest("hex");
}

/**
 * Secret-free fingerprint for one discovery selection: combines the static
 * provider/key-presence material with the live selection. Key values never
 * enter the digest. Shared by startup discovery and scheduled refresh so both
 * produce identical fingerprints for identical inputs.
 */
export function selectionConfigFingerprint(
  env: NodeJS.ProcessEnv,
  selection: LiveModelSelectionReport,
): string {
  const { providers, providerKeys } = providerKeysFromEnv(env);
  const baseFingerprint = baseConfigFingerprint(env, providers, providerKeys);
  return createHash("sha256")
    .update(`${baseFingerprint}|${liveModelSelectionFingerprint(selection)}`, "utf8")
    .digest("hex");
}

/**
 * Apply a fresh discovery selection to a live router without rebuilding it.
 * Returns the recomputed secret-free config fingerprint. Pure routing
 * metadata; credentials and provider output never cross this boundary.
 */
export function refreshRouterSelection(
  router: ModelRouter,
  selection: LiveModelSelectionReport,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configFingerprint = selectionConfigFingerprint(env, selection);
  router.applyLiveSelection(selection, configFingerprint);
  return configFingerprint;
}

function buildRouter(
  env: NodeJS.ProcessEnv,
  providerKeys: Partial<Record<ProviderId, string>>,
  providers: readonly ProviderId[],
  configFingerprint: string,
  routeCandidates?: Partial<Record<"interpret" | "narrate" | "analyze", readonly RouteCandidate[]>>,
  liveSelection?: LiveModelSelectionReport,
): ModelRouter | null {
  const availableProviders = providers.filter((provider) => Boolean(providerKeys[provider]));
  const primary = availableProviders.includes("opencode_zen") ? "opencode_zen" : availableProviders[0];
  if (!primary) return null;
  return new ModelRouter({
    providerKeys,
    ...(providerKeys[primary] !== undefined ? { apiKey: providerKeys[primary] } : {}),
    boundedRetries: true,
    providerId: primary,
    availableProviders,
    healthCachePath: env.SKALD_LLM_HEALTH_CACHE_PATH ?? "packages/cli/llm-health.json",
    configFingerprint,
    ...(routeCandidates ? { routeCandidates } : {}),
    ...(liveSelection ? { liveSelection } : {}),
  });
}

/**
 * Build one provider-aware router configuration from the process environment.
 * Key values never enter the returned fingerprint or diagnostics.
 */
export function createRouterConfiguration(env: NodeJS.ProcessEnv = process.env): RouterConfiguration {
  const providers = Object.keys(LLM_CONFIG.providers) as ProviderId[];
  const providerKeys: Partial<Record<ProviderId, string>> = {};
  for (const provider of providers) {
    const key = keyValue(env, provider);
    if (key) providerKeys[provider] = key;
  }
  const required = env.SKALD_AI_REQUIRED === "1";
  const requiredProviders: readonly ProviderId[] = ["opencode_zen"];
  const missingProviders = required ? requiredProviders.filter((provider) => !providerKeys[provider]) : [];
  const configFingerprint = createHash("sha256").update(routerMaterial(env, providers, providerKeys), "utf8").digest("hex");
  const router = buildRouter(env, providerKeys, providers, configFingerprint);
  return {
    router,
    required,
    missingProviders: Object.freeze([...missingProviders]),
    configFingerprint,
  };
}

/**
 * Discover the live Zen catalogue and activate only candidates that pass both
 * authenticated no-world probes. This is intentionally async and is called
 * before the production HTTP server begins accepting requests.
 *
 * When Zen activates nothing and an Ollama Cloud credential is configured,
 * the pinned Ollama backup model is probed instead (Zen-first ordering is
 * preserved: a single working Zen model always wins without touching Ollama).
 */
export async function createLiveRouterConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  options: LiveRouterConfigurationOptions = {},
): Promise<RouterConfiguration> {
  const base = createRouterConfiguration(env);
  const zenKey = keyValue(env, "opencode_zen");
  const ollamaKey = keyValue(env, "ollama_cloud");
  const selectionOptions: LiveRouteDiscoveryOptions = {
    apiKey: zenKey,
    ...(ollamaKey ? { ollamaKey } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.preferredModels ? { preferredModels: options.preferredModels } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.probe ? { probe: options.probe } : {}),
  };
  const selectionReport = await discoverLiveRoutes(selectionOptions);
  const { providers, providerKeys } = providerKeysFromEnv(env);
  const configFingerprint = selectionConfigFingerprint(env, selectionReport);
  const routes = {
    interpret: selectionReport.routes.interpret,
    narrate: selectionReport.routes.narrate,
    analyze: [] as readonly RouteCandidate[],
  };
  const router = buildRouter(env, providerKeys, providers, configFingerprint, routes, selectionReport);
  return {
    router,
    required: base.required,
    missingProviders: base.missingProviders,
    configFingerprint,
    selectionReport,
  };
}

export function createRouter(env: NodeJS.ProcessEnv = process.env): ModelRouter | null {
  return createRouterConfiguration(env).router;
}
