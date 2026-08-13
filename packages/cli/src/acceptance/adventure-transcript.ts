import type { AdventureRunResult, AdventureStepResult } from "./adventure-types.js";

type Json = Record<string, unknown>;

export interface AdventureTranscriptEntry {
  readonly step: number;
  readonly role: "player" | "master";
  readonly text: string;
  readonly worldTime: number | null;
  readonly kind: "command" | "clarification" | "result";
}

function commandText(step: AdventureStepResult): string | null {
  if ("say" in step.step) return step.step.say;
  if ("choose" in step.step) return step.step.choose;
  if ("answerClarification" in step.step) return step.step.answerClarification;
  return null;
}

function worldTime(step: AdventureStepResult): number | null {
  const state = (step.snapshot.state as Json | undefined)?.state as Json | undefined;
  return typeof state?.worldTime === "number" ? state.worldTime : null;
}

function narrationText(step: AdventureStepResult): string | null {
  const journal = step.snapshot.journal as Json | undefined;
  const turns = Array.isArray(journal?.turns) ? journal.turns as Json[] : [];
  const time = worldTime(step);
  const turn = [...turns].reverse().find((entry) => entry.worldTime === time);
  const narration = turn?.narrativeLLM as Json | undefined;
  return typeof narration?.text === "string" ? narration.text : null;
}

function presentationText(step: AdventureStepResult): string | null {
  const presentation = step.body.presentation as Json | undefined;
  const primary = presentation?.primary as Json | undefined;
  return typeof primary?.text === "string" ? primary.text : null;
}

/**
 * Converts a run into a player-facing alternating transcript. Internal event
 * ids, coordinates and rule metadata never enter this artifact.
 */
export function buildAdventureTranscript(result: AdventureRunResult): readonly AdventureTranscriptEntry[] {
  const entries: AdventureTranscriptEntry[] = [];
  for (const step of result.steps) {
    const command = commandText(step);
    if (command !== null) {
      entries.push({ step: step.index, role: "player", text: command, worldTime: worldTime(step), kind: "command" });
      if (step.body.status === "clarification") {
        const question = typeof step.body.question === "string" ? step.body.question : "Уточни, что ты хочешь сделать.";
        entries.push({ step: step.index, role: "master", text: question, worldTime: worldTime(step), kind: "clarification" });
      } else {
        const resultText = narrationText(step) ?? presentationText(step);
        if (resultText) entries.push({ step: step.index, role: "master", text: resultText, worldTime: worldTime(step), kind: "result" });
      }
    }
  }
  return entries;
}
