import type { AdventureRunResult, AdventureStepResult } from "./adventure-types.js";

type Json = Record<string, unknown>;

export interface AdventureTranscriptEntry {
  readonly step: number;
  readonly role: "player" | "master";
  readonly text: string;
  readonly worldTime: number | null;
  readonly kind: "command" | "clarification" | "result";
  /**
   * Where the master text came from. `masterTurn`/`conversationTurn` prove
   * the answer belongs to this step's own replica; `presentation` is the
   * legacy step-local fallback for action turns only; `narration` is never
   * a standalone source — ready narration is appended to the deterministic
   * answer, matched strictly by key, never by world time alone.
   */
  readonly source?: "masterTurn" | "conversationTurn" | "presentation" | "clarification" | undefined;
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

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function conversationTurn(step: AdventureStepResult): Json | null {
  const turn = step.body.conversationTurn;
  return turn && typeof turn === "object" && !Array.isArray(turn) ? turn as Json : null;
}

/**
 * Ready narration attached strictly by key: the conversation turn's
 * narrationHandle, or its correlationId plus worldTimeAfter. A narration
 * that shares only the world time (a read-only inquiry never advances
 * time, so several turns share one) must never leak into another turn's
 * answer.
 */
function attachedNarration(step: AdventureStepResult): string | null {
  const turn = conversationTurn(step);
  if (!turn) return null;
  const journal = step.snapshot.journal as Json | undefined;
  const turns = Array.isArray(journal?.turns) ? journal.turns as Json[] : [];
  if (turns.length === 0) return null;
  const handle = typeof turn.narrationHandle === "string" && turn.narrationHandle ? turn.narrationHandle : null;
  const correlationId = typeof turn.correlationId === "string" && turn.correlationId ? turn.correlationId : null;
  const worldTimeAfter = typeof turn.worldTimeAfter === "number" ? turn.worldTimeAfter : null;
  if (!handle && !(correlationId && worldTimeAfter !== null)) return null;
  const match = [...turns].reverse().find((entry) =>
    (handle !== null && entry.narrationHandle === handle)
    || (correlationId !== null && worldTimeAfter !== null
      && entry.correlationId === correlationId && entry.worldTime === worldTimeAfter));
  const narration = match?.narrativeLLM as Json | undefined;
  return nonEmpty(narration?.text)?.trim() ?? null;
}

/**
 * The deterministic master answer for one step, with provenance.
 * Priority: this step's MasterTurn envelope, then its persisted
 * conversation turn, then (action turns only) its own presentation
 * primary. Inquiry/meta/clarification answers never fall back to
 * presentation prose or to time-matched narration.
 */
export function stepMasterEntry(step: AdventureStepResult): { text: string; source: NonNullable<AdventureTranscriptEntry["source"]> } | null {
  if (step.body.status === "clarification") {
    const question = nonEmpty(step.body.question) ?? "Уточни, что ты хочешь сделать.";
    return { text: question, source: "clarification" };
  }
  const masterTurn = step.body.masterTurn as Json | undefined;
  const turn = conversationTurn(step);
  const inputClass = typeof turn?.inputClass === "string" ? turn.inputClass : null;
  const deterministic = nonEmpty(masterTurn?.deterministicText)
    ?? (masterTurn ? null : nonEmpty(turn?.responseText));
  if (deterministic) {
    const source = nonEmpty(masterTurn?.deterministicText) ? "masterTurn" as const : "conversationTurn" as const;
    const narration = attachedNarration(step);
    const text = narration && narration !== deterministic ? `${deterministic}\n${narration}` : deterministic;
    return { text, source };
  }
  // Legacy fallback, action turns only: this step's own presentation
  // primary. Never for inquiry/meta/clarification (by turn class or by
  // response status), never time-matched.
  const readOnly = inputClass === "inquiry" || inputClass === "meta" || inputClass === "clarification"
    || step.body.status === "inquiry" || step.body.status === "meta";
  if (!readOnly) {
    const presentation = step.body.presentation as Json | undefined;
    const primary = presentation?.primary as Json | undefined;
    const fallback = nonEmpty(primary?.text);
    if (fallback) return { text: fallback, source: "presentation" };
  }
  return null;
}

/**
 * Converts steps into player-facing alternating entries. Split from
 * buildAdventureTranscript so checks can evaluate transcript coverage
 * without a full run result.
 */
export function transcriptEntriesForSteps(steps: readonly AdventureStepResult[]): readonly AdventureTranscriptEntry[] {
  const entries: AdventureTranscriptEntry[] = [];
  for (const step of steps) {
    const command = commandText(step);
    if (command !== null) {
      entries.push({ step: step.index, role: "player", text: command, worldTime: worldTime(step), kind: "command" });
      const master = stepMasterEntry(step);
      if (master) {
        entries.push({
          step: step.index,
          role: "master",
          text: master.text,
          worldTime: worldTime(step),
          kind: step.body.status === "clarification" ? "clarification" : "result",
          source: master.source,
        });
      }
    }
  }
  return entries;
}

/**
 * Converts a run into a player-facing alternating transcript. Internal event
 * ids, coordinates and rule metadata never enter this artifact. Every
 * master entry carries the provenance of its text.
 */
export function buildAdventureTranscript(result: AdventureRunResult): readonly AdventureTranscriptEntry[] {
  return transcriptEntriesForSteps(result.steps);
}
