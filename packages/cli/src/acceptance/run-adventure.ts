import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAdventureScenario } from "./adventure-harness.js";
import { buildAdventureTranscript } from "./adventure-transcript.js";
import type { AdventureScenario } from "./adventure-types.js";

function loadScenario(): AdventureScenario {
  const path = resolve(process.cwd(), "packages/cli/acceptance-scenarios/riverwatch-old-course.json");
  return JSON.parse(readFileSync(path, "utf8")) as AdventureScenario;
}

const result = await runAdventureScenario(loadScenario());
const failures = result.steps.flatMap((step) => step.failures.map((failure) => ({ step: step.index, failure })));
const httpFailures = result.steps.filter((step) => step.statusCode >= 400)
  .map((step) => ({ step: step.index, statusCode: step.statusCode, body: step.body }));
const trace = result.steps.map((step) => ({
  step: step.index,
  input: step.step,
  status: step.body.status,
  error: step.body.error,
  primary: ((step.body.presentation as Record<string, unknown> | undefined)?.primary as Record<string, unknown> | undefined)?.text,
  locationRef: (((step.snapshot.map as Record<string, unknown> | undefined)?.map as Record<string, unknown> | undefined)?.observer as Record<string, unknown> | undefined)?.locationRef,
  worldTime: ((step.snapshot.state as Record<string, unknown> | undefined)?.state as Record<string, unknown> | undefined)?.worldTime,
  eventTypes: (step.snapshot.events ?? []).slice(-6).map((event) => event.type),
}));
const output = { ...result.report, scenario: result.scenario.name, failures, httpFailures, trace, transcript: buildAdventureTranscript(result) };
console.log(JSON.stringify(output, null, 2));
if (!result.report.pass || failures.length > 0 || httpFailures.length > 0) process.exitCode = 1;
