/**
 * Observer Thread delta — deterministic backend computation of thread
 * movement for command responses. The browser never derives change itself:
 * it receives the already-classified delta.
 *
 * The delta is derived from the returned (capped) journal DTO and the
 * checkpoint memory: a missing or incompatible checkpoint yields empty
 * arrays (no memory, no change claims).
 */

import type { DomainEvent } from "@skald/event-bus";
import { buildTurnJournal } from "../journal/builder.js";
import type { ObserverCheckpoint } from "../presence/types.js";
import { computeThreadRef } from "./definitions.js";
import type { ObserverThreadDelta, ObserverThreadJournalDTO } from "./types.js";

function emptyDelta(): ObserverThreadDelta {
  return {
    opened: [],
    changed: [],
    resolved: [],
    becameUncertain: [],
  };
}

/**
 * Builds the thread delta for one world revision against the checkpoint
 * memory. Threads known at the checkpoint are identified by their
 * deterministic refs; refs are opaque and never reveal internal keys.
 */
export function buildObserverThreadDelta(input: {
  events: readonly DomainEvent[];
  journal: ObserverThreadJournalDTO;
  checkpoint: ObserverCheckpoint | null;
}): ObserverThreadDelta {
  if (!input.checkpoint) return emptyDelta();
  const checkpointJournal = buildTurnJournal(
    input.events.slice(0, input.checkpoint.lastPresenceEventNumber),
    { skipOfflineTurns: true },
  );
  const knownAtCheckpoint = new Set(
    checkpointJournal.threads.map((thread) => computeThreadRef(thread.threadKey)),
  );

  const opened: string[] = [];
  const changed: string[] = [];
  const resolved: string[] = [];
  const becameUncertain: string[] = [];

  for (const thread of input.journal.threads) {
    const ref = thread.ref;
    const remember = knownAtCheckpoint.has(ref);
    switch (thread.changeSincePresence?.kind) {
      case "appeared":
        opened.push(ref);
        break;
      case "developed":
        changed.push(ref);
        break;
      case "resolved":
        resolved.push(ref);
        break;
      case "contradicted":
        opened.push(ref);
        break;
      default:
        break;
    }
    if (remember && (thread.knowledgeState === "uncertain" || thread.knowledgeState === "contradicted")) {
      becameUncertain.push(ref);
    }
  }

  return Object.freeze({
    opened: Object.freeze(opened),
    changed: Object.freeze(changed),
    resolved: Object.freeze(resolved),
    becameUncertain: Object.freeze(becameUncertain),
  });
}
