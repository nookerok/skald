/**
 * Report rendering for the eval harness (packages/cli/src/eval/report.ts).
 *
 * `renderTranscript` is the compact player-facing dump an LLM reads to critique
 * the interface; `renderSummary` is the machine-cheap pass/fail summary.
 */

import type { EvalReport } from "./types.js";

/**
 * The Transcript Benchmark artifact: the observer-scoped player view every
 * step of a scenario, as a stable JSON document any LLM can analyse. This is
 * the input to the AI Benchmark — several models read the same transcript and
 * answer the same questions, and their answers are compared.
 */
export interface TranscriptArtifact {
  readonly scenario: string;
  readonly worldTemplate: string;
  readonly description?: string;
  readonly turns: ReadonlyArray<{
    readonly input?: string;
    readonly wait?: number;
    readonly worldTime: number;
    readonly presentation: unknown;
    readonly state: unknown;
    readonly belief: unknown;
    readonly gameShell: unknown;
    readonly observerMap?: unknown;
  }>;
  readonly finalBelief: unknown;
}

export function buildTranscriptArtifact(report: EvalReport): TranscriptArtifact {
  const turns = report.steps.map((step) => ({
    ...("input" in step.step ? { input: step.step.input } : "wait" in step.step ? { wait: step.step.wait } : {}),
    worldTime: step.worldTime,
    presentation: step.transcript.presentation,
    state: step.transcript.state,
    belief: step.transcript.belief,
    gameShell: step.transcript.gameShell,
    ...(step.transcript.observerMap !== undefined ? { observerMap: step.transcript.observerMap } : {}),
  }));
  const lastBelief = report.steps[report.steps.length - 1]?.transcript.belief ?? null;
  return {
    scenario: report.name,
    worldTemplate: report.worldTemplate,
    ...(report.description !== undefined ? { description: report.description } : {}),
    turns,
    finalBelief: lastBelief,
  };
}

function presentationLines(report: EvalReport): string[] {
  const lines: string[] = [];
  for (const step of report.steps) {
    const stepDesc = "input" in step.step ? `> ${step.step.input}` : "wait" in step.step ? `> wait ${step.step.wait}` : "> (assert)";
    const presentation = step.transcript.presentation as {
      primary?: { text?: string };
      notable?: Array<{ text?: string }>;
      background?: Array<{ text?: string }>;
    } | null;
    const texts: string[] = [];
    if (presentation?.primary?.text) texts.push(`primary: ${presentation.primary.text}`);
    for (const entry of presentation?.notable ?? []) if (entry.text) texts.push(`notable: ${entry.text}`);
    for (const entry of presentation?.background ?? []) if (entry.text) texts.push(`background: ${entry.text}`);
    lines.push(`[t=${step.worldTime}] ${stepDesc} ${texts.length ? "\n  " + texts.join("\n  ") : "(no presentation)"}`);
  }
  return lines;
}

export function renderTranscript(report: EvalReport): string {
  const belief = report.steps[report.steps.length - 1]?.transcript.belief;
  const lines: string[] = [];
  lines.push(`== ${report.name} (${report.worldTemplate}) ==`);
  lines.push(...presentationLines(report));
  lines.push(`-- player-visible belief (last step) --`);
  lines.push(JSON.stringify(belief, null, 2));
  return lines.join("\n");
}

export function renderSummary(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`[eval] ${report.pass ? "PASS" : "FAIL"} ${report.name} (${report.worldTemplate}, ${report.steps.length} steps)`);
  if (!report.pass) {
    for (const step of report.steps) {
      if (step.failures.length) {
        for (const failure of step.failures) lines.push(`  [step] ${failure}`);
      }
    }
    for (const failure of report.finalCheckFailures) lines.push(`  [final] ${failure}`);
    for (const note of report.audit.notes) lines.push(`  [audit] ${note}`);
  }
  return lines.join("\n");
}
