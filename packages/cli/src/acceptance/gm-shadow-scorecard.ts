/**
 * Conversation Director shadow scorecard runner (SKALD S0).
 *
 * Runs the FIXED corpus (`gm-corpus.ts`, versioned by `GM_CORPUS_VERSION`)
 * through `interpretGmDecision` with the configured router, scores every
 * dimension with `scoreGmCorpus` (end-to-end denominators, privacy included),
 * and writes an IMMUTABLE result file carrying the ACTUAL commit (verified
 * against `git rev-parse HEAD`, with `EXPECTED_COMMIT` as the expectation, not
 * the evidence), config fingerprint, prompt sha256 and a FULL corpus digest
 * (every fixture field plus the per-scene prompts) — so two runs of the same
 * version are comparable and a scorecard can never be overwritten. Never
 * executes anything: the director only interprets.
 *
 * Usage:
 *   [EXPECTED_COMMIT=<sha>] [OUT=<path.json>] [GM_RUNS=<n>] [SKALD_ENV_FILE=<env>] \
 *     npm run acceptance:gm-shadow:scorecard
 *
 * Fail-closed exits with code 2 and NO scorecard file when: the env file is
 * unreadable, no router is configured, `EXPECTED_COMMIT` does not match the
 * actual commit, the worktree is dirty (any tracked change or untracked file
 * outside `plan_*.md`), `GM_RUNS` is not a positive integer, or the corpus
 * itself is misconfigured (`npcLabel` naming nobody). Scoring a different
 * version, a different tree or a broken baseline would all be false evidence.
 * `GM_RUNS` repeats the whole corpus for stochasticity (default 1); with more
 * than one run each result goes to `…run<N>.json`.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MasterTurnSceneContext } from "@skald/world";
import type { MasterConversationContext } from "../conversation/context-builder.js";
import { buildGmContext } from "../conversation/gm-context.js";
import { interpretGmDecision } from "../runtime/conversation-director.js";
import { GM_DIRECTOR_SYSTEM_PROMPT, buildGmDecisionPrompt } from "../conversation/gm-prompt.js";
import { scoreGmCorpus, type GmScoreEntry } from "../conversation/gm-scorecard.js";
import { createLiveRouterConfiguration } from "../runtime/router-factory.js";
import { applyServiceEnv } from "./service-env.js";
import { GM_CORPUS, GM_CORPUS_VERSION, expectedNpcHandle, type GmFixture } from "./gm-corpus.js";
import { corpusConfigErrors, dirtyOffenders, parseGmRuns } from "./scorecard-env.js";

const OUT = process.env["OUT"] ?? "eval-out/gm-shadow-scorecard.json";
const RUNS = parseGmRuns(process.env["GM_RUNS"]);

function blocked(reason: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ schema: "GM_SHADOW_SCORECARD_V1", overall: "BLOCKED", reason, ...extra }));
  process.exit(2);
}

if (RUNS === null) blocked("gm_runs_invalid", { value: process.env["GM_RUNS"] ?? null });

/** Loads `SKALD_ENV_FILE` as systemd data; fail-closed, never printed. */
function loadServiceEnv(): boolean {
  const envFile = process.env["SKALD_ENV_FILE"];
  if (!envFile) return true;
  let text: string;
  try { text = readFileSync(envFile, "utf8"); } catch { return false; }
  return applyServiceEnv(process.env, text).ok;
}

/** The commit this checkout is actually on (`git rev-parse HEAD`). */
function actualCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function sceneOf(fixture: GmFixture): MasterTurnSceneContext {
  return {
    schemaVersion: 1,
    revision: { worldTime: 0, eventNumber: 0 },
    currentLocation: { name: "Переправа", description: "Место у воды" },
    visibleObjects: [],
    knownPeople: fixture.people.map((person, index) => ({
      observerRef: `person_${index + 1}`,
      kind: "person" as const,
      label: person.label,
      knownAs: [],
      known: person.known,
    })),
    knownRoutes: [],
    accessibleItems: [],
    availableActions: [],
    currentSituation: null,
    knownTopics: [],
  } as unknown as MasterTurnSceneContext;
}

function conversationOf(fixture: GmFixture): MasterConversationContext {
  return {
    schemaVersion: 1,
    recentTurns: fixture.recentTurns,
    recentFocus: [],
    pendingClarification: null,
    lastTurns: fixture.recentTurns.map((turn) => ({ speaker: turn.speaker, text: turn.text, turnSeq: turn.turnSeq })),
    currentScene: null,
    recentlyMentionedEntities: [],
  } as unknown as MasterConversationContext;
}

if (!loadServiceEnv()) blocked("env_file_unreadable");

const commit = actualCommit();
if (commit === null) blocked("git_unavailable", { note: "scorecard cannot prove its version without git" });
const expectedCommit = process.env["EXPECTED_COMMIT"] ?? null;
if (expectedCommit !== null && expectedCommit !== commit) {
  blocked("commit_mismatch", { actualCommit: commit, expectedCommit });
}

// A scorecard signed by HEAD must describe exactly that tree: any tracked
// change or unexpected untracked file means the run is NOT of the named commit.
const porcelain = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  .split("\n");
const dirty = dirtyOffenders(porcelain);
if (dirty.length > 0) blocked("worktree_dirty", { actualCommit: commit, offenders: dirty });

