import { describe, expect, it } from "vitest";
import {
  extractP3PlayerVisibleResponse,
  evaluateP3LiveModelGate,
  evaluateP3ModelBackedTurnProbe,
  p3PaidPrimaryPermissionFlag,
  summarizeP3LiveRunnerFailure,
} from "../src/acceptance/gm-p3-live-gate.js";

describe("P3 player-visible response evidence", () => {
  it("prefers the conversation response over deterministic presentation text", () => {
    expect(extractP3PlayerVisibleResponse({
      presentation: { primary: { text: "Слой проезда показал событие." } },
      masterTurn: { deterministicText: "Не используемый renderer fallback." },
      conversationTurn: { responseText: "Сейчас здесь нет подтверждённых сведений." },
    })).toEqual({
      deterministicText: "Сейчас здесь нет подтверждённых сведений.",
      deterministicSource: "conversationTurn",
      narrationText: null,
      narrationState: null,
      visibleText: "Сейчас здесь нет подтверждённых сведений.",
    });
  });

  it("uses presentation response before primary when there is no conversation turn", () => {
    expect(extractP3PlayerVisibleResponse({
      presentation: {
        response: { text: "Основной ответ." },
        primary: { text: "Сигнал события." },
      },
    })).toMatchObject({
      deterministicText: "Основной ответ.",
      deterministicSource: "presentation.response",
      visibleText: "Основной ответ.",
    });
  });

  it("lets successful narration replace the deterministic text exactly as the renderer does", () => {
    expect(extractP3PlayerVisibleResponse({
      presentation: { primary: { text: "Детерминированный ответ." } },
      journalTurn: { narrativeLLM: { text: "Наблюдаемая версия мастера.", usedFallback: false } },
    })).toEqual({
      deterministicText: "Детерминированный ответ.",
      deterministicSource: "presentation.primary",
      narrationText: "Наблюдаемая версия мастера.",
      narrationState: null,
      visibleText: "Наблюдаемая версия мастера.",
    });
  });

  it("only accepts narration attached to a conversation turn the renderer can pair", () => {
    const readOnly = extractP3PlayerVisibleResponse({
      conversationTurn: {
        inputClass: "question", responseKind: "inquiry_answer",
        responseText: "Точный наблюдаемый ответ.", narrationHandle: "question-handle",
        narrationState: "pending", worldTimeAfter: 3,
      },
      journalTurn: {
        narrationHandle: "question-handle", worldTime: 3, narrationState: "ready",
        narrativeLLM: { text: "Модельная перефразировка.", usedFallback: false },
      },
    });
    expect(readOnly).toMatchObject({
      deterministicText: "Точный наблюдаемый ответ.",
      narrationText: null,
      narrationState: "pending",
      visibleText: "Точный наблюдаемый ответ.",
    });

    const pairedAction = extractP3PlayerVisibleResponse({
      conversationTurn: {
        inputClass: "action", responseKind: "action_result",
        responseText: "Детерминированный итог.", narrationHandle: "action-handle",
        narrationState: "pending", worldTimeAfter: 4,
      },
      journalTurn: {
        narrationHandle: "action-handle", worldTime: 4, narrationState: "ready",
        narrativeLLM: { text: "Наррация именно этого хода.", usedFallback: false },
      },
    });
    expect(pairedAction).toMatchObject({
      narrationText: "Наррация именно этого хода.",
      narrationState: "ready",
      visibleText: "Наррация именно этого хода.",
    });
  });

  it("does not accept masterTurn-only text or fallback narration as visible output", () => {
    expect(extractP3PlayerVisibleResponse({
      masterTurn: { deterministicText: "Не показанный текст." },
      narrativeLLM: { text: "Не-LLM fallback.", usedFallback: true },
    })).toEqual({
      deterministicText: "",
      deterministicSource: "none",
      narrationText: null,
      narrationState: null,
      visibleText: "",
    });
  });

  it("preserves the narration lifecycle state for the acceptance ledger", () => {
    expect(extractP3PlayerVisibleResponse({
      masterTurn: { narration: { status: "pending" } },
    }).narrationState).toBe("pending");
    expect(extractP3PlayerVisibleResponse({
      journalTurn: { narrationState: "ready", narrativeLLM: { text: "Ответ.", usedFallback: false } },
    })).toMatchObject({ narrationText: "Ответ.", narrationState: "ready", visibleText: "Ответ." });
  });
});

describe("P3 live model acceptance gate", () => {
  it("rejects an all-fallback run with no actual generation", () => {
    expect(evaluateP3LiveModelGate({
      generationRequests: 0,
      successfulGenerationResponses: 0,
      successfulNarrationResponses: 0,
      acceptedDirectorDecisions: 0,
    })).toEqual({
      modelGenerationAttempted: false,
      modelGenerationSucceeded: false,
      narrationGenerated: false,
      directorDecisionAccepted: false,
    });
  });

  it("rejects a provider error even when a generation endpoint was attempted", () => {
    expect(evaluateP3LiveModelGate({
      generationRequests: 1,
      successfulGenerationResponses: 0,
      successfulNarrationResponses: 0,
      acceptedDirectorDecisions: 0,
    })).toEqual({
      modelGenerationAttempted: true,
      modelGenerationSucceeded: false,
      narrationGenerated: false,
      directorDecisionAccepted: false,
    });
  });

  it("does not treat interpretation-only generation as a live Game Master", () => {
    expect(evaluateP3LiveModelGate({
      generationRequests: 2,
      successfulGenerationResponses: 2,
      successfulNarrationResponses: 0,
      acceptedDirectorDecisions: 1,
    })).toMatchObject({
      modelGenerationAttempted: true,
      modelGenerationSucceeded: true,
      narrationGenerated: false,
      directorDecisionAccepted: true,
    });
  });

  it("passes only with a successful model response, narration and accepted Director decision", () => {
    expect(evaluateP3LiveModelGate({
      generationRequests: 1,
      successfulGenerationResponses: 1,
      successfulNarrationResponses: 1,
      acceptedDirectorDecisions: 1,
    })).toEqual({
      modelGenerationAttempted: true,
      modelGenerationSucceeded: true,
      narrationGenerated: true,
      directorDecisionAccepted: true,
    });
  });
});

