import type { DiscoveryJournal } from "../discovery/types.js";
import type { KnowledgeSummary } from "./types.js";

export function buildKnowledgeSummary(discovery: DiscoveryJournal): KnowledgeSummary {
  const facts: KnowledgeSummary["facts"] = [];
  const hypotheses: KnowledgeSummary["hypotheses"] = [];
  const traces: KnowledgeSummary["traces"] = [];
  const recentEvidence: KnowledgeSummary["recentEvidence"] = [];

  for (const card of discovery.cards) {
    if (card.stage === "discovered") {
      facts.push({
        title: card.title,
        text: card.summary,
        discoveryId: card.discoveryId,
        journalTurnId: card.evidence.length > 0 ? card.evidence[card.evidence.length - 1]!.journalTurnId : "",
      });
    } else if (card.stage === "hypothesis") {
      hypotheses.push({
        title: card.title,
        text: card.summary,
        discoveryId: card.discoveryId,
        journalTurnId: card.evidence.length > 0 ? card.evidence[card.evidence.length - 1]!.journalTurnId : "",
      });
    } else if (card.stage === "trace") {
      traces.push({
        title: card.title,
        text: card.summary,
        discoveryId: card.discoveryId,
        journalTurnId: card.evidence.length > 0 ? card.evidence[card.evidence.length - 1]!.journalTurnId : "",
      });
    }
  }

  for (const ev of discovery.recentEvidence.slice(0, 5)) {
    recentEvidence.push({
      text: ev.text,
      worldTime: ev.worldTime,
      kind: ev.kind,
      journalTurnId: ev.journalTurnId,
    });
  }

  return { facts, hypotheses, traces, recentEvidence };
}
