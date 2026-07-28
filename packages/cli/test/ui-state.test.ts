// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keepPendingVisible,
  MIN_PENDING_MS,
  setControlsBusy,
} from "../public/ui-state.js";

describe("browser pending state", () => {
  let buttons;
  let controls;

  beforeEach(() => {
    buttons = [{ disabled: false }, { disabled: false }, { disabled: false }];
    controls = {
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };

    vi.stubGlobal("document", {
      querySelectorAll: vi.fn(() => buttons),
      getElementById: vi.fn(() => controls),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("disables every action and exposes aria-busy", () => {
    setControlsBusy(true);

    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(document.querySelectorAll).toHaveBeenCalledWith(
      ".dir-btn, .social-btn, #send-btn, #retry-btn, .guidance-action",
    );
    expect(controls.attributes["aria-busy"]).toBe("true");

    setControlsBusy(false);
    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(controls.attributes["aria-busy"]).toBe("false");
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
