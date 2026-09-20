// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { COMPOSER, composerStateAfterSubmit, composerStatusText, setComposerState } from "../public/composer-state.js";

function createDocument() {
  const elements = new Map();
  const make = (id, extra = {}) => {
    const element = { id, disabled: false, hidden: false, attributes: {}, textContent: "", ...extra };
    element.setAttribute = (name, value) => { element.attributes[name] = String(value); };
    elements.set(id, element);
    return element;
  };
  make("command-form");
  make("controls-section");
  make("command-input");
  make("send-btn");
  make("retry-btn");
  make("voice-btn");
  make("status-text");
  return {
    getElementById(id) { return elements.get(id) || null; },
    elements,
  };
}

describe("composer state machine (plan_9 §8)", () => {
  let doc;
  beforeEach(() => {
    doc = createDocument();
    vi.stubGlobal("document", doc);
  });
  afterEach(() => vi.unstubAllGlobals());

  function locked() {
    return ["command-input", "send-btn", "retry-btn", "voice-btn"]
      .every((id) => doc.elements.get(id).disabled === true);
  }

  function unlocked() {
    return ["command-input", "send-btn", "retry-btn", "voice-btn"]
      .every((id) => doc.elements.get(id).disabled === false);
  }

  it("locks everything atomically in one render cycle while submitting", () => {
    expect(setComposerState(COMPOSER.SUBMITTING)).toBe(COMPOSER.SUBMITTING);
    expect(locked()).toBe(true);
    expect(doc.elements.get("command-form").attributes["aria-busy"]).toBe("true");
    expect(doc.elements.get("controls-section").attributes["aria-busy"]).toBe("true");
    expect(doc.elements.get("retry-btn").hidden).toBe(true);
  });

  it("keeps the composer usable while narration enriches", () => {
    expect(setComposerState(COMPOSER.WAITING_FOR_NARRATION)).toBe(COMPOSER.WAITING_FOR_NARRATION);
    expect(unlocked()).toBe(true);
    expect(doc.elements.get("command-form").attributes["aria-busy"]).toBe("false");
    expect(doc.elements.get("retry-btn").hidden).toBe(true);
  });

  it("shows retry usable on retryable failure", () => {
    expect(setComposerState(COMPOSER.RETRYABLE_FAILURE)).toBe(COMPOSER.RETRYABLE_FAILURE);
    expect(unlocked()).toBe(true);
    expect(doc.elements.get("retry-btn").hidden).toBe(false);
    expect(doc.elements.get("retry-btn").disabled).toBe(false);
  });

  it("boots and lands idle unlocked with retry hidden", () => {
    setComposerState(COMPOSER.SUBMITTING);
    expect(setComposerState(COMPOSER.IDLE)).toBe(COMPOSER.IDLE);
    expect(unlocked()).toBe(true);
    expect(doc.elements.get("retry-btn").hidden).toBe(true);
  });

  it("falls back to idle on unknown states", () => {
    setComposerState(COMPOSER.SUBMITTING);
    expect(setComposerState("flying")).toBe(COMPOSER.IDLE);
    expect(unlocked()).toBe(true);
  });

  it("owns the composer status text while non-idle (plan_9 §8)", () => {
    setComposerState(COMPOSER.SUBMITTING);
    expect(doc.elements.get("status-text").textContent).toBe("МАСТЕР отвечает…");
    expect(doc.elements.get("status-text").attributes["aria-live"]).toBe("assertive");

    // Idle never overwrites an outcome message written by the reducer/shell.
    doc.elements.get("status-text").textContent = "Ход записан";
    setComposerState(COMPOSER.IDLE);
    expect(doc.elements.get("status-text").textContent).toBe("Ход записан");

    expect(composerStatusText(COMPOSER.IDLE)).toBe(null);
    expect(composerStatusText(COMPOSER.RETRYABLE_FAILURE)).toContain("повторить");
  });

  it("classifies submit outcomes through one policy", () => {
    // Clarification and inquiry land idle through the same mechanism.
    expect(composerStateAfterSubmit({ ok: true, status: "clarification" })).toBe(COMPOSER.IDLE);
    expect(composerStateAfterSubmit({ ok: true, status: "inquiry" })).toBe(COMPOSER.IDLE);
    expect(composerStateAfterSubmit({ ok: true, armsNarration: true })).toBe(COMPOSER.WAITING_FOR_NARRATION);
    expect(composerStateAfterSubmit({ ok: true, armsNarration: false })).toBe(COMPOSER.IDLE);
    expect(composerStateAfterSubmit({ ok: false })).toBe(COMPOSER.IDLE);
    expect(composerStateAfterSubmit({ transportFailed: true })).toBe(COMPOSER.RETRYABLE_FAILURE);
    expect(composerStateAfterSubmit(null)).toBe(COMPOSER.IDLE);
  });
});
