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
import {
  OPENCODE_RUN_AGENT_ENV,
  OPENCODE_RUN_BINARY_ENV,
  OPENCODE_RUN_DEFAULT_AGENT,
  OPENCODE_RUN_DEFAULT_MODEL,
  OPENCODE_RUN_ISOLATE_HOME_ENV,
  OPENCODE_RUN_MANIFEST_ENV,
  OPENCODE_RUN_MODEL_ENV,
  OPENCODE_RUN_TRANSPORT_VERSION,
  OpenCodeRunProvider,
  isOpenCodeRunEnabled,
  openCodeRunCandidate,
} from "./opencode-run-provider.js";

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
  readonly openrouterModels?: readonly string[];
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
    openCodeRunIdentity(env),
  ].join("|");
}

/**
 * Secret-free transport identity for the local-subprocess narrate backup:
 * flag, model, agent and contract version. Key values and the binary path
 * never enter the digest. Without this, toggling the transport (or swapping
 * its model) would keep the fingerprint — and any health cache keyed by it —
 * stale while the effective route changes underneath.
 */
export function openCodeRunIdentity(env: NodeJS.ProcessEnv = process.env): string {
  const enabled = isOpenCodeRunEnabled(env);
  const model = env[OPENCODE_RUN_MODEL_ENV] ?? OPENCODE_RUN_DEFAULT_MODEL;
  const agent = env[OPENCODE_RUN_AGENT_ENV] ?? OPENCODE_RUN_DEFAULT_AGENT;
  return `opencode_run:${enabled ? "enabled" : "disabled"}:${model}:${agent}:v${OPENCODE_RUN_TRANSPORT_VERSION}`;
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
  // The local transport is discovery-independent, so a refresh would wipe
  // its candidate. Re-append here (same rule as startup) to keep one code
  // path for the effective narrate route; skip when already present so a
  // previously-effective selection never gains a duplicate.
  const hasRunCandidate = selection.routes.narrate.some((candidate) => candidate.provider === "opencode_run");
  const effective = isOpenCodeRunEnabled(env) && !hasRunCandidate
    ? {
      ...selection,
      routes: {
        ...selection.routes,
        narrate: [...selection.routes.narrate, openCodeRunCandidate(env)],
      },
    }
    : selection;
  const configFingerprint = selectionConfigFingerprint(env, effective);
  router.applyLiveSelection(effective, configFingerprint);
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
  // The local-subprocess transport is keyless by design, so it never appears
  // in providerKeys; its presence is an explicit per-host opt-in instead.
  const useOpenCodeRun = isOpenCodeRunEnabled(env);
  const availableProviders = [
    ...providers.filter((provider) => Boolean(providerKeys[provider])),
    ...(useOpenCodeRun ? ["opencode_run" as const] : []),
  ];
  const primary = availableProviders.includes("opencode_zen") ? "opencode_zen" : availableProviders[0];
  if (!primary) return null;
  if (!useOpenCodeRun) {
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
  return new OpenCodeRunProvider({
    providerKeys,
    ...(providerKeys[primary] !== undefined ? { apiKey: providerKeys[primary] } : {}),
    boundedRetries: true,
    providerId: primary,
    availableProviders,
    healthCachePath: env.SKALD_LLM_HEALTH_CACHE_PATH ?? "packages/cli/llm-health.json",
    configFingerprint,
    ...(routeCandidates ? { routeCandidates } : {}),
    ...(liveSelection ? { liveSelection } : {}),
    opencodeRun: {
      ...(env[OPENCODE_RUN_BINARY_ENV] ? { binary: env[OPENCODE_RUN_BINARY_ENV] } : {}),
      ...(env[OPENCODE_RUN_AGENT_ENV] ? { agent: env[OPENCODE_RUN_AGENT_ENV] } : {}),
      ...(env[OPENCODE_RUN_MODEL_ENV] ? { model: env[OPENCODE_RUN_MODEL_ENV] } : {}),
      ...(env[OPENCODE_RUN_ISOLATE_HOME_ENV] === "0" ? { isolateHome: false } : {}),
      ...(env[OPENCODE_RUN_MANIFEST_ENV] ? { agentManifestPath: env[OPENCODE_RUN_MANIFEST_ENV] } : {}),
    },
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
  const openrouterKey = keyValue(env, "openrouter");
  const selectionOptions: LiveRouteDiscoveryOptions = {
    apiKey: zenKey,
    ...(ollamaKey ? { ollamaKey } : {}),
    ...(openrouterKey ? { openrouterKey } : {}),
    ...(options.openrouterModels ? { openrouterModels: options.openrouterModels } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.preferredModels ? { preferredModels: options.preferredModels } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.probe ? { probe: options.probe } : {}),
  };
  const selectionReport = await discoverLiveRoutes(selectionOptions);
  const { providers, providerKeys } = providerKeysFromEnv(env);
  // Build one effective selection first: the opencode_run backup belongs to
  // the narrate route from boot (same rule as refresh), and the fingerprint,
  // the applied routes and the reported live selection must all derive from
  // it — otherwise startup and refresh disagree about the same state.
  const effectiveSelection: LiveModelSelectionReport = isOpenCodeRunEnabled(env)
    ? {
      ...selectionReport,
      routes: {
        ...selectionReport.routes,
        narrate: [...selectionReport.routes.narrate, openCodeRunCandidate(env)],
      },
    }
    : selectionReport;
  const configFingerprint = selectionConfigFingerprint(env, effectiveSelection);
  // opencode_run goes last on narrate only: it is the newest, slowest
  // transport, so existing candidates keep priority until data says otherwise.
  // Interpret stays on the validated HTTP pipeline for now.
  const routes = {
    interpret: effectiveSelection.routes.interpret,
    narrate: effectiveSelection.routes.narrate,
    analyze: [] as readonly RouteCandidate[],
  };
  const router = buildRouter(env, providerKeys, providers, configFingerprint, routes, effectiveSelection);
  return {
    router,
    required: base.required,
    missingProviders: base.missingProviders,
    configFingerprint,
    selectionReport: effectiveSelection,
  };
}

export function createRouter(env: NodeJS.ProcessEnv = process.env): ModelRouter | null {
  return createRouterConfiguration(env).router;
}
