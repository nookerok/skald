import { describe, expect, it, vi } from "vitest";
import { interpretPlayerInput } from "../src/runtime/intent-gateway.js";

function routerReturning(text: string) {
  return { chat: vi.fn().mockResolvedValue({ text }) } as any;
}

describe("intent gateway", () => {
  it("uses the deterministic fast path without calling the model", async () => {
    const router = routerReturning("{}");
    const result = await interpretPlayerInput("осмотреться", router);

    expect(result.status).toBe("accepted");
    expect((result as any).source).toBe("deterministic");
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("maps a valid model proposal to an existing command", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня", routeHint: "с запада" },
    }));
    const result = await interpretPlayerInput("обхожу башню западнее", router);

    expect(result).toMatchObject({ status: "accepted", source: "llm" });
    expect((result as any).intent.type).toBe("JourneyIntent");
    expect(router.chat).toHaveBeenCalledTimes(1);
  });

  it("does not execute a compound proposal", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня" },
      additionalClauses: [{ kind: "interaction", summary: "наблюдать за огнями" }],
    }));
    const result = await interpretPlayerInput("идти к башне и наблюдать за огнями", router);

    expect(result.status).toBe("clarification");
  });

  it("turns invalid or timed-out model output into clarification when no safe parse exists", async () => {
    const invalid = await interpretPlayerInput("сделать нечто странное", routerReturning("not json"), { timeoutMs: 100 });
    expect(invalid.status).toBe("clarification");

    const slow = { chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const timedOut = await interpretPlayerInput("сделать нечто странное", slow, { timeoutMs: 5 });
    expect(timedOut.status).toBe("clarification");
  });

  it("keeps a safe natural approach playable when the model times out", async () => {
    const slow = { chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const result = await interpretPlayerInput("обойти башню с запада", slow, { timeoutMs: 5 });
    expect(result).toMatchObject({ status: "accepted", source: "deterministic" });
    expect((result as any).intent.operation).toBe("approach");
    expect((result as any).intent.target.raw).toContain("башню");
  });

  it("can be disabled without changing deterministic commands", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня" },
    }));
    const result = await interpretPlayerInput("идти к башне", router, { mode: "off" });

    expect(result.status).toBe("accepted");
    expect((result as any).source).toBe("deterministic");
    expect(router.chat).not.toHaveBeenCalled();
  });
});
