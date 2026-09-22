// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function createElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    hidden: false,
    children: [],
    attributes: {},
    scrollHeight: 0,
    scrollTop: 0,
    append(...nodes) { this.children.push(...nodes.filter(Boolean)); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes.filter(Boolean); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function createDocument() {
  const feed = createElement("div");
  const elements = new Map([["chat-feed", feed]]);
  return {
    feed,
    getElementById(id) { return elements.get(id) || null; },
    createElement,
    querySelectorAll() { return []; },
  };
}

function allText(node) {
  return node.textContent + " " + (node.children || []).map(allText).join(" ");
}

function turn(t, text, correlationId) {
  return {
    worldTime: t,
    ...(correlationId ? { correlationId } : {}),
    presentation: {
      response: { kind: "action_outcome", text, sourceEventIds: ["event-" + t] },
      primary: { text, discoveryMark: null, sourceEventIds: ["event-" + t] },
      notable: [],
      background: [],
    },
  };
}

function conversation(key, inputClass, playerText, responseText, time, createdAt, turnSeq = 1, correlationId = "conversation:" + key) {
  return { turnSeq, worldId: "world", correlationId, idempotencyKey: key, playerText, inputClass, worldTimeBefore: time, worldTimeAfter: time, responseKind: inputClass === "inquiry" ? "inquiry_answer" : inputClass === "clarification" ? "clarification" : "action_outcome", responseText, createdAt };
}

describe("Chronicle Feed (ADR-0024) — chat core", () => {
  let doc;
  beforeEach(() => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("pairs safe DTO handles at equal time and hides unavailable diagnostics", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const first = { ...turn(1, "Первый исход."), narrationHandle: "a", narrationState: "unavailable" };
    const second = { ...turn(1, "Второй исход."), narrationHandle: "b", narrativeLLM: { text: "Второе описание.", usedFallback: false } };
    const a = { ...conversation("a", "action", "Смотрю", "Первый ответ.", 1, 10), narrationHandle: "a" };
    const b = { ...conversation("b", "action", "Слушаю", "Второй ответ.", 1, 20), narrationHandle: "b" };
    renderChatFeed([second, first], [b, a], [], null);
    expect(doc.feed.children).toHaveLength(4);
    expect(allText(doc.feed.children[0])).toContain("Смотрю");
    expect(allText(doc.feed.children[1])).toContain("Первый ответ.");
    expect(allText(doc.feed.children[1])).not.toContain("Второе описание.");
    expect(allText(doc.feed.children[2])).toContain("Слушаю");
    expect(allText(doc.feed.children[3])).toContain("Второе описание.");
    expect(allText(doc.feed)).not.toMatch(/литературное продолжение|недоступно|unavailable/);
    renderChatFeed([first, second], [a, b], [], null);
    expect(doc.feed.children).toHaveLength(4);
  });

  it("does not reuse a transcript answer for two uncorrelated equal-time turns", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([turn(1, "Сцена один."), turn(1, "Сцена два.")],
      [conversation("a", "action", "Смотрю", "Мой ответ.", 1, 10)], [], null);
    expect(allText(doc.feed).match(/Смотрю/g)).toHaveLength(1);
    expect(allText(doc.feed).match(/Мой ответ/g)).toHaveLength(1);
  });

  it("pairs the player intent before the world's answering turn", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const intents = [{ worldTime: 4, text: "идти к Переправе" }];
    renderChatFeed([turn(4, "Ты перемещаешься: Переправа.")], intents);
    const feed = doc.feed;
    expect(feed.children).toHaveLength(2);
    expect(feed.children[0].className).toBe("chat-intent");
    expect(allText(feed.children[0])).toContain("идти к Переправе");
    expect(feed.children[1].className).toBe("chat-turn");
    expect(allText(feed.children[1])).toContain("Ты перемещаешься: Переправа.");
  });

  it("replaces the deterministic answer with ready narration in the same bubble (review P1)", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const item = turn(5, "Ты осматриваешь двор.");
    item.narrativeLLM = { text: "Пыльный двор раскрывается в вечернем свете.", usedFallback: false };
    renderChatFeed([item], []);
    const children = doc.feed.children[0].children;
    expect(children[1].className).toBe("chat-world-narrated");
    expect(children[1].textContent).toContain("Пыльный двор раскрывается в вечернем свете.");
    expect(allText(doc.feed)).not.toContain("Ты осматриваешь двор.");
  });

  it("suppresses raw notable/background lines once narration is ready", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const item = turn(5, "Ты осматриваешь двор.");
    item.narrativeLLM = { text: "Двор открывается в вечернем свете; у ограды сыро.", usedFallback: false };
    item.presentation.notable = [{ text: "Столбы ограды покосились." }];
    item.presentation.background = [{ text: "Следы воды на настиле." }];
    renderChatFeed([item], []);
    const classes = doc.feed.children[0].children.map((child) => child.className);
    expect(classes).toContain("chat-world-narrated");
    expect(classes).not.toContain("chat-notable");
    expect(classes).not.toContain("chat-background");

    const pending = turn(6, "Ты осматриваешь двор.");
    pending.narrationState = "pending";
    pending.presentation.notable = [{ text: "Столбы ограды покосились." }];
    renderChatFeed([pending], []);
    expect(doc.feed.children[0].children.map((child) => child.className)).toContain("chat-notable");
  });

  it("renders a single bubble when narration duplicates the outcome", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const item = turn(5, "Перед тобой нет свободного прохода.");
    item.narrativeLLM = { text: "Перед тобой нет свободного прохода.", usedFallback: false };
    renderChatFeed([item], []);
    const text = allText(doc.feed);
    expect(text.match(/Перед тобой нет свободного прохода/g)).toHaveLength(1);
  });

  it("replaces the deterministic text even when narration expands the outcome (review P1)", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const item = turn(5, "Небольшой путевой двор у реки и кромки леса.");
    item.narrativeLLM = { text: "Взору открылся небольшой путевой двор. Двор располагался у реки и кромки леса.", usedFallback: false };
    renderChatFeed([item], []);
    const text = allText(doc.feed);
    expect(text).not.toContain("Небольшой путевой двор у реки и кромки леса.");
    expect(text).toContain("Взору открылся небольшой путевой двор.");
  });

  it("keeps the deterministic answer while narration is pending or unavailable (review P1)", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const pending = turn(5, "Ты осматриваешь двор.");
    pending.narrationState = "pending";
    renderChatFeed([pending], []);
    expect(allText(doc.feed)).toContain("Ты осматриваешь двор.");

    const failed = turn(6, "Ты слушаешь реку.");
    failed.narrativeLLM = { text: "", usedFallback: true };
    renderChatFeed([failed], []);
    const failedBubble = doc.feed.children[0];
    expect(allText(failedBubble)).toContain("Ты слушаешь реку.");
    expect(failedBubble.children.map((child) => child.className)).not.toContain("chat-world-narrated");
  });

  it("keeps the newest journal window and renders it chronologically", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const turns = Array.from({ length: 13 }, (_, i) => turn(296 - i, "ход " + (296 - i)));
    renderChatFeed(turns, []);
    const rendered = doc.feed.children.map(allText).join(" ");
    expect(rendered).toContain("ход 296");
    expect(rendered).toContain("ход 285");
    expect(rendered).not.toContain("ход 284");
    expect(rendered.indexOf("ход 285")).toBeLessThan(rendered.indexOf("ход 296"));
  });
  it("renders an unmatched intent as pending (no journal turn yet)", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([], [{ worldTime: null, text: "жду" }]);
    const feed = doc.feed;
    expect(feed.children).toHaveLength(1);
    expect(feed.children[0].className).toBe("chat-intent is-pending");
    expect(allText(feed.children[0])).toContain("жду");
  });

  it("shows only the empty invitation when nothing has happened yet", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([], []);
    const feed = doc.feed;
    expect(feed.children).toHaveLength(1);
    expect(feed.children[0].className).toBe("chat-empty");
    expect(feed.children[0].textContent).toBe("МАСТЕР ждёт твоего решения.");
  });

  it("is DTO-only: emits the world's primary text without leaking event types", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([turn(7, "Река поднялась.")], []);
    const rendered = doc.feed.children.map(allText).join(" ");
    expect(rendered).not.toMatch(/TickPassed|RiverLevel|state\.|ev\.|eventId/);
    expect(rendered).toContain("Река поднялась.");
  });

  it("hydrates a persisted action pair without duplicating its deterministic response", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([turn(8, "Действие принято.")], [conversation("a-1", "action", "осматриваюсь", "Действие принято.", 8, 100)], [], null);
    const rendered = allText(doc.feed);
    expect(doc.feed.children).toHaveLength(2);
    expect(rendered).toContain("осматриваюсь");
    expect(rendered.match(/Действие принято\./g)).toHaveLength(1);
  });

  it("pairs equal-time action turns by correlationId before falling back to world time", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const first = conversation("a-1", "action", "первое действие", "Ответ первому", 5, 10, 1, "cmd-a");
    const second = conversation("a-2", "action", "второе действие", "Ответ второму", 5, 20, 2, "cmd-b");
    renderChatFeed([
      turn(5, "Ответ первому", "cmd-a"),
      turn(5, "Ответ второму", "cmd-b"),
    ], [first, second], [], null);
    const rendered = allText(doc.feed);
    expect(doc.feed.children).toHaveLength(4);
    expect(rendered.indexOf("первое действие")).toBeLessThan(rendered.indexOf("Ответ первому"));
    expect(rendered.indexOf("второе действие")).toBeLessThan(rendered.indexOf("Ответ второму"));
    expect(rendered).not.toContain("Ответ первому Ответ второму");
  });

  it("renders inquiry and clarification turns without a journal turn", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([], [
      conversation("q-1", "inquiry", "где я?", "Ты у переправы.", 2, 20, 1),
      conversation("c-1", "clarification", "сделай это", "Уточни действие.", 2, 21, 2),
    ], [], null);
    expect(doc.feed.children).toHaveLength(4);
    expect(allText(doc.feed)).toContain("где я?");
    expect(allText(doc.feed)).toContain("Уточни действие.");
  });

  it("keeps autonomous journal turns visible and orders equal world time by createdAt", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([turn(3, "Автономный мир")], [
      conversation("late", "inquiry", "поздний вопрос", "Поздний ответ", 3, 30, 2),
      conversation("early", "inquiry", "ранний вопрос", "Ранний ответ", 3, 10, 1),
    ], [], null);
    const rendered = allText(doc.feed);
    expect(rendered.indexOf("Ранний ответ")).toBeLessThan(rendered.indexOf("Поздний ответ"));
    expect(rendered).toContain("Автономный мир");
  });

  it("UX-7.3 separates the two voices: player 'ТЫ' and master 'МАСТЕР'", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const intents = [{ worldTime: 3, text: "Ждать" }];
    renderChatFeed([turn(3, "Туман сгустился.")], intents);
    const feed = doc.feed;
    expect(allText(feed.children[0])).toContain("ТЫ");
    expect(allText(feed.children[1])).toContain("МАСТЕР");
    expect(feed.children[1].children[0].className).toBe("chat-turn-header");
  });
});

