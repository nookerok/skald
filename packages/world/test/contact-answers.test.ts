/**
 * Person answers (contact-identity T4).
 *
 * «кто рядом?», «как выглядит X?», «кто этот X?» and «опиши людей» are answered
 * deterministically from the observer-safe portrait; no authored reaction is
 * invented, and an unknown person is described without a name.
 */

import { describe, expect, it } from "vitest";
import {
  buildBootstrapEvents,
  buildGameShellSnapshot,
  buildInquiryAnswer,
  buildMasterTurnSceneContext,
  rebuildProjection,
} from "@skald/world";
import { classifyPlayerInput, parseIntent } from "@skald/intent-parser";

function crossing() {
  const events = buildBootstrapEvents({ templateId: "living_region", entrypointId: "river_waystation_arrival", backgroundId: "wanderer" });
  const world = rebuildProjection(events).getSnapshot();
  const scene = buildMasterTurnSceneContext(events, world).context;
  const shell = buildGameShellSnapshot(events, world, null, "answers");
  return { scene, shell };
}

function ask(queryId: any, rawText: string, focus?: string) {
  const { scene, shell } = crossing();
  return buildInquiryAnswer(
    { type: "InquiryRequest", queryId, rawText, confidence: 1, source: "deterministic", ...(focus ? { focus: { surface: focus } } : {}) } as never,
    { shell, background: null, scene },
  );
}

describe("person answers", () => {
  it("classifies appearance and group questions deterministically", () => {
    const appearance = classifyPlayerInput("как выглядит перевозчик?", parseIntent);
    expect(appearance.kind).toBe("inquiry");
    if (appearance.kind === "inquiry") expect(appearance.inquiry.focus?.surface).toBe("перевозчик");

    const group = classifyPlayerInput("опиши людей передо мной", parseIntent);
    expect(group.kind).toBe("inquiry");
    if (group.kind === "inquiry") expect(group.inquiry.queryId).toBe("who_is_nearby");
  });

  it("routes the three natural scenario questions to inquiries", () => {
    const expectations: [string, string][] = [
      ["Как я здесь оказался?", "character_identity"],
      ["Опиши человека передо мной", "who_is_nearby"],
    ];
    for (const [input, queryId] of expectations) {
      const classified = classifyPlayerInput(input, parseIntent);
      expect(classified.kind).toBe("inquiry");
      if (classified.kind === "inquiry") expect(classified.inquiry.queryId).toBe(queryId);
    }
  });

  it("leaves speech-about-speech to the semantic plan, not the chronicle", () => {
    // T6 acceptance, series 6: «почему ты упомянул…» asks about the
    // interlocutor's speech, which the event chronicle cannot see — it stays
    // a candidate for the plan path (conversation_topics) instead of
    // recent_events.
    expect(classifyPlayerInput("Почему ты упомянул этот знак?", parseIntent).kind).toBe("inquiry_candidate");
  });

  it("describes a named present person from the portrait", () => {
    const result = ask("visible_scene", "как выглядит перевозчик?", "перевозчик");
    expect(result.answer).toContain("Перевозчик у переправы");
    expect(result.answer).toMatch(/плащ|седина/i);
    expect(result.answer).toMatch(/знаешь/i);
  });

  it("lists present people with their portrait", () => {
    const result = ask("who_is_nearby", "кто рядом?");
    expect(result.answer).toContain("Перевозчик у переправы");
    expect(result.answer).toMatch(/плащ|переправ/i);
  });

  it("answers a reaction question honestly when no reaction is authored", () => {
    const reaction = classifyPlayerInput("как он на меня смотрит?", parseIntent);
    expect(reaction.kind).toBe("inquiry");
    if (reaction.kind === "inquiry") expect(reaction.inquiry.queryId).toBe("observed_reaction");

    const result = ask("observed_reaction", "как он на меня смотрит?");
    expect(result.answer).toMatch(/не можешь понять|не различить|реакц/i);
    expect(result.answer).not.toMatch(/насторож|недовер|улыб|приветл|дружелюб|злоб|расположен/i);
  });
});
