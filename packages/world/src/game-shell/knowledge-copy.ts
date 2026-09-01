import type { DomainEvent } from "@skald/event-bus";
import { listCompiledRegionIds, loadCompiledRegionBundle } from "../region/bundle-loader.js";
import { CHARACTER_BACKGROUNDS } from "../setup/character-presets.js";

interface AuthoredCopy {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

// Read generated, approved content only. Raw event prose is never a catalog.
const approved: readonly AuthoredCopy[] = Object.freeze([
  ...Object.values(CHARACTER_BACKGROUNDS).map((background) => ({
    type: "KnowledgeAcquired",
    payload: { subjectId: "player", knowledgeId: `background:${background.id}`, proposition: background.startingKnowledge },
  })),
  ...listCompiledRegionIds().flatMap((id) => {
    const bundle = loadCompiledRegionBundle(id);
    return [
      ...bundle.events,
      ...(bundle.entrypoints ?? []).flatMap((entry) => entry.bootstrapEvents),
      ...(bundle.backgroundBindings ?? []).filter((binding) => binding.status === "approved").flatMap((binding) => binding.bootstrapEvents),
    ].filter((event) => ["KnowledgeAcquired", "TestimonyReceived", "EpistemicEvidenceRecorded"].includes(event.type))
      .map((event) => ({ type: event.type, payload: event.payload as Record<string, unknown> }));
  }),
]);

/** Return authored copy only when the recorded semantic claim matches it. */
export function authoredKnowledgeText(event: DomainEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  const key = event.type === "KnowledgeAcquired" ? "knowledgeId" : "claimId";
  if (typeof payload[key] !== "string") return null;
  const match = approved.find((copy) => copy.type === event.type
    && copy.payload[key] === payload[key]
    && copy.payload.proposition === payload.proposition
    && copy.payload.subjectId === payload.subjectId
    && copy.payload.observerId === payload.observerId
    && copy.payload.sourceId === payload.sourceId
    && copy.payload.relation === payload.relation);
  return typeof match?.payload.proposition === "string" ? match.payload.proposition : null;
}
