import type { BeliefModel, BeliefModelDTO } from "../observation/types.js";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { KnowledgeSummary, PlayerKnowledgeCategory, PlayerKnowledgeEntry, PlayerKnowledgePresentation, PlayerKnowledgeStatus } from "./types.js";
import { sanitizePlayerFacingText } from "./player-facing.js";
import { deepFreeze } from "../discovery/builder.js";

export function buildKnowledgeSummary(model: BeliefModel): KnowledgeSummary {
  const facts: KnowledgeSummary["facts"] = [];
  const hypotheses: KnowledgeSummary["hypotheses"] = [];
  const traces: KnowledgeSummary["traces"] = [];
  const recentEvidence: KnowledgeSummary["recentEvidence"] = [];
  for (const belief of model.beliefs.values()) {
    const item = { title: sanitizePlayerFacingText(belief.displayName), text: sanitizePlayerFacingText(belief.currentInterpretation) };
    if (belief.confidence >= 0.8) facts.push(item);
    else if (belief.confidence >= 0.6) hypotheses.push(item);
    else traces.push(item);
    for (const evidence of belief.supportingEvidence) {
      recentEvidence.push({ text: sanitizePlayerFacingText(evidence.description), worldTime: evidence.observedAt, kind: evidence.type });
    }
  }
  recentEvidence.sort((a, b) => b.worldTime - a.worldTime);
  return { facts, hypotheses, traces, recentEvidence: recentEvidence.slice(0, 5) };
}

type KnowledgeOptions = { readonly maxEntries?: number; readonly startup?: boolean };

