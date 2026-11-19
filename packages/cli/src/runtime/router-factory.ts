import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
  OPENCODE_RUN_AGENT_MANIFEST_DEFAULT_PATH,
  OPENCODE_RUN_BINARY_ENV,
  OPENCODE_RUN_DEFAULT_AGENT,
  OPENCODE_RUN_DEFAULT_MODEL,
  OPENCODE_RUN_ISOLATE_HOME_ENV,
  OPENCODE_RUN_MANIFEST_ENV,
  OPENCODE_RUN_MODEL_ENV,
  OPENCODE_RUN_TRANSPORT_VERSION,
  OpenCodeRunProvider,
  isOpenCodeRunEnabled,
  isOpenCodeRunNarrateFallbackEnabled,
  loadAgentManifestSnapshot,
  openCodeRunCandidate,
  openCodeRunCliMajor,
} from "./opencode-run-provider.js";
import type { OpenCodeRunManifestSnapshot } from "./opencode-run-provider.js";
import {
  isOpenCodeServerEnabled,
  OPENCODE_SERVER_MODEL_ENV,
  OPENCODE_SERVER_FALLBACK_MODEL_ENV,
  OPENCODE_SERVER_ALLOW_PAID_FALLBACK_ENV,
  OPENCODE_SERVER_ALLOW_PAID_PRIMARY_ENV,
  OPENCODE_SERVER_PORT_ENV,
  OPENCODE_SERVER_MAX_CONCURRENCY_ENV,
  OPENCODE_SERVER_STATE_DIR_ENV,
  OPENCODE_SERVER_VERSION,
  OPENCODE_SERVER_PROVIDER_ID,
  openCodeServerCandidates,
  openCodeServerAgentConfigDigest,
  OpenCodeServerProvider,
} from "./opencode-server-provider.js";

export interface RouterConfiguration {
  readonly router: ModelRouter | null;
  readonly required: boolean;
  readonly missingProviders: readonly ProviderId[];
  readonly configFingerprint: string;
  readonly selectionReport?: LiveModelSelectionReport;
  /** Read-only provider startup probe; absent for transports that need no prewarm. */
  readonly prewarm?: () => Promise<void>;
}

export interface LiveRouterConfigurationOptions {
  readonly timeoutMs?: number;
  readonly preferredModels?: readonly string[];
  readonly openrouterModels?: readonly string[];
  readonly ollamaModels?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly probe?: LiveModelSelectionOptions["probe"];
}

function keyValue(env: NodeJS.ProcessEnv, provider: ProviderId): string {
  const name = LLM_CONFIG.providers[provider]?.apiKeyEnv;
  return name ? (env[name] ?? "") : "";
}

function routerMaterial(
  env: NodeJS.ProcessEnv,
  providers: readonly ProviderId[],
  providerKeys: Partial<Record<ProviderId, string>>,
  manifestDigest?: string | null,
): string {
  return [
    `required=${env.SKALD_AI_REQUIRED === "1" ? "1" : "0"}`,
    ...providers.map((provider) => `${provider}:${providerKeys[provider] ? "configured" : "missing"}`),
    openCodeRunIdentity(env, manifestDigest),
    openCodeServerIdentity(env),
  ].join("|");
}

/** Secret-free identity for the explicitly pinned OpenCode Server transport. */
export function openCodeServerIdentity(env: NodeJS.ProcessEnv = process.env): string {
  const enabled = isOpenCodeServerEnabled(env);
  const model = env[OPENCODE_SERVER_MODEL_ENV] ?? "missing";
  const fallback = env[OPENCODE_SERVER_FALLBACK_MODEL_ENV] ?? "none";
  const allowPaidFallback = env[OPENCODE_SERVER_ALLOW_PAID_FALLBACK_ENV] === "1" ? "1" : "0";
  const allowPaidPrimary = env[OPENCODE_SERVER_ALLOW_PAID_PRIMARY_ENV] === "1" ? "1" : "0";
  const port = env[OPENCODE_SERVER_PORT_ENV] ?? "default";
  const concurrency = env[OPENCODE_SERVER_MAX_CONCURRENCY_ENV] ?? "default";
  return "opencode_server:" + (enabled ? "enabled" : "disabled") + ":" + model
    + ":fallback=" + fallback + ":paidPrimary=" + allowPaidPrimary + ":paidFallback=" + allowPaidFallback
    + ":port=" + port + ":concurrency=" + concurrency + ":v" + OPENCODE_SERVER_VERSION
    + ":agents=" + openCodeServerAgentConfigDigest();
}

