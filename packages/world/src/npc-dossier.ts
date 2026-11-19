import type { DomainEvent } from "@skald/event-bus";

/** Ordered familiarity levels used only for NPC dossier disclosure checks. */
export type NpcDossierFamiliarityTier = "stranger" | "acquaintance" | "familiar" | "trusted";

/** Epistemic class of one authored NPC dossier fact. */
export type NpcDossierFactKind = "world_truth" | "npc_belief" | "npc_secret";

/** A non-mechanical dossier statement; mechanical claims need typed world data. */
export interface NpcDossierFactContent {
  readonly type: "text";
  readonly text: string;
}

/** A fact stored in the canonical NPC dossier event. */
export interface NpcDossierFact {
  readonly factId: string;
  readonly kind: NpcDossierFactKind;
  readonly content: NpcDossierFactContent;
  readonly disclosure: {
    readonly minimumFamiliarityTier: NpcDossierFamiliarityTier;
    readonly requiredConditions: readonly string[];
  };
}

/** Versioned, replayable NPC dossier reconstructed only from its event. */
export interface NpcDossier {
  readonly npcId: string;
  readonly dossierVersion: number;
  readonly voice: {
    readonly styleTags: readonly string[];
    /** Null means no authored voice description is available. */
    readonly toneDescription: string | null;
  };
  readonly facts: readonly NpcDossierFact[];
}

const FAMILIARITY_RANK: Readonly<Record<NpcDossierFamiliarityTier, number>> = Object.freeze({
  stranger: 0,
  acquaintance: 1,
  familiar: 2,
  trusted: 3,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPlayerSafeDossierText(text: string): boolean {
  return !/(?:person|object|route|location)_[a-z0-9_-]+|contact:[a-z0-9:_-]+|\b(?:targetRef|internalId|locationId|observerRef)\b|\be[a-f0-9]{12}\b/iu.test(text);
}

function isFamiliarityTier(value: unknown): value is NpcDossierFamiliarityTier {
  return typeof value === "string" && Object.hasOwn(FAMILIARITY_RANK, value);
}

/** Parse and freeze a persisted dossier payload; malformed events are ignored. */
export function parseNpcDossier(value: unknown): NpcDossier | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["npcId", "dossierVersion", "voice", "facts"])
    || typeof value.npcId !== "string" || !value.npcId.startsWith("contact:") || value.npcId.length > 160
    || !Number.isInteger(value.dossierVersion) || (value.dossierVersion as number) < 1
    || !isRecord(value.voice) || !hasOnlyKeys(value.voice, ["styleTags", "toneDescription"])
    || !Array.isArray(value.voice.styleTags) || value.voice.styleTags.length > 12
    || !value.voice.styleTags.every((tag) => typeof tag === "string" && tag.trim().length > 0 && tag.length <= 80)
    || !(typeof value.voice.toneDescription === "string" || value.voice.toneDescription === null)
    || (typeof value.voice.toneDescription === "string" && value.voice.toneDescription.length > 240)
    || !Array.isArray(value.facts) || value.facts.length > 64) return null;

  const seenFactIds = new Set<string>();
  const facts: NpcDossierFact[] = [];
  for (const rawFact of value.facts) {
    if (!isRecord(rawFact) || !hasOnlyKeys(rawFact, ["factId", "kind", "content", "disclosure"])
      || typeof rawFact.factId !== "string" || !rawFact.factId.trim() || rawFact.factId.length > 200
      || seenFactIds.has(rawFact.factId)
      || (rawFact.kind !== "world_truth" && rawFact.kind !== "npc_belief" && rawFact.kind !== "npc_secret")
      || !isRecord(rawFact.content) || !hasOnlyKeys(rawFact.content, ["type", "text"]) || rawFact.content.type !== "text"
      || typeof rawFact.content.text !== "string" || !rawFact.content.text.trim() || rawFact.content.text.length > 500
      || !isPlayerSafeDossierText(rawFact.content.text)
      || !isRecord(rawFact.disclosure) || !hasOnlyKeys(rawFact.disclosure, ["minimumFamiliarityTier", "requiredConditions"])
      || !isFamiliarityTier(rawFact.disclosure.minimumFamiliarityTier)
      || !Array.isArray(rawFact.disclosure.requiredConditions)
      || rawFact.disclosure.requiredConditions.length > 16
      || !rawFact.disclosure.requiredConditions.every((condition) => typeof condition === "string" && condition.length > 0 && condition.length <= 80)) {
      return null;
    }
    seenFactIds.add(rawFact.factId);
    facts.push(Object.freeze({
      factId: rawFact.factId,
      kind: rawFact.kind,
      content: Object.freeze({ type: "text", text: rawFact.content.text }),
      disclosure: Object.freeze({
        minimumFamiliarityTier: rawFact.disclosure.minimumFamiliarityTier,
        requiredConditions: Object.freeze([...rawFact.disclosure.requiredConditions]),
      }),
    }));
  }

  return Object.freeze({
    npcId: value.npcId,
    dossierVersion: value.dossierVersion as number,
    voice: Object.freeze({
      styleTags: Object.freeze([...value.voice.styleTags]),
      toneDescription: value.voice.toneDescription,
    }),
    facts: Object.freeze(facts),
  });
}