const SAFE_LATIN = /[A-Za-z]{4,}/;
const TECHNICAL = /(?:^|[\s:_-])(?:event|object|entity|item|location|relation|pattern|belief|claim|source|evidence|unknown)[\s:_-]/i;
const INTERNAL_TOKEN = /(?:^|\s)[a-z]{2,}[a-z0-9]*[#:_-][a-z0-9_:#-]*(?:$|\s)/i;

function eventPayload(event: DomainEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
}

function sourceEventId(id: string): string | null {
  if (!id.startsWith("evidence:")) return null;
  const value = id.slice("evidence:".length);
  return value || null;
}

function observerVisible(event: DomainEvent): boolean {
  const observerId = eventPayload(event).observerId;
  return observerId === undefined || observerId === "player";
}

function categoryFor(type: string, event: DomainEvent | undefined): PlayerKnowledgeCategory | null {
  const p = event ? eventPayload(event) : {};
  if (event?.type === "EpistemicEvidenceRecorded") {
    if (p.relation === "contradicts") return "doubt";
    if (p.relation === "supports") return "inferred";
    return null;
  }
  if (type === "sensory" || type === "anomaly" || type === "ritual") return "seen";
  if (type === "testimony") return "told";
  if (type === "pattern-match" || type === "inference") {
    if (event?.type === "EpistemicEvidenceRecorded" && p.relation === "contradicts") return "doubt";
    return "inferred";
  }
  if (type === "TestimonyReceived" || type === "RelationChanged") return "told";
  if (type === "ObservationUpdated" || type === "KnowledgeAcquired") return "inferred";
  if (type === "ObjectObserved" || type === "EntityExamined" || type === "PhenomenonObserved" || type === "MovementSucceeded" || type === "PlayerLocationChanged" || type === "SoundObserved" || type === "SoundProduced" || type === "ObjectTemperatureChanged" || type === "HeatRadiated" || type === "ActionBlocked" || type === "MovementBlocked") return "seen";
  return null;
}

function originFor(category: PlayerKnowledgeCategory): string {
  switch (category) {
    case "seen": return "Ты заметил это сам.";
    case "told": return "Тебе это рассказали.";
    case "inferred": return "Это твоя версия.";
    case "doubt": return "Требуется новое наблюдение.";
  }
}

function fallbackFor(category: PlayerKnowledgeCategory): string {
  switch (category) {
    case "seen": return "Ты заметил изменение в окружающем мире.";
    case "told": return "Тебе передали свидетельство, которое ещё нужно проверить.";
    case "inferred": return "Ты заметил связь между несколькими признаками.";
    case "doubt": return "Некоторые сведения требуют новой проверки.";
  }
}

function safeText(value: string, category: PlayerKnowledgeCategory): string {
  const normalized = sanitizePlayerFacingText(value).trim();
  if (!normalized || normalized.includes("неизвестное утверждение") || SAFE_LATIN.test(normalized) || TECHNICAL.test(normalized) || INTERNAL_TOKEN.test(normalized) || normalized.includes("_")) return fallbackFor(category);
  return normalized;
}

function statusFor(category: PlayerKnowledgeCategory, age: number): PlayerKnowledgeStatus {
  if (category === "doubt") return "contradicted";
  if (category === "inferred") return "uncertain";
  return age > 12 ? "uncertain" : "current";
}

function chooseEntries(entries: readonly PlayerKnowledgeEntry[], maxEntries: number): PlayerKnowledgeEntry[] {
  const result: PlayerKnowledgeEntry[] = [];
  const used = new Set<string>();
  for (const category of ["seen", "told", "inferred", "doubt"] as const) {
    const entry = entries.find((item) => item.category === category && !used.has(item.text));
    if (entry) { result.push(entry); used.add(entry.text); }
    if (result.length >= maxEntries) return result;
  }
  for (const entry of entries) {
    if (result.length >= maxEntries || used.has(entry.text)) continue;
    result.push(entry); used.add(entry.text);
  }
  return result;
}

/**
 * Builds the sole player-safe knowledge projection. The BeliefModel remains an
 * internal read model; provenance is resolved here and never copied to DTO.
 */
export function buildPlayerKnowledgePresentation(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  model: BeliefModel | BeliefModelDTO,
  options: KnowledgeOptions = {},
): PlayerKnowledgePresentation {
  if (model.observerId !== "player") return deepFreeze({ schemaVersion: 1 as const, entries: [] });
  const byEvent = new Map(events.map((event) => [event.eventId, event]));
  const candidates: PlayerKnowledgeEntry[] = [];
  const seen = new Set<string>();
  const now = world.time;
  const beliefs = Array.isArray(model.beliefs) ? model.beliefs : [...model.beliefs.values()];
  for (const belief of beliefs) {
    for (const evidence of belief.supportingEvidence) {
      const eventId = sourceEventId(evidence.id);
      const event = eventId ? byEvent.get(eventId) : undefined;
      if (!event || !observerVisible(event)) continue;
      const eventData = eventPayload(event);
      if ((event.type === "TestimonyReceived" || event.type === "KnowledgeAcquired" || event.type === "EpistemicEvidenceRecorded") && typeof eventData.proposition === "string") continue;
      const category = categoryFor(evidence.type, event);
      if (!category) continue;
      const text = safeText(evidence.description, category);
      const key = category + "\u0000" + text;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ category, text, origin: originFor(category), status: statusFor(category, Math.max(0, now - evidence.observedAt)), worldTime: evidence.observedAt });
    }
  }
  // Bootstrap knowledge and testimony are observer-visible read-side facts,
  // but they are not necessarily represented as BeliefModel evidence. Keep
  // their authored provenance while never promoting them to direct sight.
  for (const event of events) {
    if (!observerVisible(event)) continue;
    const p = eventPayload(event);
    let category: PlayerKnowledgeCategory | null = null;
    if (event.type === "KnowledgeAcquired" && p.subjectId === "player" && typeof p.proposition === "string"
      && (typeof p.knowledgeId === "string" && (p.knowledgeId.startsWith("background:") || p.knowledgeId.startsWith("entrypoint:")))) category = "inferred";
    if (event.type === "TestimonyReceived" && p.observerId === "player" && typeof p.proposition === "string") category = "told";
    if (event.type === "EpistemicEvidenceRecorded" && p.observerId === "player" && typeof p.proposition === "string") category = p.relation === "contradicts" ? "doubt" : p.relation === "supports" ? "inferred" : null;
    if (!category) continue;
    const text = fallbackFor(category);
    const key = category + "\u0000" + text;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ category, text, origin: originFor(category), status: statusFor(category, Math.max(0, now - event.timestamp)), worldTime: event.timestamp });
  }
  for (const contradiction of model.contradictions) {
    const hasVisibleEvidence = contradiction.involvedEvidenceIds.some((id) => {
      const eventId = sourceEventId(id);
      return Boolean(eventId && byEvent.has(eventId) && observerVisible(byEvent.get(eventId)!));
    });
    if (!hasVisibleEvidence) continue;
    const text = "Свидетельства расходятся; прежняя версия требует проверки.";
    const key = "doubt\u0000" + text;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ category: "doubt", text, origin: originFor("doubt"), status: "contradicted", worldTime: contradiction.detectedAt });
    }
  }
  for (const hypothesis of model.activeHypotheses) {
    if (hypothesis.status !== "weakening" && hypothesis.status !== "refuted") continue;
    const evidenceIds = [...hypothesis.supportingEvidenceIds, ...hypothesis.contradictingEvidenceIds];
    const visible = evidenceIds.some((id) => {
      const eventId = sourceEventId(id);
      return Boolean(eventId && byEvent.has(eventId) && observerVisible(byEvent.get(eventId)!));
    });
    if (!visible) continue;
    const text = hypothesis.status === "refuted"
      ? "Прежняя версия больше не подтверждается."
      : "Прежняя версия стала менее надёжной и требует новой проверки.";
    const key = "doubt\u0000" + text;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ category: "doubt", text, origin: originFor("doubt"), status: "contradicted", worldTime: hypothesis.lastUpdated });
    }
  }
  candidates.sort((a, b) => b.worldTime - a.worldTime || a.category.localeCompare(b.category) || a.text.localeCompare(b.text));
  const maxEntries = Math.max(0, Math.min(100, options.maxEntries ?? (options.startup ? 3 : 100)));
  const entries = options.startup ? chooseEntries(candidates, maxEntries) : candidates.slice(0, maxEntries);
  return deepFreeze({ schemaVersion: 1 as const, entries: deepFreeze(entries) });
}