describe("Chronicle Feed (ADR-0024) — session intent helpers", () => {
  it("renders a Master clarification after the player intent", async () => {
    const doc = createDocument();
    vi.stubGlobal("document", doc);
    const mod = await import("../public/chat-feed-view.js");
    mod.clearLocalIntents();
    const intent = mod.addLocalIntent("Обойти башню", "request-clarify");
    mod.setIntentStatus(intent, "clarification");
    mod.addClarification(intent, "Ты хочешь обойти башню или только наблюдать?", [{ label: "Обойти" }, { label: "Наблюдать" }]);
    mod.renderChatFeed([], mod.getLocalIntents());
    expect(doc.feed.children).toHaveLength(2);
    expect(allText(doc.feed.children[0])).toContain("Обойти башню");
    expect(allText(doc.feed.children[1])).toContain("Ты хочешь обойти башню");
    mod.clearLocalIntents();
  });

  it("records, pairs, and clears intents within the session", async () => {
    const mod = await import("../public/chat-feed-view.js");
    const intent = mod.addLocalIntent("Осмотреться");
    mod.bindIntentWorldTime(intent, 9);
    expect(mod.getLocalIntents()).toEqual([{ worldTime: 9, text: "Осмотреться" }]);
    mod.clearLocalIntents();
    expect(mod.getLocalIntents()).toEqual([]);
  });
});

