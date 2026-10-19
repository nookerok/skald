#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const STATUSES = new Set(["PASS", "FAIL", "BLOCKED"]);
const PREFLIGHT_CAPABILITIES = Object.freeze([
  "browser",
  "viewport",
  "screenshot",
  "rendered_audit",
  "dom",
  "console",
  "report_dir",
]);
/**
 * Capabilities that must pass on their own. The two visual instruments are
 * ALTERNATIVES: a rendered-structure audit may stand in for an unavailable
 * screenshot, and vice versa. Only when BOTH are unavailable is the visual
 * area unproven.
 */
const REQUIRED_PREFLIGHT_CAPABILITIES = Object.freeze([
  "browser",
  "viewport",
  "dom",
  "console",
  "report_dir",
]);
const ALTERNATIVE_VISUAL_CAPABILITIES = Object.freeze(["screenshot", "rendered_audit"]);

function argsOf(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--self-test") {
      values.set("self-test", true);
      continue;
    }
    if (!key.startsWith("--") || !argv[i + 1]?.length) {
      throw new Error(`Invalid argument: ${key}`);
    }
    values.set(key.slice(2), argv[i + 1]);
    i += 1;
  }
  return values;
}

function required(args, name) {
  const value = args.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function json(file, label) {
  let value;
  try {
    value = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(`${label} is missing: ${file} (${error.code ?? "read error"})`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON: ${file}`);
  }
}

async function hash(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function safePath(root, relative, label) {
  if (!relative || path.isAbsolute(relative)) {
    throw new Error(`${label} must be relative to the output root`);
  }
  const resolved = path.resolve(root, relative);
  const fromRoot = path.relative(root, resolved);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes the output root`);
  }
  return resolved;
}

function validateIdentity(jobId, runToken) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(jobId)) {
    throw new Error("jobId contains unsupported characters");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/.test(runToken)) {
    throw new Error("runToken must contain 16-200 safe characters");
  }
}

async function atomicText(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, file);
}

