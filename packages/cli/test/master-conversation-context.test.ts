import { describe, expect, it } from "vitest";
import { narrationKey } from "@skald/world";
import type { MasterTurnSceneContext, TurnNarration } from "@skald/world";
import {
  buildMasterConversationContext,
  describeConversationContext,
} from "../src/conversation/context-builder.js";
import type { ConversationTurn } from "../src/conversation/types.js";
import type { ConversationMemoryMetadataV1 } from "../src/conversation/types.js";

function row(turnSeq: number, overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnSeq,
    worldId: "w1",
    correlationId: `c${turnSeq}`,
    idempotencyKey: `k${turnSeq}`,
    playerText: "осматриваюсь",
    inputClass: "action",
    worldTimeBefore: 0,
    worldTimeAfter: 1,
    responseKind: "action_outcome",
    responseText: "Описание сцены.",
    createdAt: turnSeq,
    ...overrides,
  };
}

describe("master conversation context", () => {
  it("builds an empty context from no rows", () => {
    expect(buildMasterConversationContext([], "w1")).toEqual({
      recentTurns: [],
      recentFocus: [],
      pendingClarification: null,
      schemaVersion: 1,
      lastTurns: [],
      currentScene: null,
      recentlyMentionedEntities: [],
      activePlayerGoal: null,
      currentDramaticThread: null,
      knownFacts: [],
      knownUncertainties: [],
      truncated: false,
    });
  });

  it("keeps only the current world and sorts by turnSeq", () => {
    const context = buildMasterConversationContext([
      row(3, { playerText: "третья" }),
      row(1, { playerText: "первая", worldId: "other" }),
      row(2, { playerText: "вторая" }),
    ], "w1");

    expect(context.recentTurns.map((turn) => turn.text)).toEqual([
      "вторая", "Описание сцены.", "третья", "Описание сцены.",
    ]);
    expect(context.recentTurns.map((turn) => turn.turnSeq)).toEqual([2, 2, 3, 3]);
  });

  it("bounds the window to the last ten turns", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(index + 1, { playerText: `реплика ${index + 1}` }));
    const context = buildMasterConversationContext(rows, "w1");

    expect(context.recentTurns).toHaveLength(20);
    expect(context.recentTurns[0]).toMatchObject({ speaker: "player", text: "реплика 3", turnSeq: 3 });
  });

  it("truncates each replica to 500 characters", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "я".repeat(600), responseText: "м".repeat(600) }),
    ], "w1");

    expect(context.recentTurns[0]?.text).toHaveLength(500);
    expect(context.recentTurns[1]?.text).toHaveLength(500);
  });

  it("drops legacy fallback turns entirely", () => {
    const context = buildMasterConversationContext([
      row(1, { responseText: "Ты начинаешь действовать, но пока не видишь заметного результата." }),
    ], "w1");

    expect(context.recentTurns).toEqual([]);
    expect(context.recentFocus).toEqual([]);
  });

  it("drops technical master texts without inventing facts", () => {
    const context = buildMasterConversationContext([
      row(1, { responseKind: "clarification", inputClass: "clarification", responseText: "proposal does not match schema: unknown operation" }),
    ], "w1");

    expect(context.recentTurns).toEqual([]);
    expect(context.pendingClarification).toBeNull();
  });

  it("extracts target focus from accepted actions", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "осматриваю реку" }),
    ], "w1");

    expect(context.recentFocus).toEqual([{ kind: "target", surface: "реку", turnSeq: 1 }]);
  });

  it("extracts destination focus from accepted journeys", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "иду к Речной Страже" }),
    ], "w1");

    expect(context.recentFocus).toHaveLength(1);
    expect(context.recentFocus[0]?.surface.toLowerCase()).toContain("страж");
  });

  it("takes no focus from rejections and inquiries", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "тронуть", responseKind: "action_rejection", responseText: "Не получилось." }),
      row(2, { playerText: "где я?", inputClass: "inquiry", responseKind: "inquiry_answer", responseText: "У реки." }),
    ], "w1");

    expect(context.recentFocus).toEqual([]);
  });

  it("orders focus most-recent-first and deduplicates surfaces", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "осматриваю реку" }),
      row(2, { playerText: "слушаю" }),
      row(3, { playerText: "осматриваю реку" }),
    ], "w1");

    expect(context.recentFocus).toEqual([{ kind: "target", surface: "реку", turnSeq: 3 }]);
  });

  it("caps focus at eight hints", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1, { playerText: `осматриваю предмет${index}` }));
    const context = buildMasterConversationContext(rows, "w1");

    expect(context.recentFocus).toHaveLength(8);
    expect(context.recentFocus[0]?.turnSeq).toBe(10);
  });

  it("reports the latest clarification as pending", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "сделать что-нибудь", inputClass: "clarification", responseKind: "clarification", responseText: "Что именно сделать?" }),
    ], "w1");

    expect(context.pendingClarification).toEqual({ question: "Что именно сделать?", options: [], turnSeq: 1 });
  });

  it("clears pending once an action is accepted but keeps it past a foreign inquiry", () => {
    const clarified = row(1, { playerText: "сделать что-нибудь", inputClass: "clarification", responseKind: "clarification", responseText: "Что именно сделать?" });
    expect(buildMasterConversationContext([clarified, row(2)], "w1").pendingClarification).toBeNull();
    const foreign = buildMasterConversationContext([
      clarified,
      row(2, { playerText: "где я?", inputClass: "inquiry", responseKind: "inquiry_answer", responseText: "У реки." }),
    ], "w1");
    expect(foreign.pendingClarification?.turnSeq).toBe(1);
  });

  it("keeps the newest clarification when several are open", () => {
    const context = buildMasterConversationContext([
      row(1, { inputClass: "clarification", responseKind: "clarification", responseText: "Первый вопрос?" }),
      row(2, { inputClass: "clarification", responseKind: "clarification", responseText: "Второй вопрос?" }),
    ], "w1");

    expect(context.pendingClarification).toEqual({ question: "Второй вопрос?", options: [], turnSeq: 2 });
  });

  it("is deterministic across reloads and input order", () => {
    const rows = [
      row(1, { playerText: "осматриваю реку" }),
      row(2, { inputClass: "clarification", responseKind: "clarification", responseText: "Что именно?" }),
    ];
    const first = JSON.stringify(buildMasterConversationContext(rows, "w1"));
    const reordered = JSON.stringify(buildMasterConversationContext([...rows].reverse(), "w1"));
    const reloaded = JSON.stringify(buildMasterConversationContext(rows.map((turn) => ({ ...turn })), "w1"));

    expect(reordered).toBe(first);
    expect(reloaded).toBe(first);
  });

  it("takes focus from executed mixed turns like actions", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "осматриваю реку", inputClass: "mixed", responseKind: "mixed_outcome", responseText: "Подошёл. Вижу реку." }),
    ], "w1");

    expect(context.recentFocus).toEqual([{ kind: "target", surface: "реку", turnSeq: 1 }]);
  });

  it("resolves pending clarification on mixed and speech turns", () => {
    const clarified = row(1, { playerText: "сделай что-нибудь", inputClass: "clarification", responseKind: "clarification", responseText: "Что именно сделать?" });
    expect(buildMasterConversationContext([
      clarified,
      row(2, { playerText: "подхожу и смотрю", inputClass: "mixed", responseKind: "mixed_outcome", responseText: "Подошёл." }),
    ], "w1").pendingClarification).toBeNull();
    expect(buildMasterConversationContext([
      clarified,
      row(2, { playerText: "прошу о помощи", inputClass: "speech", responseKind: "speech_reaction", responseText: "Кивает." }),
    ], "w1").pendingClarification).toBeNull();
  });

  it("carries player text verbatim as untrusted data", () => {
    const tricky = "осмотри реку'; DROP TABLE--";
    const context = buildMasterConversationContext([row(1, { playerText: tricky })], "w1");

    expect(context.recentTurns[0]?.text).toBe(tricky);
  });
});

