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

function turn(t, text) {
  return { worldTime: t, presentation: { primary: { text, discoveryMark: null }, notable: [], background: [] } };
}

describe("Chronicle Feed (ADR-0024) — chat core", () => {
  let doc;
  beforeEach(() => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => vi.unstubAllGlobals());

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
    expect(feed.children[0].textContent).toBe("Мир ждёт твоего действия.");
  });

  it("is DTO-only: emits the world's primary text without leaking event types", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    renderChatFeed([turn(7, "Река поднялась.")], []);
    const rendered = doc.feed.children.map(allText).join(" ");
    expect(rendered).not.toMatch(/TickPassed|RiverLevel|state\.|ev\.|eventId/);
    expect(rendered).toContain("Река поднялась.");
  });

  it("UX-7.3 separates the two voices: player 'ТЫ' and world 'МИР'", async () => {
    const { renderChatFeed } = await import("../public/chat-feed-view.js");
    const intents = [{ worldTime: 3, text: "Ждать" }];
    renderChatFeed([turn(3, "Туман сгустился.")], intents);
    const feed = doc.feed;
    expect(allText(feed.children[0])).toContain("ТЫ");
    expect(allText(feed.children[1])).toContain("МИР");
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