describe("P3 model-backed NPC greeting probe", () => {
  const validEvidence = {
    scratchWorldHttpStatus: 201,
    scratchServerBaseUrl: "http://127.0.0.1:43123",
    commandRequests: 1,
    commandHttpStatus: 200,
    interpretCalls: 1,
    interpretCategoryCalls: 1,
    commandInterpretCalls: 1,
    generationRequests: 1,
    successfulGenerationResponses: 1,
    directorDecisionAccepted: true,
    directorOutcome: "accepted",
    directorDecisionKind: "conversation",
    directorAddresseeKind: "npc",
    directorProvider: "opencode_server",
    directorModel: "opencode-go/glm-5.3-flash",
    expectedProvider: "opencode_server",
    expectedModel: "opencode-go/glm-5.3-flash",
    scenarioId: "npc-greeting",
    playerInput: "Привет, смотритель",
    responseKind: "speech_reaction",
    responseText: "Ты здороваешься со Смотрителем речных ворот.",
    hasInternalLeak: false,
    worldTimeBefore: 0,
    worldTimeAfter: 0,
    eventDelta: 0,
    budgetBlocks: 0,
    reservationViolations: 0,
    reportedCostUsd: 0.001,
    reservedCostUsd: 0.0050944,
  } as const;

  it("passes only for one accepted pinned-model NPC greeting over scratch loopback with no state change", () => {
    expect(Object.values(evaluateP3ModelBackedTurnProbe(validEvidence)).every(Boolean)).toBe(true);
  });

  it.each([
    [{ generationRequests: 2 }, "oneActualModelGeneration"],
    [{ directorModel: "opencode/other" }, "decisionAccepted"],
    [{ directorOutcome: "fallback" }, "decisionAccepted"],
    [{ directorDecisionKind: "clarification" }, "decisionAccepted"],
    [{ directorAddresseeKind: "gm" }, "decisionAccepted"],
    [{ responseKind: "clarification" }, "acceptedReadOnlyNpcSpeech"],
    [{ responseText: "Ты особо никого не замечаешь." }, "acceptedReadOnlyNpcSpeech"],
    [{ scenarioId: "question-plan-clarification" }, "acceptedReadOnlyNpcSpeech"],
    [{ playerInput: "Что на нём надето и как он себя ведёт?" }, "acceptedReadOnlyNpcSpeech"],
    [{ scratchServerBaseUrl: "http://192.168.0.5:43123" }, "scratchServerLoopback"],
    [{ eventDelta: 1 }, "noWorldMutation"],
    [{ worldTimeAfter: 1 }, "noWorldMutation"],
    [{ budgetBlocks: 1 }, "noExtraGenerationOrBudgetBlock"],
    [{ reportedCostUsd: 0.006 }, "spendWithinReservation"],
  ] as const)("fails closed when evidence violates %s", (overrides, expectedFailure) => {
    const checks = evaluateP3ModelBackedTurnProbe({ ...validEvidence, ...overrides });
    expect(checks[expectedFailure]).toBe(false);
  });

  it.each([undefined, "", "true", "yes", "0", "2"])(
    "does not inherit paid permission without exact per-run opt-in (%s)",
    (value) => expect(p3PaidPrimaryPermissionFlag(value)).toBe("0"),
  );

  it("allows the explicit per-run paid primary opt-in", () => {
    expect(p3PaidPrimaryPermissionFlag("1")).toBe("1");
  });
});

describe("P3 runner failure evidence", () => {
  it("keeps structured safe fields and omits raw exception text", () => {
    expect(summarizeP3LiveRunnerFailure({
      name: "ProviderRequestError",
      message: "secret prompt and provider response body",
      httpStatus: 503,
      phase: "transport",
      providerCode: "service_unavailable",
    })).toEqual({
      kind: "http_error",
      name: "ProviderRequestError",
      httpStatus: 503,
      phase: "transport",
      providerCode: "service_unavailable",
    });
  });

  it.each([
    [{ name: "SqliteError", code: "SQLITE_BUSY", message: "private path" }, "sqlite_error"],
    [{ name: "TypeError", message: "private input" }, "type_error"],
    [{ name: "SyntaxError", message: "model output" }, "syntax_error"],
    [{ name: "Error", code: "ECONNRESET", message: "private host" }, "network_error"],
    [{ name: "Bad name\\n", code: "unsafe code!", message: "private data" }, "unknown_error"],
  ] as const)("classifies a failure without serializing its message", (error, kind) => {
    const summary = summarizeP3LiveRunnerFailure(error);
    expect(summary.kind).toBe(kind);
    expect(JSON.stringify(summary)).not.toContain("private");
    expect(JSON.stringify(summary)).not.toContain("model output");
  });
});