// A corpus error (npcLabel naming nobody) would silently weaken the npc check
// to "any visible handle" — fail closed instead of scoring a broken baseline.
const corpusErrors = corpusConfigErrors(GM_CORPUS);
if (corpusErrors.length > 0) blocked("corpus_config_invalid", { errors: corpusErrors });

// Live discovery, exactly like the HTTP server: the bare
// `createRouterConfiguration()` carries no selection and falls back to the
// static Zen candidates, which are dead server-side (free tier is locked to
// the OpenCode app). Without live discovery every entry would score as a
// provider fallback and prove nothing about the director.
const configuration = await createLiveRouterConfiguration();
const configuredRouter = configuration?.router ?? null;
if (!configuredRouter) blocked("no_router_configured");
const router = configuredRouter;

// Build the per-fixture scenes ONCE: the same contexts feed the model, the
// privacy check and the digest, so all three describe the same run.
const prepared = GM_CORPUS.map((fixture) => {
  const { context, handleToObserverRef } = buildGmContext({ scene: sceneOf(fixture), conversation: conversationOf(fixture) });
  const allowedHandles = [...handleToObserverRef.keys()];
  const contextJson = JSON.stringify(context);
  return {
    fixture,
    context,
    contextJson,
    allowedHandles,
    userPrompt: buildGmDecisionPrompt(fixture.input, context),
    expectedHandle: expectedNpcHandle(fixture),
  };
});

// FULL manifest digest: every fixture field, the system prompt and the real
// per-scene user prompts — a change to people/turns/forbidden/prompts moves it.
const digestInput = JSON.stringify({
  corpusVersion: GM_CORPUS_VERSION,
  corpus: GM_CORPUS,
  systemPrompt: GM_DIRECTOR_SYSTEM_PROMPT,
  userPrompts: prepared.map((p) => ({ id: p.fixture.id, prompt: p.userPrompt })),
});
const corpusDigest = createHash("sha256").update(digestInput).digest("hex");
const promptSha256 = createHash("sha256").update(GM_DIRECTOR_SYSTEM_PROMPT).digest("hex");

const timeoutMs = Number(process.env["GM_TIMEOUT_MS"] ?? "4000");

async function runOnce(runIndex: number): Promise<{ ok: boolean; report: Record<string, unknown> }> {
  const entries: GmScoreEntry[] = [];
  for (const item of prepared) {
    const result = await interpretGmDecision({
      input: item.fixture.input,
      context: item.context,
      handleKeys: item.allowedHandles,
      router,
      turnKey: `sc-r${runIndex}-${item.fixture.id}`,
      timeoutMs,
    });
    const expectedKind = item.fixture.expected.kind as GmScoreEntry["expected"]["kind"];
    const expectedAddressee = item.fixture.expected.addresseeKind === "npc" ? "npc"
      : expectedKind === "clarification" ? "gm" : (item.fixture.expected.addresseeKind as "gm" | "meta");
    entries.push({
      input: item.fixture.id,
      expected: {
        addresseeKind: expectedAddressee,
        kind: expectedKind,
        allowedHandles: item.allowedHandles,
        expectedHandle: item.expectedHandle,
      },
      contextJson: item.contextJson,
      forbidden: item.fixture.forbidden,
      trace: result.trace,
      ...(result.status === "decision" ? { decision: result.decision } : {}),
    });
  }
  const card = scoreGmCorpus(entries);
  const routes = configuration?.selectionReport?.routes;
  const selection = routes
    ? Object.fromEntries(Object.entries(routes).map(([category, candidates]) => [
        category,
        (candidates ?? []).slice(0, 2).map((candidate) => ({ provider: candidate.provider, model: candidate.model, tier: candidate.tier })),
      ]))
    : null;
  const report = {
    schema: "GM_SHADOW_SCORECARD_V1",
    run: { index: runIndex, of: RUNS },
    corpus: { version: GM_CORPUS_VERSION, size: GM_CORPUS.length, scenarios: GM_CORPUS.map((f) => f.id), digest: corpusDigest },
    actualCommit: commit,
    expectedCommit,
    configFingerprint: configuration?.configFingerprint ?? null,
    // Which live-discovery candidates actually served this run — a fallback
    // scorecard without this would not prove a real model was exercised.
    selection,
    promptSha256,
    timeoutMs,
    scorecard: card,
  };
  return { ok: card.dimensions.every((d) => d.passed === d.total), report };
}

function writeImmutable(path: string, report: Record<string, unknown>): void {
  const body = JSON.stringify(report, null, 2);
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (existsSync(path)) {
    console.error(JSON.stringify({ error: "scorecard exists (immutable)", path, existingSha256: createHash("sha256").update(readFileSync(path, "utf8")).digest("hex") }, null, 2));
    process.exit(1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  writeFileSync(`${path}.sha256`, `${sha256}\n`);
  console.log(JSON.stringify({ ...report, sha256, out: path }, null, 2));
}

let allOk = true;
for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
  const { ok, report } = await runOnce(runIndex);
  allOk = allOk && ok;
  const path = RUNS === 1 ? OUT : OUT.replace(/\.json$/, `.run${runIndex}.json`);
  writeImmutable(path, report);
}
process.exitCode = allOk ? 0 : 1;