/** Build a deterministic initial dossier event from authored public contact fields. */
export function dossierEventFromContactPlacement(placement: DomainEvent): DomainEvent | null {
  if (placement.type !== "ObjectPlaced" || !isRecord(placement.payload)) return null;
  const payload = placement.payload;
  const components = isRecord(payload.components) ? payload.components : null;
  const contact = components && isRecord(components.contact) ? components.contact : null;
  const profile = contact && isRecord(contact.profile) ? contact.profile : null;
  const npcId = typeof payload.entityId === "string" ? payload.entityId : null;
  if (!npcId || !npcId.startsWith("contact:") || !profile) return null;

  const facts: NpcDossierFact[] = [];
  const addFact = (factId: string, text: unknown) => {
    if (typeof text !== "string" || !text.trim()) return;
    facts.push({
      factId,
      kind: "world_truth",
      content: { type: "text", text: text.trim() },
      disclosure: { minimumFamiliarityTier: "stranger", requiredConditions: [] },
    });
  };
  addFact(npcId + ":public-role", profile.publicRole);
  if (Array.isArray(profile.visibleAppearance)) {
    profile.visibleAppearance.forEach((text, index) => addFact(npcId + ":appearance:" + (index + 1), text));
  }
  if (Array.isArray(profile.distinguishingFeatures)) {
    profile.distinguishingFeatures.forEach((text, index) => addFact(npcId + ":feature:" + (index + 1), text));
  }
  if (facts.length === 0) return null;

  return {
    eventId: placement.eventId + ">NpcDossierEstablished#0",
    type: "NpcDossierEstablished",
    schemaVersion: 1,
    payload: {
      npcId,
      dossierVersion: 1,
      voice: { styleTags: [], toneDescription: null },
      facts,
    },
    timestamp: placement.timestamp,
    correlationId: placement.correlationId,
    causationId: placement.eventId,
  };
}

/** Return dossier facts whose familiarity and authored conditions are satisfied. */
export function eligibleNpcDossierFacts(
  dossier: NpcDossier,
  familiarity: NpcDossierFamiliarityTier,
  satisfiedConditions: readonly string[] = [],
): readonly NpcDossierFact[] {
  const conditionSet = new Set(satisfiedConditions);
  return Object.freeze(dossier.facts.filter((fact) =>
    FAMILIARITY_RANK[familiarity] >= FAMILIARITY_RANK[fact.disclosure.minimumFamiliarityTier]
    && fact.disclosure.requiredConditions.every((condition) => conditionSet.has(condition))));
}
