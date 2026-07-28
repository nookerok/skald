// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APP, CMD, JOURNAL } from "../public/client-state.js";
import { renderStatus, renderJournalStatus } from "../public/status-view.js";

function makeStatusEl() {
  return { textContent: "", _attrs: {}, setAttribute(name, value) { this._attrs[name] = value; } };
}

function makeControlsEl() {
  return { _attrs: {}, setAttribute(name, value) { this._attrs[name] = value; } };
}

function makeContainerEl() {
  const el = {
    _children: [],
    appendChild(c) { this._children.push(c); },
    querySelector(sel) {
      return this._children.find((c) => c.className === (sel.startsWith(".") ? sel.slice(1) : sel)) || null;
    },
    removeChild(c) {
      const i = this._children.indexOf(c);
      if (i >= 0) this._children.splice(i, 1);
    },
  };
  return el;
}

describe("status-view", () => {
  let statusEl, controlsEl, journalContainer, btnMocks;

  beforeEach(() => {
    statusEl = makeStatusEl();
    controlsEl = makeControlsEl();
    journalContainer = makeContainerEl();
    btnMocks = [{ disabled: false }, { disabled: false }];

    vi.stubGlobal("document", {
      getElementById: vi.fn((id) => {
        if (id === "status-text") return statusEl;
        if (id === "controls-section") return controlsEl;
        if (id === "journal-container") return journalContainer;
        return null;
      }),
      querySelectorAll: vi.fn(() => btnMocks),
      createElement: vi.fn((tag) => ({
        className: "",
        textContent: "",
        style: {},
        remove() {},
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("renderStatus", () => {
    it("shows 'Загрузка...' during BOOTING", () => {
      renderStatus({ application: APP.BOOTING, command: CMD.IDLE });
      expect(statusEl.textContent).toBe("Загрузка...");
    });

    it("shows 'Мир отвечает...' during PENDING", () => {
      renderStatus({ application: APP.READY, command: CMD.PENDING });
      expect(statusEl.textContent).toBe("Мир отвечает...");
      expect(statusEl._attrs["aria-live"]).toBe("assertive");
    });

    it("shows 'Готов' when IDLE", () => {
      renderStatus({ application: APP.READY, command: CMD.IDLE });
      expect(statusEl.textContent).toBe("Готов");
    });

    it("shows user message on REJECTED", () => {
      renderStatus({ application: APP.READY, command: CMD.REJECTED, lastPlayerMessage: "Стена." });
      expect(statusEl.textContent).toBe("Стена.");
    });

    it("shows default rejection text when no message", () => {
      renderStatus({ application: APP.READY, command: CMD.REJECTED, lastPlayerMessage: null });
      expect(statusEl.textContent).toBe("Мир не понял этого намерения.");
    });

    it("shows duplicate message on DUPLICATE", () => {
      renderStatus({ application: APP.READY, command: CMD.DUPLICATE });
      expect(statusEl.textContent).toBe("Этот ход уже был принят.");
    });

    it("shows transport failure message on TRANSPORT_FAILED", () => {
      renderStatus({ application: APP.READY, command: CMD.TRANSPORT_FAILED });
      expect(statusEl.textContent).toBe("Связь с миром прервалась. Нажми Retry.");
    });

    it("shows timeout message on TIMEOUT", () => {
      renderStatus({ application: APP.READY, command: CMD.TIMEOUT });
      expect(statusEl.textContent).toBe("Мир не отвечает. Нажми Retry.");
    });

    it("shows disconnected message", () => {
      renderStatus({ application: APP.DISCONNECTED, command: CMD.IDLE });
      expect(statusEl.textContent).toBe("Потеря связи с миром...");
    });

    it("shows reconnecting message", () => {
      renderStatus({ application: APP.RECONNECTING, command: CMD.IDLE });
      expect(statusEl.textContent).toBe("Восстанавливаем связь...");
    });

    it("shows fatal message", () => {
      renderStatus({ application: APP.FATAL, command: CMD.IDLE });
      expect(statusEl.textContent).toBe("Ошибка — перезагрузите страницу.");
    });

    it("sets aria-busy on controls during PENDING", () => {
      renderStatus({ application: APP.READY, command: CMD.PENDING });
      expect(controlsEl._attrs["aria-busy"]).toBe("true");
    });

    it("clears aria-busy on controls when IDLE", () => {
      renderStatus({ application: APP.READY, command: CMD.IDLE });
      expect(controlsEl._attrs["aria-busy"]).toBe("false");
    });

    it("disables buttons when busy (PENDING or BOOTING or RECONNECTING)", () => {
      renderStatus({ application: APP.READY, command: CMD.PENDING });
      expect(btnMocks.every((b) => b.disabled)).toBe(true);

      btnMocks.forEach((b) => (b.disabled = false));
      renderStatus({ application: APP.BOOTING, command: CMD.IDLE });
      expect(btnMocks.every((b) => b.disabled)).toBe(true);

      btnMocks.forEach((b) => (b.disabled = false));
      renderStatus({ application: APP.RECONNECTING, command: CMD.IDLE });
      expect(btnMocks.every((b) => b.disabled)).toBe(true);
    });
  });

  describe("renderJournalStatus", () => {
    it("shows loading message for JOURNAL.LOADING", () => {
      renderJournalStatus({ journal: JOURNAL.LOADING });
      expect(journalContainer._children.length).toBeGreaterThanOrEqual(1);
      const msg = journalContainer._children[journalContainer._children.length - 1];
      expect(msg.textContent).toBe("Загружаем хронику...");
    });

    it("shows empty message for JOURNAL.EMPTY", () => {
      renderJournalStatus({ journal: JOURNAL.EMPTY });
      expect(journalContainer._children.length).toBeGreaterThanOrEqual(1);
      expect(journalContainer._children[journalContainer._children.length - 1].textContent).toBe(
        "Хроника пока пуста. Сделай первый ход."
      );
    });

    it("shows stale message for JOURNAL.STALE", () => {
      renderJournalStatus({ journal: JOURNAL.STALE });
      expect(journalContainer._children[journalContainer._children.length - 1].textContent).toBe(
        "Хроника устарела — обновите страницу."
      );
    });

    it("shows unavailable message for JOURNAL.UNAVAILABLE", () => {
      renderJournalStatus({ journal: JOURNAL.UNAVAILABLE });
      expect(journalContainer._children[journalContainer._children.length - 1].textContent).toBe(
        "Хроника недоступна."
      );
    });

    it("does not add message for AVAILABLE", () => {
      const prev = journalContainer._children.length;
      renderJournalStatus({ journal: JOURNAL.AVAILABLE });
      expect(journalContainer._children.length).toBe(prev);
    });
  });
});
