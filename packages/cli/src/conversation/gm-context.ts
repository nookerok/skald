/**
 * Conversation Director context (SKALD S0 / P1).
 *
 * `buildGmContext` turns the observer-safe scene, the bounded conversation and
 * the current engagement into the versioned `GmContext` the model receives. It
 * never reads the whole World: only what the player is allowed to know, with
 * actors exposed through opaque handles (`e1`, `e2`, …) that the server maps
 * back to internal IDs.
 */

import { eligibleNpcDossierFacts, type MasterSceneReference, type MasterTurnSceneContext, type NpcDossier, type SceneEngagementView } from "@skald/world";
import type { MasterConversationContext } from "./context-builder.js";
import { createHash } from "node:crypto";
import { GM_CONTEXT_VERSION, supportedOperations, type GmContext, type GmNpcFact, type VisibleActorKey } from "@skald/intent-parser";

/** Hard cap on the known-facts slice; the builder owns the bound. */
export const MAX_KNOWN_FACTS = 8;
/** Bound NPC dossier material independently from player-known facts. */
export const MAX_NPC_DOSSIER_FACTS = 16;

/**
 * A stable, opaque handle for one scene observerRef (no shifting on insert).
 * 48 bits of sha256: large enough that a collision between two actors in one
 * scene is effectively impossible; `buildGmContext` still fail-closes on one.
 */
export function stableActorHandle(observerRef: string): VisibleActorKey {
  return `e${createHash("sha256").update(observerRef).digest("hex").slice(0, 12)}`;
}

export interface GmContextInputs {
  readonly scene: MasterTurnSceneContext;
  readonly conversation: MasterConversationContext;
  /** Real proximity status, or null when the player stands near nobody. */
  readonly sceneEngagement?: SceneEngagementView | null;
  /** Bounded, observer-safe known facts (max ~8; never the whole belief model). */
  readonly knowledgeTexts?: readonly string[];
  /** Transient server-only reference table; never copied into the prompt. */
  readonly sceneReferences?: ReadonlyMap<string, MasterSceneReference>;
  /** Replay-derived dossier projection, looked up only for visible people. */
  readonly npcDossiers?: ReadonlyMap<string, NpcDossier>;
}

export interface GmContextBundle {
  readonly context: GmContext;
  /** Server-only handle ↔ scene observerRef map; never serialized to the model. */
  readonly handleToObserverRef: ReadonlyMap<VisibleActorKey, string>;
}

function familiarityOf(known: boolean | undefined): "stranger" | "acquaintance" {
  return known ? "acquaintance" : "stranger";
}

function opaqueNpcFactId(npcId: string, factId: string): string {
  return "nf" + createHash("sha256").update(npcId + "\u0000" + factId).digest("hex").slice(0, 16);
}

function isSafeDossierText(text: string): boolean {
  return text.trim().length > 0
    && !/(?:person|object|route|location)_[a-z0-9_-]+|contact:[a-z0-9:_-]+|\b(?:targetRef|internalId|locationId|observerRef)\b|\be[a-f0-9]{12}\b/iu.test(text);
}

