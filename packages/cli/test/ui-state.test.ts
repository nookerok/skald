// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keepPendingVisible,
  MIN_PENDING_MS,
  setComposerBusy,
  setControlsBusy,
} from "../public/ui-state.js";

describe("browser pending state", () => {
  let elements;

  beforeEach(() => {
    const make = () => ({ disabled: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
    elements = {
      "command-form": make(),
      "controls-section": make(),
      "command-input": make(),
      "send-btn": make(),
      "retry-btn": make(),
      "voice-btn": make(),
    };

    vi.stubGlobal("document", {
      getElementById: vi.fn((id) => elements[id] || null),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("flips every composer control atomically", () => {
    setComposerBusy(true);

    for (const id of ["command-input", "send-btn", "retry-btn", "voice-btn"]) {
      expect(elements[id].disabled, id).toBe(true);
    }
    expect(elements["command-form"].attributes["aria-busy"]).toBe("true");
    expect(elements["controls-section"].attributes["aria-busy"]).toBe("true");

    setComposerBusy(false);

    for (const id of ["command-input", "send-btn", "retry-btn", "voice-btn"]) {
      expect(elements[id].disabled, id).toBe(false);
    }
    expect(elements["command-form"].attributes["aria-busy"]).toBe("false");
    expect(elements["controls-section"].attributes["aria-busy"]).toBe("false");
  });

  it("keeps the legacy setter on the same atomic path", () => {
    setControlsBusy(true);

    expect(elements["command-input"].disabled).toBe(true);
    expect(elements["send-btn"].disabled).toBe(true);
    expect(elements["command-form"].attributes["aria-busy"]).toBe("true");

    setControlsBusy(false);

    expect(elements["command-input"].disabled).toBe(false);
    expect(elements["send-btn"].disabled).toBe(false);
  });

  it("keeps fast requests visibly pending for the minimum duration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.stubGlobal("performance", { now: () => Date.now() });

    const pending = keepPendingVisible(950);
    let settled = false;
    pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(MIN_PENDING_MS - 51);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });
});