describe("Chronicle Feed (plan_9 §6-7) — turn keys, pairing, autonomy", () => {
  let doc;
  beforeEach(() => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => vi.unstubAllGlobals());

  function journalTurn(time, text, extra = {}) {
    return {
      worldTime: time,
      turnHandle: "jh-" + time,
      narrationHandle: "nh-" + time,
      presentation: {
        response: null,
        primary: { text, discoveryMark: null, sourceEventIds: ["event-" + time] },
        notable: [],
        background: [],
      },
      ...extra,
    };
  }

  function masterTurn(time, kind, text, extra = {}) {
    return {
      turnSeq: time,
      worldId: "world",
      correlationId: "cmd-" + time,
      idempotencyKey: "key-" + time,
      playerText: "реплика " + time,
      inputClass: kind === "mixed" ? "mixed" : kind === "speech" ? "speech" : "action",
      worldTimeBefore: time - 1,
      worldTimeAfter: time,
      responseKind: kind === "mixed" ? "mixed_outcome" : kind === "speech" ? "speech_reaction" : "action_outcome",
      responseText: text,
      createdAt: time,
      turnKey: "tk-" + time,
      narrationHandle: "nh-" + time,
      ...extra,
    };
  }

  it("stamps stable player-safe turn keys on both bubbles", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([journalTurn(4, "Ты осматриваешь двор.")], [masterTurn(4, "action", "Ты осматриваешь двор.")], [], null);
    const player = doc.feed.children[0];
    const master = doc.feed.children[1];
    expect(player.attributes["data-turn-key"]).toBe("tk-4");
    expect(master.attributes["data-turn-key"]).toBe("tk-4");
  });

  it("pairs one mixed turn into a single master bubble", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([journalTurn(5, "Ты осматриваешь двор.")], [masterTurn(5, "mixed", "Ты осматриваешь двор. Виден путь.")], [], null);
    const rendered = allText(doc.feed);
    expect(doc.feed.children).toHaveLength(2);
    expect(rendered.match(/Ты осматриваешь двор\. Виден путь\./g)).toHaveLength(1);
  });

  it("pairs one speech turn into a single master bubble", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([journalTurn(6, "Перевозчик кивает.")], [masterTurn(6, "speech", "Перевозчик кивает.")], [], null);
    expect(doc.feed.children).toHaveLength(2);
    expect(allText(doc.feed).match(/Перевозчик кивает\./g)).toHaveLength(1);
  });

  it("never time-pairs a mixed turn with an unrelated journal turn", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const mixed = { ...masterTurn(7, "mixed", "Смешанный ответ."), narrationHandle: undefined, correlationId: undefined };
    renderChatFeed([journalTurn(7, "Отдельный ход мира.")], [mixed], [], null);
    // Player bubble + its own master bubble + the unrelated journal bubble.
    expect(doc.feed.children).toHaveLength(3);
    expect(allText(doc.feed).match(/Смешанный ответ\./g)).toHaveLength(1);
    expect(allText(doc.feed)).toContain("Отдельный ход мира.");
  });

  it("collapses an autonomous run into one separator, never an answer", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const auto = (time, text) => ({ ...journalTurn(time, text), autonomous: true });
    renderChatFeed(
      [journalTurn(3, "Ты в пути."), auto(4, "Время идёт."), auto(5, "Время идёт."), journalTurn(6, "Ты прибыл.")],
      [], [], null,
    );
    const rendered = allText(doc.feed);
    expect(doc.feed.children).toHaveLength(3);
    const separator = doc.feed.children[1];
    expect(separator.className).toContain("chat-autonomous");
    expect(allText(separator)).toContain("Пока ты был в пути");
    // One collapsed line for the whole run, not one bubble per tick.
    expect(rendered.match(/Время идёт\./g)).toHaveLength(1);
    expect(separator.attributes["data-turn-key"]).toBe("jh-4");
  });

  it("keeps autonomous notable signals inside the separator", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const turn = { ...journalTurn(4, "Время идёт."), autonomous: true };
    turn.presentation.notable = [{ text: "Вода поднялась." }];
    renderChatFeed([turn], [], [], null);
    expect(allText(doc.feed)).toContain("Пока ты был в пути");
    expect(allText(doc.feed)).toContain("Вода поднялась.");
  });
});

