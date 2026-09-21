/**
 * Deterministic replica clause splitting (plan_9 §1).
 *
 * A compound replica ("Я осматриваю переправу и что подсказывает вода?")
 * carries more than one understood part. The model usually splits it, but a
 * degraded model must not turn it into a generic fallback: this module
 * splits and classifies the clauses WITHOUT reading the world, so the caller
 * can execute one safe primary and answer the questions, or clarify about the
 * one part it did not understand.
 *
 * Pure and total: no world access, no events, no randomness. `parseAction` is
 * injected to keep the module free of the interpreter's own imports.
 */

import type { IntentResult } from "./types.js";
import type { ExecutableIntent } from "./intent-proposal.js";
import { classifyPlayerInput, type InquiryRequest } from "./inquiry.js";

/** One clause the deterministic layer understood as an executable action. */
export interface ReplicaActionClause {
  readonly text: string;
  readonly intent: ExecutableIntent;
}

/** True for the three intents the command layer can execute. */
function isExecutableIntent(intent: IntentResult): intent is ExecutableIntent {
  return intent.type === "ActionIntentCommand" || intent.type === "InteractionCommand" || intent.type === "JourneyIntent";
}

/** One clause the deterministic layer understood as a read-only question. */
export interface ReplicaInquiryClause {
  readonly text: string;
  readonly inquiry: InquiryRequest;
}

/** Deterministic clause classification of one replica. */
export interface ReplicaClauseClassification {
  readonly actions: readonly ReplicaActionClause[];
  readonly inquiries: readonly ReplicaInquiryClause[];
  /** Clauses the deterministic layer could not classify; never silently dropped. */
  readonly unknown: readonly string[];
}

/**
 * Clause boundaries: sentence enders, dashes, semicolons, and coordinating
 * conjunctions between independent clauses. A comma alone is kept (it usually
 * separates a question from its frame: "хочу понять, куда лучше идти").
 */
const CLAUSE_DELIMITER = /\s*(?:[—–;]|\.\s+|[?!]\s*|,\s*(?:затем|потом|после|и|а|но)\s+|\s+(?:и|а|но|затем|потом)\s+)\s*/u;

/** Splits a replica into trimmed, non-empty clauses in order. */
export function splitReplicaClauses(input: string): readonly string[] {
  return Object.freeze(
    input
      .split(CLAUSE_DELIMITER)
      // A sentence delimiter can leave the next conjunction attached
      // ("где я? и кто рядом?"), so strip one leading connector.
      .map((clause) => clause.replace(/^(?:и|а|но|затем|потом)\s+/iu, "").trim())
      .filter((clause) => clause.length > 0),
  );
}

/**
 * Splits and classifies one replica. The whole replica is returned as a
 * single clause when no boundary applies, so a simple command is unchanged.
 */
export function classifyReplicaClauses(
  input: string,
  parseAction: (value: string) => IntentResult,
): ReplicaClauseClassification {
  const actions: ReplicaActionClause[] = [];
  const inquiries: ReplicaInquiryClause[] = [];
  const unknown: string[] = [];
  for (const text of splitReplicaClauses(input)) {
    const classified = classifyPlayerInput(text, parseAction);
    if (classified.kind === "inquiry") {
      inquiries.push(Object.freeze({ text, inquiry: classified.inquiry }));
      continue;
    }
    // "осматриваю двор, что я вижу?" — an action and a question joined by a
    // comma. The whole-clause parse would swallow the question into the action
    // target, so try the comma split before accepting the action (plan_9 §1).
    const joined = splitActionAndQuestion(text, parseAction);
    if (joined) {
      actions.push(Object.freeze({ text: joined.action.text, intent: joined.action.intent }));
      inquiries.push(Object.freeze({ text: joined.inquiry.text, inquiry: joined.inquiry.inquiry }));
      continue;
    }
    if ((classified.kind === "action" || classified.kind === "speech") && isExecutableIntent(classified.intent)) {
      actions.push(Object.freeze({ text, intent: classified.intent }));
      continue;
    }
    unknown.push(text);
  }
  return Object.freeze({
    actions: Object.freeze(actions),
    inquiries: Object.freeze(inquiries),
    unknown: Object.freeze(unknown),
  });
}

/**
 * Splits "<action>, <question>" into its two parts when the head is an
 * executable action and the tail is a recognised inquiry. Returns null when
 * either half is unclear, so genuine frames ("хочу узнать, кто рядом") and
 * unknown clauses keep their current handling.
 */
function splitActionAndQuestion(
  text: string,
  parseAction: (value: string) => IntentResult,
): { readonly action: ReplicaActionClause; readonly inquiry: ReplicaInquiryClause } | null {
  const comma = text.lastIndexOf(",");
  if (comma <= 0) return null;
  const head = text.slice(0, comma).trim();
  const tail = text.slice(comma + 1).trim();
  if (head.length === 0 || tail.length === 0) return null;
  const tailClassified = classifyPlayerInput(tail, parseAction);
  if (tailClassified.kind !== "inquiry") return null;
  const headClassified = classifyPlayerInput(head, parseAction);
  if ((headClassified.kind !== "action" && headClassified.kind !== "speech") || !isExecutableIntent(headClassified.intent)) return null;
  return {
    action: Object.freeze({ text: head, intent: headClassified.intent }),
    inquiry: Object.freeze({ text: tail, inquiry: tailClassified.inquiry }),
  };
}