async function atomicJson(file, value) {
  await atomicText(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAck({ outputRoot, jobId, runToken, mutationLimit, preflight, acknowledgedBy }) {
  validateIdentity(jobId, runToken);
  const validatedPreflight = validatePreflight(preflight);
  const gate = decidePreflightGate(validatedPreflight, acknowledgedBy);
  const root = path.resolve(outputRoot);
  const reserved = [
    `${jobId}.ack.json`,
    `${jobId}.progress.json`,
    `${jobId}-report.json`,
    `${jobId}-report.md`,
    `${jobId}.complete.json`,
  ];
  for (const name of reserved) {
    try {
      await readFile(path.join(root, name));
      throw new Error(`jobId already has an artifact: ${name}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const limit = Number(mutationLimit ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("invalid mutation limit");
  const payload = {
    schema: "QA_JOB_ACK_V1",
    protocol: "QA_FILE_BRIDGE_V1",
    jobId,
    runToken,
    status: "ACK",
    acknowledgedAt: new Date().toISOString(),
    mutationLimit: limit,
    preflight: validatedPreflight,
    preflightGate: gate.gate,
    blockedCapabilities: gate.blockedCapabilities,
    // The report mirrors this reduced scope; it names exactly the gaps the
    // operator accepted, so the gate can be re-derived from the report alone.
    ...(gate.gate === "proceed_reduced"
      ? {
          acknowledgedBy: acknowledgedBy.trim(),
          reducedScope: { missing: gate.uncoveredCapabilities, acknowledgedBy: acknowledgedBy.trim() },
        }
      : {}),
  };
  await atomicJson(path.join(root, `${jobId}.ack.json`), payload);
  return payload;
}

async function writeProgress({ outputRoot, jobId, runToken, phase, mutationTotal }) {
  validateIdentity(jobId, runToken);
  const root = path.resolve(outputRoot);
  await readAckForJob(root, jobId, runToken);
  const payload = {
    schema: "QA_JOB_PROGRESS_V1",
    protocol: "QA_FILE_BRIDGE_V1",
    jobId,
    runToken,
    phase,
    mutationCounts: { total: Number(mutationTotal ?? 0) },
    updatedAt: new Date().toISOString(),
  };
  await atomicJson(path.join(root, `${jobId}.progress.json`), payload);
  return payload;
}

async function writeReport({
  outputRoot,
  jobId,
  runToken,
  sourceJson,
  sourceMarkdown,
}) {
  validateIdentity(jobId, runToken);
  const root = path.resolve(outputRoot);
  await readAckForJob(root, jobId, runToken);
  const jsonPath = path.join(root, `${jobId}-report.json`);
  const markdownPath = path.join(root, `${jobId}-report.md`);
  for (const file of [jsonPath, markdownPath, path.join(root, `${jobId}.complete.json`)]) {
    try {
      await readFile(file);
      throw new Error(`cannot overwrite committed artifact: ${path.basename(file)}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const report = await json(path.resolve(sourceJson), "source result");
  equal(report.schema, "QA_RESULT_V2", "result schema");
  equal(report.jobId, jobId, "result jobId");
  equal(report.delivery?.protocol, "QA_FILE_BRIDGE_V1", "delivery protocol");
  equal(report.delivery?.runToken, runToken, "result runToken");
  if (!STATUSES.has(report.status)) throw new Error(`Unsupported result status: ${report.status}`);
  const markdown = await readFile(path.resolve(sourceMarkdown), "utf8");
  if (!markdown.trim()) throw new Error("Markdown report is empty");
  await atomicJson(jsonPath, report);
  await atomicText(markdownPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return { reportJson: path.basename(jsonPath), reportMarkdown: path.basename(markdownPath) };
}

async function writeCompletion({ outputRoot, jobId, runToken }) {
  validateIdentity(jobId, runToken);
  const root = path.resolve(outputRoot);
  const ack = await readAckForJob(root, jobId, runToken);
  const completionPath = path.join(root, `${jobId}.complete.json`);
  try {
    await readFile(completionPath);
    throw new Error(`completion receipt already exists: ${jobId}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const reportJson = `${jobId}-report.json`;
  const reportMarkdown = `${jobId}-report.md`;
  const jsonPath = safePath(root, reportJson, "JSON report path");
  const markdownPath = safePath(root, reportMarkdown, "Markdown report path");
  const report = await json(jsonPath, "result");
  equal(report.schema, "QA_RESULT_V2", "result schema");
  equal(report.jobId, jobId, "result jobId");
  equal(report.delivery?.protocol, "QA_FILE_BRIDGE_V1", "delivery protocol");
  equal(report.delivery?.runToken, runToken, "result runToken");
  if (!STATUSES.has(report.status)) throw new Error(`Unsupported result status: ${report.status}`);
  const payload = {
    schema: "QA_JOB_COMPLETE_V1",
    protocol: "QA_FILE_BRIDGE_V1",
    jobId,
    runToken,
    status: report.status,
    reports: {
      json: reportJson,
      markdown: reportMarkdown,
      jsonSha256: await hash(jsonPath),
      markdownSha256: await hash(markdownPath),
    },
    mutationCounts: report.mutationCounts ?? { total: 0 },
    preflightGate: ack.preflightGate,
    completedAt: new Date().toISOString(),
  };
  await atomicJson(completionPath, payload);
  return payload;
}

async function verify({ outputRoot, jobId, runToken }) {
  validateIdentity(jobId, runToken);

  const root = path.resolve(outputRoot);
  const ack = await json(path.join(root, `${jobId}.ack.json`), "ACK");
  const done = await json(path.join(root, `${jobId}.complete.json`), "completion");
  equal(ack.schema, "QA_JOB_ACK_V1", "ACK schema");
  equal(ack.protocol, "QA_FILE_BRIDGE_V1", "ACK protocol");
  let preflightVerified = false;
  let preflightGate = null;
  let blockedCapabilities = null;
  try {
    const validatedPreflight = validatePreflight(ack.preflight);
    const gate = decidePreflightGate(validatedPreflight, ack.acknowledgedBy);
    preflightGate = gate.gate;
    blockedCapabilities = gate.blockedCapabilities;
    preflightVerified = ack.preflightGate === gate.gate &&
      JSON.stringify(ack.blockedCapabilities) === JSON.stringify(gate.blockedCapabilities) &&
      (done.preflightGate === undefined || done.preflightGate === gate.gate);
  } catch {
    // Preserve verification of immutable receipts created before ACK preflight existed.
  }
  equal(ack.jobId, jobId, "ACK jobId");
  equal(ack.runToken, runToken, "ACK runToken");
  equal(done.schema, "QA_JOB_COMPLETE_V1", "completion schema");
  equal(done.protocol, "QA_FILE_BRIDGE_V1", "completion protocol");
  equal(done.jobId, jobId, "completion jobId");
  equal(done.runToken, runToken, "completion runToken");
  if (!STATUSES.has(done.status)) {
    throw new Error(`Unsupported completion status: ${done.status}`);
  }

  const reportJsonPath = safePath(root, done.reports?.json, "JSON report path");
  const reportMarkdownPath = safePath(
    root,
    done.reports?.markdown,
    "Markdown report path",
  );
  const [jsonHash, markdownHash, report] = await Promise.all([
    hash(reportJsonPath),
    hash(reportMarkdownPath),
    json(reportJsonPath, "result"),
  ]);
  equal(jsonHash, String(done.reports?.jsonSha256).toLowerCase(), "JSON SHA-256");
  equal(markdownHash, String(done.reports?.markdownSha256).toLowerCase(), "Markdown SHA-256");
  equal(report.schema, "QA_RESULT_V2", "result schema");
  equal(report.jobId, jobId, "result jobId");
  equal(report.status, done.status, "result status");
  equal(report.delivery?.protocol, "QA_FILE_BRIDGE_V1", "delivery protocol");
  equal(report.delivery?.runToken, runToken, "result runToken");
  if (
    done.mutationCounts?.total !== undefined &&
    report.mutationCounts?.total !== undefined
  ) {
    equal(done.mutationCounts.total, report.mutationCounts.total, "mutation total");
  }

  return {
    delivery: "verified",
    jobId,
    runToken,
    status: done.status,
    preflightVerified,
    preflightGate,
    blockedCapabilities,
    worldId: report.worldId ?? null,
    mutationCounts: done.mutationCounts ?? report.mutationCounts ?? null,
    reportJsonPath,
    reportMarkdownPath,
    reportJsonSha256: jsonHash,
    reportMarkdownSha256: markdownHash,
  };
}

async function selfTest() {
  const root = await mkdtemp(path.join(tmpdir(), "skald-qa-bridge-"));
  const jobId = "channel-selftest-v3";
  const runToken = "selftest-token-0000000000000001";
  const reportJson = `${jobId}-report.json`;
  const reportMarkdown = `${jobId}-report.md`;
  const report = {
    schema: "QA_RESULT_V2",
    status: "PASS",
    jobId,
    worldId: null,
    mutationCounts: { total: 0 },
    delivery: { protocol: "QA_FILE_BRIDGE_V1", runToken },
  };
  const preflight = Object.fromEntries(PREFLIGHT_CAPABILITIES.map((capability) => [capability, "PASS"]));
  try {
    await writeAck({ outputRoot: root, jobId, runToken, mutationLimit: 0, preflight });
    let duplicateRejected = false;
    try {
      await writeAck({ outputRoot: root, jobId, runToken, mutationLimit: 0, preflight });
    } catch (error) {
      duplicateRejected = String(error.message).includes("already has an artifact");
    }
    if (!duplicateRejected) throw new Error("duplicate jobId was accepted");
    await writeProgress({
      outputRoot: root,
      jobId,
      runToken,
      phase: "reporting",
      mutationTotal: 0,
    });
    const sourceJson = path.join(root, "source.json");
    const sourceMarkdown = path.join(root, "source.md");
    await atomicJson(sourceJson, report);
    await atomicText(sourceMarkdown, "# QA_RESULT_V2\n\nPASS\n");
    await writeReport({
      outputRoot: root,
      jobId,
      runToken,
      sourceJson,
      sourceMarkdown,
    });
    await writeCompletion({
      outputRoot: root,
      jobId,
      runToken,
    });
    const result = await verify({ outputRoot: root, jobId, runToken });
    await writeFile(path.join(root, reportMarkdown), "tampered\n");
    let tamperRejected = false;
    try {
      await verify({ outputRoot: root, jobId, runToken });
    } catch (error) {
      tamperRejected = String(error.message).includes("SHA-256");
    }
    if (!tamperRejected) throw new Error("tampered report was accepted");
    return { ...result, duplicateRejected, tamperRejected };
  } finally {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep)) {
      throw new Error("refusing to remove a non-temporary self-test directory");
    }
    await rm(resolved, { recursive: true, force: true });
  }
}

const args = argsOf(process.argv.slice(2));
const mode = args.get("self-test") ? "self-test" : (args.get("mode") ?? "verify");
const common = mode === "self-test"
  ? null
  : {
      outputRoot: required(args, "output-root"),
      jobId: required(args, "job-id"),
      runToken: required(args, "run-token"),
    };
let result;
switch (mode) {
  case "self-test":
    result = await selfTest();
    break;
  case "ack":
    result = await writeAck({
      ...common,
      mutationLimit: args.get("mutation-limit") ?? "0",
      preflight: decodePreflight(required(args, "preflight-base64")),
      acknowledgedBy: args.get("acknowledged-by"),
    });
    break;
  case "progress":
    result = await writeProgress({
      ...common,
      phase: required(args, "phase"),
      mutationTotal: args.get("mutation-total") ?? "0",
    });
    break;
  case "report":
    result = await writeReport({
      ...common,
      sourceJson: required(args, "source-json"),
      sourceMarkdown: required(args, "source-markdown"),
    });
    break;
  case "complete":
    result = await writeCompletion({
      ...common,
    });
    break;
  case "verify":
    result = await verify(common);
    break;
  default:
    throw new Error(`Unsupported --mode: ${mode}`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
function validatePreflight(preflight) {
  if (!preflight || typeof preflight !== "object" || Array.isArray(preflight)) {
    throw new Error("preflight must be a JSON object with the seven recorded capabilities");
  }
  const keys = Object.keys(preflight).sort();
  const expected = [...PREFLIGHT_CAPABILITIES].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    const missing = expected.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !expected.includes(key));
    throw new Error("preflight capability set mismatch (missing: " +
      (missing.join(",") || "none") + "; extra: " + (extra.join(",") || "none") + ")");
  }
  for (const capability of PREFLIGHT_CAPABILITIES) {
    if (preflight[capability] !== "PASS" && preflight[capability] !== "BLOCKED") {
      throw new Error("preflight." + capability + " must be PASS or BLOCKED");
    }
  }
  return Object.freeze({ ...preflight });
}
/**
 * Mirrors the repository contract (packages/cli/src/acceptance/browser-qa-contract.ts):
 * the visual area is proven by EITHER instrument; the gaps that require an
 * explicit acknowledgment are the required capabilities that failed plus BOTH
 * visual instruments when neither is available.
 */
function decidePreflightGate(preflight, acknowledgedBy) {
  const blockedCapabilities = PREFLIGHT_CAPABILITIES.filter((capability) => preflight[capability] !== "PASS");
  const uncovered = REQUIRED_PREFLIGHT_CAPABILITIES.filter((capability) => preflight[capability] !== "PASS");
  const visualAvailable = ALTERNATIVE_VISUAL_CAPABILITIES.some((capability) => preflight[capability] === "PASS");
  if (!visualAvailable) uncovered.push(...ALTERNATIVE_VISUAL_CAPABILITIES);
  if (uncovered.length === 0) {
    return { gate: "proceed", blockedCapabilities, uncoveredCapabilities: [] };
  }
  if (typeof acknowledgedBy === "string" && acknowledgedBy.trim().length > 0) {
    return { gate: "proceed_reduced", blockedCapabilities, uncoveredCapabilities: uncovered };
  }
  return { gate: "stop", blockedCapabilities, uncoveredCapabilities: uncovered };
}
function decodePreflight(encoded) {
  let value;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("--preflight-base64 must encode a valid preflight JSON object");
  }
  return validatePreflight(value);
}
async function readAckForJob(root, jobId, runToken) {
  const ack = await json(path.join(root, jobId + ".ack.json"), "ACK");
  equal(ack.jobId, jobId, "ACK jobId");
  equal(ack.runToken, runToken, "ACK runToken");
  validatePreflight(ack.preflight);
  const expectedGate = decidePreflightGate(ack.preflight, ack.acknowledgedBy);
  equal(ack.preflightGate, expectedGate.gate, "ACK preflight gate");
  equal(JSON.stringify(ack.blockedCapabilities), JSON.stringify(expectedGate.blockedCapabilities), "ACK blocked capabilities");
  if (expectedGate.gate === "proceed_reduced") {
    const missing = ack.reducedScope?.missing;
    if (!Array.isArray(missing) || JSON.stringify(missing) !== JSON.stringify(expectedGate.uncoveredCapabilities)) {
      throw new Error("ACK reduced scope must name exactly the uncovered capabilities");
    }
    equal(ack.reducedScope?.acknowledgedBy, ack.acknowledgedBy, "ACK reduced scope acknowledgment");
  }
  return ack;
}