describe("Chronicle Feed — one command, one MasterTurn (chain grouping)", () => {
  let doc;
  beforeEach(async () => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
    const mod = await import("../public/chat-feed-view.js");
    mod.clearLocalIntents();
  });
  afterEach(() => vi.unstubAllGlobals());

  function chainTurn(time, text, key, extra = {}) {
    return {
      worldTime: time,
      turnHandle: "jh-" + time,
      narrationHandle: "nh-" + time,
      correlationId: time === 2 ? "tick-2" : "cmd-1",
      masterTurnKey: key,
      presentation: {
        response: null,
        primary: { text, discoveryMark: null, sourceEventIds: ["event-" + time] },
        notable: [],
        background: [],
      },
      ...extra,
    };
  }

  function journeyConversation() {
    return {
      turnSeq: 9,
      worldId: "world",
      correlationId: "tick-2",
      idempotencyKey: "key-j",
      playerText: "Иду в Речной Страж.",
      inputClass: "action",
      worldTimeBefore: 0,
      worldTimeAfter: 2,
      responseKind: "action_outcome",
      responseText: "Этап 2 из 2.",
      createdAt: 30,
      turnKey: "tk-j",
      narrationHandle: "nh-2",
    };
  }

  it("renders a journey start chain as one player bubble plus one master bubble", async () => {
    const mod = await import("../public/chat-feed-view.js");
    mod.renderChatFeed(
      [chainTurn(1, "Ты отправляешься к «Речной Страж».", "mt-chain"), chainTurn(2, "Этап 2 из 2.", "mt-chain")],
      [journeyConversation()],
      [],
      null,
    );
    expect(doc.feed.children).toHaveLength(2);
    expect(allText(doc.feed.children[0])).toContain("Иду в Речной Страж.");
    const master = allText(doc.feed.children[1]);
    expect(master).toContain("Ты отправляешься к «Речной Страж».");
    expect(master).toContain("Этап 2 из 2.");
    expect(doc.feed.children[0].attributes["data-turn-key"]).toBe("tk-j");
    expect(doc.feed.children[1].attributes["data-turn-key"]).toBe("tk-j");
  });

  it("renders an unpaired chain as one master bubble keyed by masterTurnKey", async () => {
    const mod = await import("../public/chat-feed-view.js");
    mod.renderChatFeed(
      [chainTurn(1, "Ты отправляешься к «Речной Страж».", "mt-chain"), chainTurn(2, "Этап 2 из 2.", "mt-chain")],
      [],
      [],
      null,
    );
    expect(doc.feed.children).toHaveLength(1);
    expect(allText(doc.feed.children[0])).toContain("Ты отправляешься к «Речной Страж».");
    expect(doc.feed.children[0].attributes["data-turn-key"]).toBe("mt-chain");
  });

  it("keeps distinct chains separate", async () => {
    const mod = await import("../public/chat-feed-view.js");
    mod.renderChatFeed(
      [chainTurn(1, "Первая.", "mt-a"), chainTurn(2, "Вторая.", "mt-b")],
      [],
      [],
      null,
    );
    expect(doc.feed.children).toHaveLength(2);
  });

  it("binds late narration to the same chain bubble", async () => {
    const mod = await import("../public/chat-feed-view.js");
    const first = [chainTurn(1, "Ты отправляешься к «Речной Страж».", "mt-chain"), chainTurn(2, "Этап 2 из 2.", "mt-chain")];
    mod.renderChatFeed(first, [journeyConversation()], [], null);
    expect(allText(doc.feed)).not.toContain("Дорога шепчет.");
    const narrated = first.map((turn) => turn.worldTime === 2
      ? { ...turn, narrativeLLM: { text: "Дорога шепчет.", usedFallback: false } }
      : turn);
    mod.renderChatFeed(narrated, [journeyConversation()], [], null);
    expect(doc.feed.children).toHaveLength(2);
    expect(allText(doc.feed.children[1])).toContain("Дорога шепчет.");
    expect(doc.feed.children[1].attributes["data-turn-key"]).toBe("tk-j");
  });

  it("emits the echoed journey answer once per chain (review P1)", async () => {
    // Production shape: JourneyStarted carries the primary text, the
    // JourneyAdvanced slice has no presentation, and the paired
    // ConversationTurn repeats the start text. Newest-first pairing binds
    // the answer to the advanced slice, so both slices contribute the
    // same text and the chain must dedupe after assembly.
    const mod = await import("../public/chat-feed-view.js");
    const text = "Ты выступаешь к Речному Стражу.";
    const started = {
      worldTime: 5,
      masterTurnKey: "mt-journey",
      correlationId: "cmd-6",
      presentation: {
        response: { kind: "action_outcome", text, sourceEventIds: ["e-start"] },
        primary: { text, discoveryMark: null, sourceEventIds: ["e-start"] },
        notable: [],
        background: [],
      },
    };
    const advanced = {
      worldTime: 6,
      masterTurnKey: "mt-journey",
      correlationId: "cmd-6",
      presentation: null,
    };
    const cmd = {
      turnSeq: 7,
      worldId: "world",
      correlationId: "cmd-6",
      idempotencyKey: "key-j6",
      playerText: "Иду к Речному Стражу.",
      inputClass: "action",
      worldTimeBefore: 5,
      worldTimeAfter: 6,
      responseKind: "action_outcome",
      responseText: text,
      createdAt: 40,
    };
    mod.renderChatFeed([started, advanced], [cmd], [], null);
    expect(doc.feed.children).toHaveLength(2);
    const master = allText(doc.feed.children[1]);
    expect(master.match(/Ты выступаешь к Речному Стражу\./g)).toHaveLength(1);
  });
});