function withOpenCodeServerPrimary(selection: LiveModelSelectionReport, env: NodeJS.ProcessEnv): LiveModelSelectionReport {
  const serverCandidates = isOpenCodeServerEnabled(env) ? openCodeServerCandidates(env) : [];
  if (serverCandidates.length === 0) return selection;
  return {
    ...selection,
    routes: {
      ...selection.routes,
      // Only the explicitly pinned OpenCode primary and fallback may handle
      // gameplay requests. Do not silently fall through to an unrelated
      // provider (which could be paid) when the selected OpenCode model fails.
      interpret: serverCandidates,
      narrate: serverCandidates,
    },
  };
}

function openCodeServerStaticRoutes(env: NodeJS.ProcessEnv): Partial<Record<"interpret" | "narrate" | "analyze", readonly RouteCandidate[]>> | undefined {
  if (!isOpenCodeServerEnabled(env)) return undefined;
  const candidates = openCodeServerCandidates(env);
  if (candidates.length === 0) return undefined;
  return {
    interpret: candidates,
    narrate: candidates,
    analyze: [],
  };
}

/**
 * Secret-free transport identity for the local-subprocess narrate transport:
 * transport and fallback opt-ins, model, agent, home-isolation mode, manifest
 * content hash and contract
 * version. Key values and paths never enter the digest. Without this,
 * toggling the transport (or swapping its model, isolation or manifest)
 * would keep the fingerprint — and any health cache keyed by it — stale
 * while the effective route changes underneath.
 */
export function openCodeRunIdentity(env: NodeJS.ProcessEnv = process.env, manifestDigest?: string | null): string {
  const enabled = isOpenCodeRunEnabled(env);
  const narrateFallbackEnabled = isOpenCodeRunNarrateFallbackEnabled(env);
  const model = env[OPENCODE_RUN_MODEL_ENV] ?? OPENCODE_RUN_DEFAULT_MODEL;
  const agent = env[OPENCODE_RUN_AGENT_ENV] ?? OPENCODE_RUN_DEFAULT_AGENT;
  const isolate = (env[OPENCODE_RUN_ISOLATE_HOME_ENV] === "0" ? "shared" : "isolated") + ":cli" + openCodeRunCliMajor(env);
  // Explicit digest wins: callers holding the served snapshot (startup,
  // live-router refresh) pass it so the identity describes those exact
  // bytes. Without one, fall back to reading the file — same file the
  // provider will load when none exists yet.
  const digest = manifestDigest === undefined ? openCodeRunManifestIdentity(env) : manifestDigest;
  return `opencode_run:${enabled ? "enabled" : "disabled"}:narrate-fallback:${narrateFallbackEnabled ? "enabled" : "disabled"}:${model}:${agent}:${isolate}:${digest ?? "missing"}:v${OPENCODE_RUN_TRANSPORT_VERSION}`;
}

function withOpenCodeRunNarrateFallback(
  selection: LiveModelSelectionReport,
  env: NodeJS.ProcessEnv,
): LiveModelSelectionReport {
  const narrate = selection.routes.narrate.filter((candidate) => candidate.provider !== "opencode_run");
  if (isOpenCodeRunNarrateFallbackEnabled(env)) narrate.push(openCodeRunCandidate(env));
  return { ...selection, routes: { ...selection.routes, narrate } };
}

/**
 * Manifest identity: SHA-256 of the manifest file content when readable,
 * `missing` otherwise. The hash (not the path) keeps two checkouts with
 * identical content equal while any content change rotates the fingerprint.
 * Non-secret: the manifest is versioned containment text. Relative paths
 * resolve against the process working directory (repo root locally and in
 * the systemd unit alike).
 */
