import { describe, expect, it } from "vitest";
import { buildAdventureTranscript, stepMasterEntry } from "../src/acceptance/adventure-transcript.js";
import { evaluateAdventureCheck } from "../src/acceptance/adventure-checks.js";
import type { AdventureContext, AdventureScenario, AdventureStepResult } from "../src/acceptance/adventure-types.js";

type Json = Record<string, unknown>;

function step(index: number, say: string, body: Json, journalTurns: Json[] = []): AdventureStepResult {
  return {
    index,
    step: { say },
    statusCode: 200,
    body,
    snapshot: { journal: { turns: journalTurns }, state: { state: { worldTime: 5 } } },
    failures: [],
  };
}

function conversationTurn(over: Json = {}): Json {
  return {
    playerText: "что я знаю об этом месте",
    inputClass: "inquiry",
    responseKind: "inquiry_answer",
    responseText: "Ты знаешь переправу.",
    narrationHandle: "h1",
    correlationId: "c1",
    worldTimeAfter: 5,
    ...over,
  };
}

function foreignNarration(): Json {
  return {
    worldTime: 5,
    turnHandle: "jh-other",
    narrationHandle: "h-other",
    correlationId: "c-other",
    presentation: { response: null, primary: null, notable: [], background: [] },
    narrativeLLM: { text: "Старый чужой пересказ.", usedFallback: false },
  };
}

describe("adventure transcript per-turn answers", () => {
  it("answers an inquiry from its own MasterTurn, ignoring same-time foreign narration", () => {
    const entry = stepMasterEntry(step(0, "что я знаю об этом месте", {
      status: "inquiry",
      masterTurn: { deterministicText: "Ты знаешь переправу." },
      conversationTurn: conversationTurn(),
      inquiry: { answer: "Ты знаешь переправу." },
    }, [foreignNarration()]));
    expect(entry?.text).toBe("Ты знаешь переправу.");
    expect(entry?.source).toBe("masterTurn");
  });

  it("uses the clarification question for clarifications", () => {
    const entry = stepMasterEntry(step(0, "Иду.", {
      status: "clarification",
      question: "Куда ты хочешь направиться?",
      conversationTurn: conversationTurn({ inputClass: "clarification", responseKind: "clarification", responseText: "Куда ты хочешь направиться?" }),
      masterTurn: { deterministicText: "Куда ты хочешь направиться?" },
    }));
    expect(entry?.text).toBe("Куда ты хочешь направиться?");
    expect(entry?.source).toBe("clarification");
  });

  it("appends ready narration only when keyed to the step", () => {
    const keyed = {
      worldTime: 5,
      turnHandle: "jh-5",
      narrationHandle: "h1",
      correlationId: "c1",
      presentation: { response: null, primary: null, notable: [], background: [] },
      narrativeLLM: { text: "Вода шумит у переправы.", usedFallback: false },
    };
    const entry = stepMasterEntry(step(0, "осмотреться", {
      masterTurn: { deterministicText: "Ты видишь переправу." },
      conversationTurn: conversationTurn({ inputClass: "action", responseKind: "action_outcome", responseText: "Ты видишь переправу." }),
    }, [foreignNarration(), keyed]));
    expect(entry?.text).toBe("Ты видишь переправу.\nВода шумит у переправы.");
    expect(entry?.source).toBe("masterTurn");
  });

  it("ignores unkeyed same-time narration", () => {
    const entry = stepMasterEntry(step(0, "осмотреться", {
      masterTurn: { deterministicText: "Ты видишь переправу." },
      conversationTurn: conversationTurn({ inputClass: "action", responseKind: "action_outcome", responseText: "Ты видишь переправу." }),
    }, [foreignNarration()]));
    expect(entry?.text).toBe("Ты видишь переправу.");
  });

  it("falls back to the step-local presentation only for legacy action turns", () => {
    const legacy = stepMasterEntry(step(0, "осмотреться", {
      presentation: { primary: { text: "Ты видишь двор." }, notable: [], background: [] },
    }));
    expect(legacy?.text).toBe("Ты видишь двор.");
    expect(legacy?.source).toBe("presentation");
    const inquiry = stepMasterEntry(step(0, "кто рядом", {
      status: "inquiry",
      presentation: { primary: { text: "Чужой текст." }, notable: [], background: [] },
    }));
    expect(inquiry).toBeNull();
  });

  it("builds player/master pairs per step", () => {
    const entries = buildAdventureTranscript({
      scenario: {} as AdventureScenario,
      steps: [step(0, "кто рядом", {
        status: "inquiry",
        masterTurn: { deterministicText: "Рядом перевозчик." },
        conversationTurn: conversationTurn({ responseText: "Рядом перевозчик." }),
        inquiry: { answer: "Рядом перевозчик." },
      })],
      report: {} as never,
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ role: "player", text: "кто рядом" });
    expect(entries[1]).toMatchObject({ role: "master", text: "Рядом перевозчик.", source: "masterTurn" });
  });
});

describe("transcript_covers_every_command", () => {
  function context(steps: AdventureStepResult[]): AdventureContext {
    return { scenario: {} as AdventureScenario, steps, current: {}, initial: {}, events: [], previousClarification: false };
  }

  it("passes when every command carries its own step-local answer", () => {
    const steps = [step(0, "кто рядом", {
      status: "inquiry",
      masterTurn: { deterministicText: "Рядом перевозчик." },
      conversationTurn: conversationTurn({ responseText: "Рядом перевозчик." }),
      inquiry: { answer: "Рядом перевозчик." },
    })];
    expect(evaluateAdventureCheck("transcript_covers_every_command", context(steps))).toBe("");
  });

  it("fails a legacy presentation-only answer", () => {
    const steps = [step(0, "осмотреться", {
      presentation: { primary: { text: "Ты видишь двор." }, notable: [], background: [] },
    })];
    expect(evaluateAdventureCheck("transcript_covers_every_command", context(steps))).toContain("not step-local");
  });

  it("fails a missing master answer", () => {
    const steps = [step(0, "кто рядом", { status: "inquiry" })];
    expect(evaluateAdventureCheck("transcript_covers_every_command", context(steps))).toContain("no master answer");
  });
});
