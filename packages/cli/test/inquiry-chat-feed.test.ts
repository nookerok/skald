// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function element(tag) {
  return {
    tagName: tag.toUpperCase(), className: "", textContent: "", children: [], scrollHeight: 0, scrollTop: 0,
    append(...nodes) { this.children.push(...nodes.filter(Boolean)); },
    appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes.filter(Boolean); },
    setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function allText(node) { return node.textContent + " " + (node.children || []).map(allText).join(" "); }

describe("Master inquiry chat exchange", () => {
  let feed;
  beforeEach(() => {
    feed = element("div");
    vi.stubGlobal("document", { getElementById: (id) => id === "chat-feed" ? feed : null, createElement: element });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders a question and a Master answer without a world turn", async () => {
    const { addLocalInquiry, renderChatFeed, clearLocalIntents } = await import("../public/chat-feed-view.js");
    clearLocalIntents();
    addLocalInquiry("где я?", "Ты находишься у Переправы Чёрного леса.");
    renderChatFeed([], []);
    expect(feed.children).toHaveLength(2);
    expect(allText(feed.children[0])).toContain("ТЫ");
    expect(allText(feed.children[1])).toContain("МАСТЕР");
    expect(allText(feed)).toContain("Переправы Чёрного леса");
    expect(allText(feed)).not.toContain("назвать одну цель и одно действие");
    clearLocalIntents();
  });
});