function openCodeRunManifestIdentity(env: NodeJS.ProcessEnv): string {
  const path = env[OPENCODE_RUN_MANIFEST_ENV] ?? OPENCODE_RUN_AGENT_MANIFEST_DEFAULT_PATH;
  try {
    return createHash("sha256").update(readFileSync(path, "utf8"), "utf8").digest("hex");
  } catch {
    return "missing";
  }
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

function baseConfigFingerprint(
  env: NodeJS.ProcessEnv,
  providers: readonly ProviderId[],
  providerKeys: Partial<Record<ProviderId, string>>,
  manifestDigest?: string | null,
): string {
  return createHash("sha256").update(routerMaterial(env, providers, providerKeys, manifestDigest), "utf8").digest("hex");
}

/**
 * Secret-free fingerprint for one discovery selection: combines the static
 * provider/key-presence material with the live selection. Key values never
 * enter the digest. Shared by startup discovery and scheduled refresh so both
 * produce identical fingerprints for identical inputs. Pass the served
 * manifest digest when one is held (startup snapshot, live router) so the
 * identity tracks served bytes instead of re-reading the file.
 */
export function selectionConfigFingerprint(
  env: NodeJS.ProcessEnv,
  selection: LiveModelSelectionReport,
  manifestDigest?: string | null,
): string {
  const { providers, providerKeys } = providerKeysFromEnv(env);
  const baseFingerprint = baseConfigFingerprint(env, providers, providerKeys, manifestDigest);
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
  // The subprocess is not trusted as an active fallback by default. Refresh
  // mirrors startup and removes stale candidates unless both opt-ins hold.
  const effective = withOpenCodeServerPrimary(withOpenCodeRunNarrateFallback(selection, env), env);
  // Fingerprint what the live router actually serves: prefer its pinned
  // manifest digest over re-reading the file, so a checkout change after
  // startup cannot desync reporting from serving.
  const servedDigest = router instanceof OpenCodeRunProvider ? router.agentManifestDigest() : undefined;
  const configFingerprint = selectionConfigFingerprint(env, effective, servedDigest);
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
  transportSnapshot?: OpenCodeRunManifestSnapshot | null,
): ModelRouter | null {
  // The local-subprocess transport is keyless by design, so it never appears
  // in providerKeys; its presence is an explicit per-host opt-in instead.
  const useOpenCodeRun = isOpenCodeRunEnabled(env);
  const useOpenCodeServer = isOpenCodeServerEnabled(env);
  const availableProviders = [
    ...providers.filter((provider) => provider !== OPENCODE_SERVER_PROVIDER_ID && Boolean(providerKeys[provider])),
    ...(useOpenCodeRun ? ["opencode_run" as const] : []),
    ...(useOpenCodeServer ? [OPENCODE_SERVER_PROVIDER_ID] : []),
  ];
  const primary = useOpenCodeServer
    ? OPENCODE_SERVER_PROVIDER_ID
    : availableProviders.includes("opencode_zen") ? "opencode_zen" : availableProviders[0];
  if (!primary) return null;
  if (!useOpenCodeRun && !useOpenCodeServer) {
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
  const providerOptions = {
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
      cliMajor: openCodeRunCliMajor(env),
      ...(env[OPENCODE_RUN_BINARY_ENV] ? { binary: env[OPENCODE_RUN_BINARY_ENV] } : {}),
      ...(env[OPENCODE_RUN_AGENT_ENV] ? { agent: env[OPENCODE_RUN_AGENT_ENV] } : {}),
      ...(env[OPENCODE_RUN_MODEL_ENV] ? { model: env[OPENCODE_RUN_MODEL_ENV] } : {}),
      ...(env[OPENCODE_RUN_ISOLATE_HOME_ENV] === "0" ? { isolateHome: false } : {}),
      ...(env[OPENCODE_RUN_MANIFEST_ENV] ? { agentManifestPath: env[OPENCODE_RUN_MANIFEST_ENV] } : {}),
      ...(transportSnapshot ? { agentManifestContent: transportSnapshot.content, agentManifestDigest: transportSnapshot.sha256 } : {}),
    },
  };
  if (useOpenCodeServer) {
    return new OpenCodeServerProvider({
      ...providerOptions,
      opencodeServer: {
        enabled: true,
        ...(env[OPENCODE_SERVER_MODEL_ENV] ? { model: env[OPENCODE_SERVER_MODEL_ENV] } : {}),
        ...(env[OPENCODE_SERVER_FALLBACK_MODEL_ENV] ? { fallbackModel: env[OPENCODE_SERVER_FALLBACK_MODEL_ENV] } : {}),
        allowPaidFallback: env[OPENCODE_SERVER_ALLOW_PAID_FALLBACK_ENV] === "1",
        allowPaidPrimary: env[OPENCODE_SERVER_ALLOW_PAID_PRIMARY_ENV] === "1",
        ...(env[OPENCODE_SERVER_MAX_CONCURRENCY_ENV] ? { maxConcurrency: Number(env[OPENCODE_SERVER_MAX_CONCURRENCY_ENV]) } : {}),
        ...(env.SKALD_OPENCODE_BIN ? { binary: env.SKALD_OPENCODE_BIN } : {}),
        ...(env[OPENCODE_SERVER_PORT_ENV] ? { port: Number(env[OPENCODE_SERVER_PORT_ENV]) } : {}),
        ...(env[OPENCODE_SERVER_STATE_DIR_ENV] ? { stateDir: env[OPENCODE_SERVER_STATE_DIR_ENV] } : {}),
        apiKey: keyValue(env, "opencode_server"),
        expectedVersion: OPENCODE_SERVER_VERSION,
      },
    });
  }
  return new OpenCodeRunProvider(providerOptions);
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
  const router = buildRouter(env, providerKeys, providers, configFingerprint, openCodeServerStaticRoutes(env));
  const prewarm = router instanceof OpenCodeServerProvider ? () => router.prewarm() : undefined;
  return {
    router,
    required,
    missingProviders: Object.freeze([...missingProviders]),
    configFingerprint,
    ...(prewarm ? { prewarm } : {}),
  };
}

/**
 * Discover the live Zen catalogue and activate only candidates that pass both
 * authenticated no-world probes. This is intentionally async and is called
 * before the production HTTP server begins accepting requests. An explicit
 * OpenCode Server pin returns its static routes without probing providers that
 * would be discarded.
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
  // An explicitly pinned OpenCode Server route is already the complete
  // effective selection. Do not probe unrelated providers (which will be
  // discarded below), and do not imply live route discovery validated it.
  if (isOpenCodeServerEnabled(env)) return base;
  const zenKey = keyValue(env, "opencode_zen");
  const ollamaKey = keyValue(env, "ollama_cloud");
  const openrouterKey = keyValue(env, "openrouter");
  const selectionOptions: LiveRouteDiscoveryOptions = {
    apiKey: zenKey,
    ...(ollamaKey ? { ollamaKey } : {}),
    ...(openrouterKey ? { openrouterKey } : {}),
    ...(options.openrouterModels ? { openrouterModels: options.openrouterModels } : {}),
    ...(options.ollamaModels ? { ollamaModels: options.ollamaModels } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.preferredModels ? { preferredModels: options.preferredModels } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.probe ? { probe: options.probe } : {}),
  };
  const selectionReport = await discoverLiveRoutes(selectionOptions);
  const { providers, providerKeys } = providerKeysFromEnv(env);
  // One snapshot for everything below: the provider serves exactly these
  // bytes and the fingerprint describes exactly these bytes, so reporting
  // can never describe a manifest the router does not serve. The path
  // resolves from the passed env (never process.env) for testability.
  const transportSnapshot = isOpenCodeRunEnabled(env)
    ? loadAgentManifestSnapshot(env[OPENCODE_RUN_MANIFEST_ENV] ?? OPENCODE_RUN_AGENT_MANIFEST_DEFAULT_PATH)
    : null;
  // Startup and refresh share the same fail-closed fallback policy.
  const effectiveSelection = withOpenCodeServerPrimary(withOpenCodeRunNarrateFallback(selectionReport, env), env);
  const configFingerprint = selectionConfigFingerprint(env, effectiveSelection, transportSnapshot?.sha256 ?? null);
  // opencode_run goes last on narrate only: it is the newest, slowest
  // transport, so existing candidates keep priority until data says otherwise.
  // Interpret stays on the validated HTTP pipeline for now.
  const routes = {
    interpret: effectiveSelection.routes.interpret,
    narrate: effectiveSelection.routes.narrate,
    analyze: [] as readonly RouteCandidate[],
  };
  const router = buildRouter(env, providerKeys, providers, configFingerprint, routes, effectiveSelection, transportSnapshot);
  const prewarm = router instanceof OpenCodeServerProvider ? () => router.prewarm() : undefined;
  return {
    router,
    required: base.required,
    missingProviders: base.missingProviders,
    configFingerprint,
    selectionReport: effectiveSelection,
    ...(prewarm ? { prewarm } : {}),
  };
}

export function createRouter(env: NodeJS.ProcessEnv = process.env): ModelRouter | null {
  return createRouterConfiguration(env).router;
}
