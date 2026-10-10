/**
 * Conversation Director context (SKALD S0 / P1).
 *
 * `buildGmContext` turns the observer-safe scene, the bounded conversation and
 * the current engagement into the versioned `GmContext` the model receives. It
 * never reads the whole World: only what the player is allowed to know, with
 * actors exposed through opaque handles (`e1`, `e2`, …) that the server maps
 * back to internal IDs.
 */

import type { MasterTurnSceneContext, SceneEngagementView } from "@skald/world";
import type { MasterConversationContext } from "./context-builder.js";
import { supportedOperations, type GmContext, type VisibleActorKey } from "@skald/intent-parser";

export interface GmContextInputs {
  readonly scene: MasterTurnSceneContext;
  readonly conversation: MasterConversationContext;
  /** Real proximity status, or null when the player stands near nobody. */
  readonly sceneEngagement?: SceneEngagementView | null;
  /** Bounded, observer-safe known facts (max ~8; never the whole belief model). */
  readonly knowledgeTexts?: readonly string[];
}

export interface GmContextBundle {
  readonly context: GmContext;
  /** Server-only handle ↔ scene observerRef map; never serialized to the model. */
  readonly handleToObserverRef: ReadonlyMap<VisibleActorKey, string>;
}

function familiarityOf(known: boolean | undefined): "stranger" | "acquaintance" {
  return known ? "acquaintance" : "stranger";
}

/** Build the observer-safe `GmContext` and the server-side handle map. */
export function buildGmContext(inputs: GmContextInputs): GmContextBundle {
  const handleToObserverRef = new Map<VisibleActorKey, string>();
  // Handles are derived from a STABLE order (observerRef), so reordering or
  // reloading the scene never renames a person the model is talking to.
  const ordered = [...inputs.scene.knownPeople].sort((a, b) => a.observerRef.localeCompare(b.observerRef));
  const actors = ordered.map((person, index) => {
    const handle: VisibleActorKey = `e${index + 1}`;
    handleToObserverRef.set(handle, person.observerRef);
    return {
      handle,
      ...(person.known ? { displayName: person.label } : {}),
      visibleDescription: person.portrait?.publicRole ?? person.portrait?.distinguishingFeatures?.join("; ") ?? "",
      familiarityTier: familiarityOf(person.known),
    } as const;
  });

  const context: GmContext = {
    schemaVersion: 1,
    scene: {
      locationDescription: inputs.scene.currentSituation?.description ?? inputs.scene.currentLocation.description,
      worldTime: String(inputs.scene.revision.worldTime),
      sceneEngagement: inputs.sceneEngagement ?? null,
    },
    actors,
    recentTurns: inputs.conversation.recentTurns.map((turn) => ({
      speaker: turn.speaker,
      text: turn.text,
      turnSeq: turn.turnSeq,
    })),
    pendingQuestion: inputs.conversation.pendingClarification
      ? { question: inputs.conversation.pendingClarification.question }
      : null,
    knownFacts: (inputs.knowledgeTexts ?? []).map((text, index) => ({ factId: `k${index + 1}`, text })),
    supportedOperations: supportedOperations(),
  };

  return { context, handleToObserverRef };
}