describe("Chronicle Feed — confirmed master pairs (one input, one MasterTurn)", () => {
  let doc;
  beforeEach(async () => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
    const mod = await import("../public/chat-feed-view.js");
    mod.clearLocalIntents();
  });
  afterEach(() => vi.unstubAllGlobals());

  function confirmed(time, text) {
    return {
      turnSeq: time,
      worldId: "world",
      correlationId: "cmd-" + time,
      idempotencyKey: "key-" + time,
      playerText: "реплика " + time,
      inputClass: "action",
      worldTimeBefore: time - 1,
      worldTimeAfter: time,
      responseKind: "action_outcome",
      responseText: text,
      createdAt: time,
      turnKey: "tk-" + time,
      narrationHandle: "nh-" + time,
    };
  }

  function masterEnvelope(time) {
    return { turnKey: "tk-" + time, kind: "action_outcome", worldTimeBefore: time - 1, worldTimeAfter: time, deterministicText: "x", narration: { status: "pending" } };
  }

  it("rejects pairs that cannot be keyed to one MasterTurn", async () => {
    const mod = await import("../public/chat-feed-view.js");
    expect(mod.upsertConfirmedPair(null, masterEnvelope(4))).toBeNull();
    expect(mod.upsertConfirmedPair(confirmed(4, "Ответ."), null)).toBeNull();
    expect(mod.upsertConfirmedPair(confirmed(4, "Ответ."), { turnKey: "tk-other" })).toBeNull();
    expect(mod.getConfirmedPairs()).toEqual([]);
  });

  it("renders the accepted pair before the journal GET succeeds", async () => {
    const mod = await import("../public/chat-feed-view.js");
    mod.upsertConfirmedPair(confirmed(4, "Ты осматриваешь двор."), masterEnvelope(4));
    // The journal request failed: latestJournal stays null, yet the
    // deterministic answer from the command response must be visible.
    mod.renderChatFeed(null);
    expect(doc.feed.children).toHaveLength(2);
    expect(allText(doc.feed.children[0])).toContain("реплика 4");
    expect(allText(doc.feed.children[1])).toContain("Ты осматриваешь двор.");
    expect(doc.feed.children[0].attributes["data-turn-key"]).toBe("tk-4");
    expect(doc.feed.children[1].attributes["data-turn-key"]).toBe("tk-4");
  });

  it("hydration confirms the same pair instead of duplicating it", async () => {
    const mod = await import("../public/chat-feed-view.js");
    mod.upsertConfirmedPair(confirmed(4, "Ты осматриваешь двор."), masterEnvelope(4));
    mod.renderChatFeed(null);
    expect(doc.feed.children).toHaveLength(2);
    const journalTurn = {
      worldTime: 4,
      turnHandle: "jh-4",
      narrationHandle: "nh-4",
      presentation: {
        response: null,
        primary: { text: "Ты осматриваешь двор.", discoveryMark: null, sourceEventIds: ["event-4"] },
        notable: [],
        background: [],
      },
    };
    mod.renderChatFeed([journalTurn], [confirmed(4, "Ты осматриваешь двор.")], [], null);
    expect(doc.feed.children).toHaveLength(2);
    expect(allText(doc.feed).match(/Ты осматриваешь двор\./g)).toHaveLength(1);
    expect(doc.feed.children[1].attributes["data-turn-key"]).toBe("tk-4");
  });

  it("drops confirmed pairs on world switch", async () => {
    const mod = await import("../public/chat-feed-view.js");
    mod.upsertConfirmedPair(confirmed(4, "Ответ."), masterEnvelope(4));
    expect(mod.getConfirmedPairs()).toHaveLength(1);
    mod.clearLocalIntents();
    expect(mod.getConfirmedPairs()).toEqual([]);
  });
});

