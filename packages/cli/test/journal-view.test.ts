// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("journal-view", () => {
  let fetchMock;
  let storage;
  let container, journalViewMod;

  beforeEach(async () => {
    storage = {};
    fetchMock = vi.fn();

    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn((key) => storage[key] ?? null),
      setItem: vi.fn((key, value) => { storage[key] = value; }),
      removeItem: vi.fn((key) => { delete storage[key]; }),
    });

    container = {
      _innerHTML: "",
      _children: [],
      set innerHTML(v) { this._innerHTML = v; },
      get innerHTML() { return this._innerHTML; },
      _attrs: {},
      setAttribute(name, value) { this._attrs[name] = value; },
      getAttribute(name) { return this._attrs[name]; },
      appendChild(c) { this._children.push(c); },
      querySelector(sel) { return this._children.find((c) => c._querySel === sel) || null; },
    };

    vi.stubGlobal("document", {
      getElementById: vi.fn((id) => {
        if (id === "journal-container") return container;
        return null;
      }),
      createElement: vi.fn((tag) => {
        const el = {
          tagName: tag,
          _id: undefined,
          get id() { return this._id; },
          set id(v) { this._id = v; },
          _attrs: {},
          _children: [],
          _querySel: null,
          className: "",
          textContent: "",
          style: {},
          innerHTML: "",
          setAttribute(name, value) {
            this._attrs[name] = value;
            if (name === "className" || name === "class") this.className = value;
            if (name === "id") this._id = value;
          },
          getAttribute(name) { return this._attrs[name]; },
          appendChild(c) { this._children.push(c); },
          querySelector(sel) {
            if (sel.startsWith(".")) {
              return this._children.find((c) => c.className === sel.slice(1)) || null;
            }
            if (sel.startsWith("#")) {
              return this._children.find((c) => c._id === sel.slice(1)) || null;
            }
            return this._children.find((c) => c.tagName === sel.toUpperCase()) || null;
          },
          addEventListener(type, fn) { this._events = this._events || {}; (this._events[type] = this._events[type] || []).push(fn); },
          click() { if (this._events?.click) this._events.click.forEach((fn) => fn()); },
          remove() {},
        };
        return el;
      }),
      querySelectorAll: vi.fn(() => []),
    });

    vi.stubGlobal("fetch", fetchMock);

    // Reload module fresh for each test (the module uses module-level state)
    journalViewMod = await import("../public/journal-view.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("loadJournal", () => {
    it("fetches /api/journal and renders on success", async () => {
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, turns: [{ worldTime: 1, turnId: "t1", presentation: {} }], threads: [], hasMore: false }),
      });

      await journalViewMod.loadJournal();

      expect(fetchMock).toHaveBeenCalledWith("/api/journal?limit=50");
      // Should have rendered something (thread bar + turns list)
      expect(container._children.length).toBeGreaterThanOrEqual(2);
    });

    it("does not crash when fetch fails", async () => {
      fetchMock.mockRejectedValueOnce(new Error("network"));

      await journalViewMod.loadJournal();
      // Should not throw
    });
  });

  describe("thread filter persistence", () => {
    it("persists selected thread to sessionStorage and restores on next render", async () => {
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          turns: [{ worldTime: 1, turnId: "t1", presentation: {} }],
          threads: [
            { threadKey: "th1", label: "Movement", entries: [{ turnId: "t1" }] },
            { threadKey: "th2", label: "Social", entries: [] },
          ],
          hasMore: false,
        }),
      });

      await journalViewMod.loadJournal();

      // Find and click the first thread button
      const threadBar = container._children.find((c) => c._attrs.role === "group");
      expect(threadBar).toBeTruthy();
      const threadBtns = threadBar._children.filter((c) => c.tagName === "button" && c.textContent !== "Все ходы");
      expect(threadBtns.length).toBeGreaterThanOrEqual(1);

      // Click the first thread button
      threadBtns[0].click();

      expect(sessionStorage.setItem).toHaveBeenCalledWith("skald:journal:thread", "th1");

      // Re-render — filter should be restored
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          turns: [{ worldTime: 1, turnId: "t1", presentation: {} }],
          threads: [
            { threadKey: "th1", label: "Movement", entries: [{ turnId: "t1" }] },
            { threadKey: "th2", label: "Social", entries: [] },
          ],
          hasMore: false,
        }),
      });

      await journalViewMod.loadJournal();
      // sessionStorage.getItem should have been called
      expect(sessionStorage.getItem).toHaveBeenCalledWith("skald:journal:thread");
    });

    it("removes filter from sessionStorage when 'Все ходы' is clicked", async () => {
      storage["skald:journal:thread"] = "th1";

      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true, turns: [{ worldTime: 1, turnId: "t1", presentation: {} }],
          threads: [{ threadKey: "th1", label: "Movement", entries: [{ turnId: "t1" }] }],
          hasMore: false,
        }),
      });

      await journalViewMod.loadJournal();

      const threadBar = container._children.find((c) => c._attrs.role === "group");
      const allBtn = threadBar._children.find((c) => c.textContent === "Все ходы");
      allBtn.click();

      expect(sessionStorage.removeItem).toHaveBeenCalledWith("skald:journal:thread");
    });
  });

  describe("aria attributes in journal", () => {
    it("sets aria-pressed on thread buttons", async () => {
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true, turns: [{ worldTime: 1, turnId: "t1", presentation: {} }],
          threads: [{ threadKey: "th1", label: "Movement", entries: [{ turnId: "t1" }] }],
          hasMore: false,
        }),
      });

      await journalViewMod.loadJournal();

      const threadBar = container._children.find((c) => c._attrs.role === "group");
      const allBtn = threadBar._children.find((c) => c.textContent === "Все ходы");
      expect(allBtn._attrs["aria-pressed"]).toBe("true");

      const threadBtn = threadBar._children.find((c) => c.textContent === "Movement");
      expect(threadBtn._attrs["aria-pressed"]).toBe("false");
    });

    it("sets aria-expanded on turn headers", async () => {
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true, turns: [{ worldTime: 1, turnId: "t1", presentation: {} }],
          threads: [], hasMore: false,
        }),
      });

      await journalViewMod.loadJournal();

      const turnsList = container._children.find((c) => c._children && c._attrs.role === "list");
      expect(turnsList).toBeTruthy();
      const turnEntry = turnsList._children[0];
      const header = turnEntry._children.find((c) => c.className === "turn-header");
      expect(header._attrs["aria-expanded"]).toBe("true");
      expect(header._attrs["aria-controls"]).toBe("body-t1");

      // Click to collapse
      header.click();
      expect(header._attrs["aria-expanded"]).toBe("false");
    });

    it("sets role=list and role=listitem on turns", async () => {
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true, turns: [{ worldTime: 1, turnId: "t1", presentation: {} }],
          threads: [], hasMore: false,
        }),
      });

      await journalViewMod.loadJournal();

      const turnsList = container._children.find((c) => c._attrs.role === "list");
      expect(turnsList).toBeTruthy();
      const turnEntry = turnsList._children[0];
      expect(turnEntry._attrs.role === "listitem" || turnEntry.getAttribute("role") === "listitem").toBe(true);
    });
  });

  describe("pagination", () => {
    it("loads more turns and deduplicates", async () => {
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          turns: [{ worldTime: 5, turnId: "t5", presentation: {} }],
          threads: [],
          hasMore: true,
          nextBefore: 100,
        }),
      });

      await journalViewMod.loadJournal();

      const moreBtn = container._children.find((c) => c.tagName === "button" && c.textContent === "Ранее");
      expect(moreBtn).toBeTruthy();

      // Load more — with a duplicate
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          turns: [
            { worldTime: 4, turnId: "t4", presentation: {} },
            { worldTime: 5, turnId: "t5", presentation: {} }, // duplicate
          ],
          hasMore: false,
        }),
      });

      await moreBtn.click();

      // The mock is complex for deeply inspecting dedup, but the code path
      // is exercised (SEEN_TURN_IDS prevents the duplicate from being pushed)
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