function metaRow(turnSeq: number, metadata: ConversationMemoryMetadataV1, overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return { ...row(turnSeq, overrides), contextMetadata: metadata } as ConversationTurn;
}

function scene(): MasterTurnSceneContext {
  return {
    schemaVersion: 1,
    revision: { worldTime: 5, eventNumber: 41 },
    currentLocation: { name: "Переправа", description: "Шум воды." },
    visibleObjects: [{ observerRef: "object_1", kind: "object", label: "Лодка", knownAs: ["Лодка"] }],
    knownPeople: [{ observerRef: "person_1", kind: "person", label: "Перевозчик", knownAs: ["Перевозчик"] }],
    knownRoutes: [{ observerRef: "route_1", kind: "route", label: "Тропа вдоль реки", knownAs: ["Тропа вдоль реки"], status: "open" }],
    accessibleItems: [],
    availableActions: [],
    currentSituation: { title: "Туман над водой", description: "Видимость низкая." },
    knownTopics: [
      { observerRef: "topic_1", category: "seen", text: "Видел лодку у берега.", status: "current" },
      { observerRef: "topic_2", category: "told", text: "Говорят, за рекой страж.", status: "current" },
      { observerRef: "topic_3", category: "inferred", text: "Похоже, будет дождь.", status: "uncertain" },
      { observerRef: "topic_4", category: "doubt", text: "Может, переправа закрыта.", status: "uncertain" },
    ],
  };
}

