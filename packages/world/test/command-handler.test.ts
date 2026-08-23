import { describe, expect, it } from "vitest";
import type { ActionIntentCommand, InteractionCommand, JourneyIntent } from "@skald/intent-parser";
import { handleCommand } from "../src/command-handler.js";

const interpretation = { source: "deterministic" as const, confidence: 1, ambiguities: [] };

function serializedPayload(command: ActionIntentCommand | InteractionCommand | JourneyIntent): string {
  return JSON.stringify(handleCommand(command, "cmd-test", 7).payload);
}

function payloadKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...payloadKeys(child)]);
}

describe("handleCommand read-side text boundary", () => {
  it("does not serialize raw player text or raw reference fields into Domain Events", () => {
    const playerText = "осмотреть северную дверь и повторить 7f2c9a";
    const eventPayload = serializedPayload({
      type: "ActionIntentCommand",
      mode: "perceive",
      operation: "observe",
      target: { raw: "северную дверь", normalized: "северную дверь" },
      rawText: playerText,
      interpretation,
    });

    expect(eventPayload).not.toContain(playerText);
    expect(payloadKeys(JSON.parse(eventPayload))).not.toEqual(expect.arrayContaining(["rawText", "raw", "utterance"]));
  });

  it("keeps journey and speech payloads semantic without parser raw fields", () => {
    const journeyText = "идти к башне через западный склон 1a6b";
    const journeyPayload = serializedPayload({
      type: "JourneyIntent",
      destination: { raw: "башне", normalized: "башня" },
      routeHint: { raw: "через западный склон", normalized: "западный склон" },
      rawText: journeyText,
      interpretation,
    });
    const speechText = "сказать стражнику: это исходная реплика 2b8d";
    const speechPayload = serializedPayload({
      type: "ActionIntentCommand",
      mode: "communicate",
      operation: "speak",
      target: { raw: "стражнику", normalized: "стражник" },
      utterance: "help to исходная реплика 2b8d",
      rawText: speechText,
      interpretation,
    });

    expect(journeyPayload).not.toContain(journeyText);
    expect(speechPayload).not.toContain(speechText);
    expect(payloadKeys(JSON.parse(journeyPayload))).not.toEqual(expect.arrayContaining(["rawText", "raw", "utterance"]));
    expect(payloadKeys(JSON.parse(speechPayload))).not.toEqual(expect.arrayContaining(["rawText", "raw", "utterance"]));
    expect(JSON.parse(speechPayload).speech).toEqual({ relation: "help", target: "исходная реплика 2b8d" });
  });
});