describe("Chronicle Feed — read-side narration (full-master Stage 3)", () => {
  let doc;
  beforeEach(() => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => vi.unstubAllGlobals());

  function inquiryTurn(overrides = {}) {
    return {
      turnSeq: 1, worldId: "world", correlationId: "conversation:q1", idempotencyKey: "q1",
      playerText: "кто рядом?", inputClass: "inquiry", worldTimeBefore: 3, worldTimeAfter: 3,
      responseKind: "inquiry_answer", responseText: "Рядом с тобой: «Перевозчик у переправы».",
      createdAt: 1, turnKey: "tk-q1", narrationHandle: "nh-q1", ...overrides,
    };
  }

  it("replaces the exact answer with the ready rephrase in the SAME bubble", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([], [inquiryTurn({ narrationState: "ready", narrationText: "Перевозчик стоит рядом у плоскодонки." })], [], null);
    expect(doc.feed.children).toHaveLength(2); // ТЫ + one МАСТЕР bubble
    expect(allText(doc.feed)).toContain("Перевозчик стоит рядом у плоскодонки.");
    expect(allText(doc.feed)).not.toContain("Рядом с тобой");
  });

  it("shows the exact answer plus a pending status before the rephrase arrives", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([], [inquiryTurn({ narrationState: "pending" })], [], null);
    expect(doc.feed.children).toHaveLength(2);
    expect(allText(doc.feed)).toContain("Рядом с тобой: «Перевозчик у переправы».");
    expect(allText(doc.feed)).toContain("МАСТЕР дополняет эту запись…");
  });

  it("never renders the deterministic answer and the rephrase as two master bubbles", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([], [inquiryTurn({ narrationState: "ready", narrationText: "Перевозчик стоит рядом." })], [], null);
    const masterBubbles = doc.feed.children.filter((node) => (node.className || "").includes("chat-turn"));
    expect(masterBubbles).toHaveLength(1);
  });
});