function narration(text: string, usedFallback = false): TurnNarration {
  return { text, model: "test-model", usedFallback, fallbackReason: null, latencyMs: 3 };
}

describe("plan_7 transcript memory", () => {
  it("bounds lastTurns to twelve replicas and flags truncation", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1, { playerText: `реплика ${index + 1}` }));
    const context = buildMasterConversationContext(rows, "w1");

    expect(context.lastTurns).toHaveLength(12);
    expect(context.lastTurns[0]).toMatchObject({ speaker: "player", text: "реплика 5", turnSeq: 5 });
    expect(context.lastTurns[11]).toMatchObject({ speaker: "master", turnSeq: 10 });
    expect(context.truncated).toBe(true);
  });

  it("keeps short histories untruncated and ascending", () => {
    const context = buildMasterConversationContext([row(1), row(2)], "w1");

    expect(context.lastTurns.map((message) => [message.speaker, message.turnSeq])).toEqual([
      ["player", 1], ["master", 1], ["player", 2], ["master", 2],
    ]);
    expect(context.truncated).toBe(false);
  });

  it("marks truncation when history may extend past the scan", () => {
    const rows = [row(1), row(2), row(3), row(4)];
    expect(buildMasterConversationContext(rows, "w1", { scanLimit: 4 }).truncated).toBe(true);
    expect(buildMasterConversationContext(rows.slice(1), "w1", { scanLimit: 4 }).truncated).toBe(false);
  });

  it("prefers the shown narration paired by worldTime and correlationId", () => {
    const turn = row(1, { correlationId: "cmd-1", worldTimeAfter: 1, responseText: "Детерминированный ответ." });
    const narrations = new Map([[narrationKey(1, "cmd-1"), narration("Показанный игроку текст.")]]);
    const context = buildMasterConversationContext([turn], "w1", { narrations });

    expect(context.lastTurns.find((message) => message.speaker === "master")?.text).toBe("Показанный игроку текст.");
  });

  it("ignores fallback, foreign and uncorrelated narrations", () => {
    const turn = row(1, { correlationId: "cmd-1", worldTimeAfter: 1, responseText: "Детерминированный ответ." });
    const fallback = new Map([[narrationKey(1, "cmd-1"), narration("Черновик.", true)]]);
    expect(buildMasterConversationContext([turn], "w1", { narrations: fallback }).lastTurns[1]?.text)
      .toBe("Детерминированный ответ.");
    const foreign = new Map([[narrationKey(1, "cmd-2"), narration("Чужой текст.")]]);
    expect(buildMasterConversationContext([turn], "w1", { narrations: foreign }).lastTurns[1]?.text)
      .toBe("Детерминированный ответ.");
    const legacy = row(2, { correlationId: "", worldTimeAfter: 2, responseText: "Старый ответ." });
    const uncorrelated = new Map([[narrationKey(2, ""), narration("Неподходящий текст.")]]);
    expect(buildMasterConversationContext([legacy], "w1", { narrations: uncorrelated }).lastTurns[1]?.text)
      .toBe("Старый ответ.");
  });

  it("appends the pending clarification past the window edge", () => {
    const open = [
      row(1, {
        playerText: "Поговорю с ним.",
        inputClass: "clarification",
        responseKind: "clarification",
        responseText: "С перевозчиком или со стражем?",
      }),
      ...Array.from({ length: 8 }, (_, index) => row(index + 2, {
        playerText: `заметка ${index + 2}`,
        inputClass: "meta",
        responseKind: "meta_answer",
        responseText: `Принято ${index + 2}.`,
      })),
    ];
    const context = buildMasterConversationContext(open, "w1");

    expect(context.pendingClarification?.turnSeq).toBe(1);
    expect(context.lastTurns).toHaveLength(13);
    expect(context.lastTurns[context.lastTurns.length - 1]).toMatchObject({
      speaker: "master",
      text: "С перевозчиком или со стражем?",
      turnSeq: 1,
    });
  });

  it("keeps the player replica when the master text is technical", () => {
    const context = buildMasterConversationContext([
      row(1, { playerText: "иду", responseText: "proposal does not match schema: unknown operation" }),
    ], "w1");

    expect(context.lastTurns).toHaveLength(1);
    expect(context.lastTurns[0]).toMatchObject({ speaker: "player", text: "иду" });
  });

  it("restores structured clarification options from metadata", () => {
    const context = buildMasterConversationContext([
      metaRow(1, {
        schemaVersion: 1,
        clarification: {
          question: "С перевозчиком или со стражем?",
          options: [
            { optionId: "carrier", label: "С перевозчиком" },
            { optionId: "guard", label: "Со стражем" },
          ],
        },
      }, {
        playerText: "Поговорю с ним.",
        inputClass: "clarification",
        responseKind: "clarification",
        responseText: "С перевозчиком или со стражем?",
      }),
    ], "w1");

    expect(context.pendingClarification).toEqual({
      question: "С перевозчиком или со стражем?",
      options: [
        { optionId: "carrier", label: "С перевозчиком" },
        { optionId: "guard", label: "Со стражем" },
      ],
      turnSeq: 1,
    });
  });

  it("tracks, replaces, cancels and drops the player goal", () => {
    const goal = (summary: string): ConversationMemoryMetadataV1 => ({ schemaVersion: 1, goal: { summary } });
    const tracked = buildMasterConversationContext([metaRow(1, goal("Найти русло"))], "w1");
    expect(tracked.activePlayerGoal).toMatchObject({ summary: "Найти русло", originTurnSeq: 1 });

    const replaced = buildMasterConversationContext([
      metaRow(1, goal("Найти русло")),
      metaRow(2, goal("Вернуться домой")),
    ], "w1");
    expect(replaced.activePlayerGoal).toMatchObject({ summary: "Вернуться домой", originTurnSeq: 2 });

    const cancelled = buildMasterConversationContext([
      metaRow(1, goal("Найти русло")),
      metaRow(2, { schemaVersion: 1, continuation: { relation: "cancels", clarificationTurnSeq: 0 } }),
    ], "w1");
    expect(cancelled.activePlayerGoal).toBeNull();

    const aged = Array.from({ length: 8 }, (_, index) => {
      if (index === 0) return metaRow(1, goal("Найти русло"), { playerText: "цель" });
      return row(index + 1, { playerText: `реплика ${index + 1}` });
    });
    expect(buildMasterConversationContext(aged, "w1").activePlayerGoal).toBeNull();
  });

  it("selects the dramatic thread by deterministic priority", () => {
    const clarified = row(1, {
      playerText: "Поговорю с ним.",
      inputClass: "clarification",
      responseKind: "clarification",
      responseText: "С кем?",
    });
    const pending = buildMasterConversationContext([clarified], "w1", { scene: scene() });
    expect(pending.currentDramaticThread).toMatchObject({ source: "pending_clarification", originTurnSeq: 1 });

    const goaled = buildMasterConversationContext(
      [metaRow(1, { schemaVersion: 1, goal: { summary: "Найти русло" } })], "w1", { scene: scene() });
    expect(goaled.currentDramaticThread).toMatchObject({ source: "player_goal", title: "Найти русло" });

    const situated = buildMasterConversationContext([row(1)], "w1", { scene: scene() });
    expect(situated.currentDramaticThread).toMatchObject({ source: "observed_situation", title: "Туман над водой" });

    const hooked = buildMasterConversationContext([row(1)], "w1", {
      scene: { ...scene(), currentSituation: null },
      personalHook: "Держать слово",
    });
    expect(hooked.currentDramaticThread).toMatchObject({ source: "personal_hook", title: "Держать слово" });

    const empty = buildMasterConversationContext([row(1)], "w1", { scene: { ...scene(), currentSituation: null } });
    expect(empty.currentDramaticThread).toBeNull();
  });

  it("splits seen facts from told, inferred and doubted uncertainties", () => {
    const context = buildMasterConversationContext([row(1)], "w1", { scene: scene() });

    expect(context.knownFacts).toEqual([{ text: "Видел лодку у берега." }]);
    expect(context.knownUncertainties).toEqual([
      { text: "Говорят, за рекой страж." },
      { text: "Похоже, будет дождь." },
      { text: "Может, переправа закрыта." },
    ]);
    expect(buildMasterConversationContext([row(1)], "w1").knownFacts).toEqual([]);
  });

  it("resolves mentions against the current scene without persisting handles", () => {
    const context = buildMasterConversationContext([
      metaRow(1, {
        schemaVersion: 1,
        mentions: [
          { kind: "person", role: "target", label: "перевозчик" },
          { kind: "route", role: "destination", label: "заброшенная мельница" },
        ],
      }),
    ], "w1", { scene: scene() });

    expect(context.recentlyMentionedEntities).toEqual([
      { kind: "person", role: "target", label: "перевозчик", observerRef: "person_1", turnSeq: 1 },
      { kind: "route", role: "destination", label: "заброшенная мельница", turnSeq: 1 },
    ]);
  });

  it("recovers a journey destination as a route mention without a scene", () => {
    const context = buildMasterConversationContext([row(1, { playerText: "иду к Речной Страже" })], "w1");

    expect(context.recentlyMentionedEntities).toHaveLength(1);
    expect(context.recentlyMentionedEntities[0]).toMatchObject({ kind: "route", role: "destination", turnSeq: 1 });
    expect(context.recentlyMentionedEntities[0]?.label.toLowerCase()).toContain("страж");
  });

  it("freezes the context and summarizes secret-free diagnostics", () => {
    const context = buildMasterConversationContext([
      metaRow(1, {
        schemaVersion: 1,
        mentions: [{ kind: "person", role: "target", label: "перевозчик" }],
        goal: { summary: "Найти русло" },
      }),
    ], "w1", { scene: scene() });

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.lastTurns)).toBe(true);
    expect(describeConversationContext(context)).toEqual({
      messageCount: 2,
      mentionCount: 1,
      hasPendingClarification: false,
      hasGoal: true,
      hasDramaticThread: true,
      truncated: false,
    });
    expect(JSON.stringify(describeConversationContext(context))).not.toContain("перевозчик");
  });

  it("resolves and abandons clarification through continuation links", () => {
    const clarified = (seq: number, question: string): ConversationTurn => row(seq, {
      playerText: "сделать что-нибудь",
      inputClass: "clarification",
      responseKind: "clarification",
      responseText: question,
    });
    const linked = (seq: number, relation: "resolves" | "continues" | "new_topic" | "cancels", target: number): ConversationTurn =>
      metaRow(seq, { schemaVersion: 1, continuation: { relation, clarificationTurnSeq: target } });
    // An explicit answer resolves the question even without acting.
    expect(buildMasterConversationContext([
      clarified(1, "Что именно?"),
      linked(2, "continues", 1),
    ], "w1").pendingClarification).toBeNull();
    // A topic change abandons it without answering.
    expect(buildMasterConversationContext([
      clarified(1, "Что именно?"),
      linked(2, "new_topic", 1),
    ], "w1").pendingClarification).toBeNull();
    // An unrelated link on a read-only turn leaves it open.
    expect(buildMasterConversationContext([
      clarified(1, "Что именно?"),
      {
        ...linked(2, "continues", 9),
        playerText: "где я?",
        inputClass: "inquiry",
        responseKind: "inquiry_answer",
        responseText: "У реки.",
      },
    ], "w1").pendingClarification?.turnSeq).toBe(1);
    // A newer clarification supersedes the older one.
    expect(buildMasterConversationContext([
      clarified(1, "Первый вопрос?"),
      clarified(2, "Второй вопрос?"),
    ], "w1").pendingClarification?.turnSeq).toBe(2);
  });

  it("takes focus from inquiry and speech metadata on par with actions", () => {
    const context = buildMasterConversationContext([
      metaRow(1, {
        schemaVersion: 1,
        mentions: [{ kind: "person", role: "addressee", label: "перевозчик" }],
      }, { playerText: "Спрошу у него.", inputClass: "inquiry", responseKind: "inquiry_answer", responseText: "Он молчит." }),
      metaRow(2, {
        schemaVersion: 1,
        mentions: [{ kind: "object", role: "target", label: "весло" }],
      }, { playerText: "Прошу весло.", inputClass: "speech", responseKind: "speech_reaction", responseText: "Держи." }),
    ], "w1");

    expect(context.recentFocus).toEqual([
      { kind: "target", surface: "весло", turnSeq: 2 },
      { kind: "addressee", surface: "перевозчик", turnSeq: 1 },
    ]);
  });

  it("prefers structured mentions over the legacy heuristic", () => {
    const context = buildMasterConversationContext([
      metaRow(1, {
        schemaVersion: 1,
        mentions: [{ kind: "person", role: "target", label: "перевозчик" }],
      }, { playerText: "осматриваю реку" }),
    ], "w1");

    expect(context.recentFocus).toEqual([{ kind: "target", surface: "перевозчик", turnSeq: 1 }]);
  });

  it("isolates worlds and stays deterministic across reloads", () => {
    const rows = [
      metaRow(1, { schemaVersion: 1, goal: { summary: "Найти русло" } }),
      row(2, { playerText: "вторая", worldId: "other" }),
      row(3, { playerText: "третья" }),
    ];
    const first = JSON.stringify(buildMasterConversationContext(rows, "w1", { scene: scene() }));
    expect(first).not.toContain("вторая");
    expect(JSON.stringify(buildMasterConversationContext([...rows].reverse(), "w1", { scene: scene() }))).toBe(first);
    expect(JSON.stringify(buildMasterConversationContext(rows.map((turn) => ({ ...turn })), "w1", { scene: scene() }))).toBe(first);
  });
});
