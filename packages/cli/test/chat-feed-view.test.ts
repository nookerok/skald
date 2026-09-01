// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function createElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    hidden: false,
    children: [],
    scrollHeight: 0,
    scrollTop: 0,
    append(...nodes) { this.children.push(...nodes.filter(Boolean)); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes.filter(Boolean); },
    setAttribute() {},
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

  it("renders the deterministic master response before optional narrative prose", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const item = turn(5, "Ты осматриваешь двор.");
    item.narrativeLLM = { text: "Пыльный двор раскрывается в вечернем свете.", usedFallback: false };
    renderChatFeed([item], []);
    const children = doc.feed.children[0].children;
    expect(children[1].className).toBe("chat-world-primary");
    expect(children[1].textContent).toContain("Ты осматриваешь двор.");
    expect(children[2].className).toBe("chat-world-narrated");
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
