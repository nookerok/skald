// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("threads-view", () => {
  let container, threadsView;

  function el(tag) {
    return {
      tagName: tag,
      _attrs: {},
      _children: [],
      _events: {},
      className: "",
      textContent: "",
      hidden: false,
      setAttribute(name, value) { this._attrs[name] = value; if (name === "class" || name === "className") this.className = value; },
      getAttribute(name) { return this._attrs[name]; },
      appendChild(c) { this._children.push(c); return c; },
      append(...nodes) { this._children.push(...nodes); },
      replaceChildren(...nodes) { this._children = nodes; },
      addEventListener(type, fn) { (this._events[type] = this._events[type] || []).push(fn); },
      click() { (this._events.click || []).forEach((fn) => fn()); },
      remove() {},
      querySelector() { return null; },
    };
  }

  beforeEach(async () => {
    container = el("div");
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => container),
      createElement: vi.fn((tag) => el(tag)),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
    });
    threadsView = await import("../public/threads-view.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const journal = (threads) => ({
    schemaVersion: 1,
    revision: { worldTime: 10, eventNumber: 80 },
    threads,
    counts: { observedActive: 0, changedSincePresence: 0, uncertain: 0, recentlyResolved: 0 },
  });

  function collectText(node) {
    const parts = [node.textContent || ""];
    for (const child of node._children || []) parts.push(collectText(child));
    return parts.join(" ");
  }

  function cardText(card) {
    return collectText(card);
  }

  it("renders the empty state when no journal or no threads", () => {
    threadsView.renderThreadsPanel(container, null);
    expect(container._children[0].textContent).toContain("Пока ты не заметил процессов");

    container._children = [];
    threadsView.renderThreadsPanel(container, journal([]));
    expect(container._children[1].textContent).toContain("Пока ты не заметил процессов");
  });

  it("renders one card per thread with title, honest labels and summary", () => {
    threadsView.renderThreadsPanel(container, journal([
      {
        ref: "ot-abc", title: "Лесной пожар", knownLifecycle: "active", knowledgeState: "observed",
        summary: "При последнем наблюдении пожар продолжался.",
        firstObservedAt: 5, lastObservedAt: 10, evidenceCount: 2, changeSincePresence: null,
        uncertaintyText: null,
        evidence: [
          { worldTime: 9, text: "Деревья горят.", importance: "primary" },
          { worldTime: 10, text: "Пожар продолжается.", importance: "notable" },
        ],
      },
    ]));
    const list = container._children[0];
    const card = list._children[0];
    expect(card._children[0]._children[0].textContent).toBe("Лесной пожар");
    const text = cardText(card);
    expect(text).toContain("Действует");
    expect(text).toContain("Наблюдается");
    expect(text).toContain("При последнем наблюдении пожар продолжался.");
    expect(text).toContain("Последнее наблюдение: ход 10");
    expect(text).toContain("Ход 9");
    expect(text).toContain("Деревья горят.");
  });

  it("shows the montage tag for the change since presence", () => {
    const kinds = { appeared: "Новая нить", developed: "Изменилось", resolved: "Завершилось", contradicted: "Требует проверки" };
    for (const [kind, tag] of Object.entries(kinds)) {
      expect(threadsView.threadChangeTag(kind)).toBe(tag);
    }
    expect(threadsView.threadChangeTag(null)).toBeNull();
  });

  it("shows uncertainty text and the honest uncertain label", () => {
    threadsView.renderThreadsPanel(container, journal([
      {
        ref: "ot-x", title: "Лесной пожар", knownLifecycle: "active", knowledgeState: "uncertain",
        summary: "При последнем наблюдении пожар продолжался.",
        firstObservedAt: 1, lastObservedAt: 2, evidenceCount: 1, changeSincePresence: { kind: "developed" },
        uncertaintyText: "После твоего ухода новых признаков не было.",
        evidence: [],
      },
    ]));
    const text = cardText(container._children[0]._children[0]);
    expect(text).toContain("Эта нить требует нового наблюдения.");
    expect(text).toContain("После твоего ухода новых признаков не было.");
    expect(text).toContain("Изменилось");
  });

  it("shows the contradiction label and tag", () => {
    threadsView.renderThreadsPanel(container, journal([
      {
        ref: "ot-y", title: "Последствие: смелый поступок", knownLifecycle: "active", knowledgeState: "contradicted",
        summary: "При последнем наблюдении это продолжалось.",
        firstObservedAt: 1, lastObservedAt: 4, evidenceCount: 1,
        changeSincePresence: { kind: "contradicted" },
        uncertaintyText: "Новые свидетельства ставят прежние сведения под сомнение.",
        evidence: [],
      },
    ]));
    const text = cardText(container._children[0]._children[0]);
    expect(text).toContain("Есть противоречие");
    expect(text).toContain("Требует проверки");
    expect(text).toContain("Новые свидетельства ставят прежние сведения под сомнение.");
  });

  it("renders resolved threads with the completion label", () => {
    threadsView.renderThreadsPanel(container, journal([
      {
        ref: "ot-z", title: "Лесной пожар", knownLifecycle: "resolved", knowledgeState: "observed",
        summary: "Ты видел, как пожар завершился.",
        firstObservedAt: 1, lastObservedAt: 6, evidenceCount: 1,
        changeSincePresence: { kind: "resolved" }, uncertaintyText: null, evidence: [],
      },
    ]));
    const text = cardText(container._children[0]._children[0]);
    expect(text).toContain("Завершилось");
    expect(text).toContain("Ты видел, как пожар завершился.");
  });

  it("never renders internal identifiers or command controls", () => {
    threadsView.renderThreadsPanel(container, journal([
      {
        ref: "ot-secret", title: "Лесной пожар", knownLifecycle: "active", knowledgeState: "observed",
        summary: "s", firstObservedAt: 1, lastObservedAt: 2, evidenceCount: 1,
        changeSincePresence: null, uncertaintyText: null,
        evidence: [{ worldTime: 2, text: "e", importance: "primary" }],
      },
    ]));
    const rendered = JSON.stringify(container._children);
    expect(rendered).not.toContain("ot-secret");
    expect(rendered).not.toContain("threadKey");
    expect(rendered).not.toContain("situation:");
    const card = container._children[0]._children[0];
    expect(card._children.some((c) => c.tagName === "button")).toBe(false);
  });
});