/** Build the observer-safe `GmContext` and the server-side handle map. */
export function buildGmContext(inputs: GmContextInputs): GmContextBundle {
  const handleToObserverRef = new Map<VisibleActorKey, string>();
  // Handles are derived from a STABLE opaque hash of the observerRef, so
  // reordering AND adding/removing another actor never renames a person the
  // model is talking to.
  const ordered = [...inputs.scene.knownPeople].sort((a, b) => a.observerRef.localeCompare(b.observerRef));
  const actors = ordered.map((person) => {
    const handle = stableActorHandle(person.observerRef);
    const existing = handleToObserverRef.get(handle);
    // Fail-closed: a hash collision would silently alias two actors, so it is
    // an error rather than a wrong conversation (review: handle collision).
    if (existing !== undefined && existing !== person.observerRef) {
      throw new Error(`gm-context: handle collision for ${handle}`);
    }
    handleToObserverRef.set(handle, person.observerRef);
    return {
      handle,
      ...(person.known ? { displayName: person.label } : {}),
      displayLabel: person.known ? person.label : "Незнакомый человек",
      visibleDescription: [
        person.portrait?.publicRole ?? person.portrait?.distinguishingFeatures?.join("; "),
        person.portrait?.addressForms?.length
          ? "Публичные формы обращения: " + person.portrait.addressForms.join(", ")
          : undefined,
      ].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(". "),
      familiarityTier: familiarityOf(person.known),
    } as const;
  });

  const visibleKnownText = new Set((inputs.knowledgeTexts ?? []).map((text) => text.trim().toLocaleLowerCase("ru-RU").replace(/ё/gu, "е")));
  const npcFactIds = new Map<string, string>();
  const npcFacts: GmNpcFact[] = [];
  for (const person of ordered) {
    const reference = inputs.sceneReferences?.get(person.observerRef);
    if (!reference || reference.kind !== "person") continue;
    const dossier = inputs.npcDossiers?.get(reference.internalId);
    if (!dossier || dossier.npcId !== reference.internalId) continue;
    const subjectHandle = stableActorHandle(person.observerRef);
    for (const fact of eligibleNpcDossierFacts(dossier, familiarityOf(person.known))) {
      const text = fact.content.text.trim();
      if (!isSafeDossierText(text)) continue;
      if (visibleKnownText.has(text.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е"))) continue;
      const opaqueId = opaqueNpcFactId(dossier.npcId, fact.factId);
      const source = dossier.npcId + "\u0000" + fact.factId;
      const existingSource = npcFactIds.get(opaqueId);
      if (existingSource !== undefined && existingSource !== source) throw new Error("gm-context: NPC fact handle collision");
      if (existingSource !== undefined) continue;
      npcFactIds.set(opaqueId, source);
      npcFacts.push(Object.freeze({ factId: opaqueId, subjectHandle, kind: fact.kind, text }));
      if (npcFacts.length >= MAX_NPC_DOSSIER_FACTS) break;
    }
    if (npcFacts.length >= MAX_NPC_DOSSIER_FACTS) break;
  }

  const nonPeople = [
    ...inputs.scene.visibleObjects,
    ...inputs.scene.knownRoutes,
    ...inputs.scene.accessibleItems.map((item) => ({ ...item, kind: "object" as const })),
    ...inputs.scene.knownTopics.map((topic) => ({ observerRef: topic.observerRef, kind: "topic" as const, label: topic.text })),
  ];
  const seenRefs = new Set<string>();
  const referents = nonPeople.flatMap((entry) => {
    if (seenRefs.has(entry.observerRef)) return [];
    seenRefs.add(entry.observerRef);
    const handle = stableActorHandle(entry.observerRef);
    const existing = handleToObserverRef.get(handle);
    if (existing !== undefined && existing !== entry.observerRef) throw new Error("gm-context: handle collision");
    handleToObserverRef.set(handle, entry.observerRef);
    return [{ handle, kind: entry.kind as "object" | "route" | "topic", label: entry.label }];
  });

  const context: GmContext = {
    schemaVersion: GM_CONTEXT_VERSION,
    scene: {
      locationDescription: inputs.scene.currentSituation?.description ?? inputs.scene.currentLocation.description,
      worldTime: String(inputs.scene.revision.worldTime),
      sceneEngagement: inputs.sceneEngagement ?? null,
    },
    actors,
    referents,
    recentTurns: inputs.conversation.recentTurns.map((turn) => ({
      speaker: turn.speaker,
      text: turn.text,
      turnSeq: turn.turnSeq,
    })),
    pendingQuestion: inputs.conversation.pendingClarification
      ? { question: inputs.conversation.pendingClarification.question }
      : null,
    knownFacts: (inputs.knowledgeTexts ?? []).slice(0, MAX_KNOWN_FACTS).map((text, index) => ({ factId: `k${index + 1}`, text })),
    npcFacts,
    supportedOperations: supportedOperations(),
  };

  return { context, handleToObserverRef };
}
