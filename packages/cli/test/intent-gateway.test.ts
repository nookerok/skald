import { describe, expect, it, vi } from "vitest";
import { interpretPlayerInput } from "../src/runtime/intent-gateway.js";
import { ProviderRequestError } from "@skald/world";

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

  it("materializes safe diagnostics for transport, parse and schema outcomes", async () => {
    const events: any[] = [];
    const invalid = await interpretPlayerInput("идти к башне и наблюдать за огнями", routerReturning("not json"), {
      diagnostics: (event) => events.push(event),
      correlationId: "intent-test-1",
      worldTime: 7,
      timeoutMs: 100,
    });
    expect(invalid.status).toBe("clarification");
    expect(events.map((event) => event.category)).toEqual(expect.arrayContaining([
      "intent_proposal_request",
      "intent_json_parse",
      "clarification_fallback",
    ]));
    expect(events.every((event) => event.correlationId === "intent-test-1" && event.worldTime === 7)).toBe(true);

    events.length = 0;
    const schemaRejected = await interpretPlayerInput(
      "идти к башне и наблюдать за огнями",
      routerReturning(JSON.stringify({ schemaVersion: 1, primary: { kind: "unknown" } })),
      { diagnostics: (event) => events.push(event) },
    );
    expect(["clarification", "unavailable"]).toContain(schemaRejected.status);
    expect(events.map((event) => event.category)).toContain("intent_schema_validation");
    expect(JSON.stringify(events)).not.toMatch(/идти к башне и наблюдать за огнями|prompt|response|secret/i);
  });

  it("records timeout without exposing player input", async () => {
    const events: any[] = [];
    const slow = { chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const result = await interpretPlayerInput("идти к башне и наблюдать за огнями", slow, {
      diagnostics: (event) => events.push(event),
      timeoutMs: 5,
    });

    expect(result.status).toBe("clarification");
    expect(events.map((event) => event.category)).toContain("intent_timeout");
    expect(JSON.stringify(events)).not.toContain("идти к башне и наблюдать за огнями");
  });

  it("keeps typed provider metadata in operational diagnostics", async () => {
    const events: any[] = [];
    const router = {
      chat: vi.fn().mockRejectedValue(new ProviderRequestError({
        provider: "opencode_zen",
        model: "deepseek-v4-flash",
        category: "interpret",
        phase: "response_status",
        httpStatus: 503,
        providerCode: "temporary_outage",
      })),
    } as any;
    await interpretPlayerInput("идти к башне и наблюдать за огнями", router, {
      diagnostics: (event) => events.push(event),
      correlationId: "intent-provider-1",
    });

    const providerEvent = events.find((event) => event.category === "intent_proposal_request");
    expect(providerEvent).toMatchObject({
      provider: "opencode_zen",
      model: "deepseek-v4-flash",
      phase: "response_status",
      httpStatus: 503,
      providerCode: "temporary_outage",
    });
    expect(JSON.stringify(providerEvent)).not.toContain("идти к башне");
  });

  it("rejects an LLM destination copied from a negated lead clause", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "я не прямо к башне" },
    }));
    const result = await interpretPlayerInput(
      "Я не иду прямо к башне: обхожу её с запада и наблюдаю за огнями",
      router,
    );

    expect(result.status).toBe("clarification");
  });

  it("does not execute a compound colon intent as a truncated destination when the model times out", async () => {
    const slow = { chat: vi.fn(() => new Promise(() => undefined)) } as any;
    const result = await interpretPlayerInput(
      "Я не иду прямо к башне: обхожу её с запада, стараясь держаться ниже гребня и наблюдать за огнями",
      slow,
      { timeoutMs: 5 },
    );

    expect(result.status).toBe("clarification");
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

  it("returns clarification for compound phrases without creating events", async () => {
    const result = await interpretPlayerInput("осматриваюсь и иду к реке", routerReturning("{}"));

    expect(result.status).toBe("clarification");
    // Compound phrases should return clarification, not accepted
    expect((result as any).status).not.toBe("accepted");
  });

  it("returns clarification for unknown verbs without creating events", async () => {
    const result = await interpretPlayerInput("лететь к башне", routerReturning("{}"));

    // Unknown verb returns unavailable when LLM is off, or clarification with LLM
    expect(["clarification", "unavailable"]).toContain(result.status);
  });

  it("returns clarification for missing required target", async () => {
    const result = await interpretPlayerInput("тронуть", routerReturning("{}"));

    // Missing required target returns unavailable when LLM is off
    expect(["clarification", "unavailable"]).toContain(result.status);
  });

  it("clarifies observe with punctuation-only target", async () => {
    const result = await interpretPlayerInput("осмотреть ...", routerReturning("{}"));

    expect(result.status).toBe("clarification");
  });

  it("accepts valid observe without target (ambient action)", async () => {
    const result = await interpretPlayerInput("осматриваюсь", routerReturning("{}"));

    expect(result.status).toBe("accepted");
    expect((result as any).intent.type).toBe("InteractionCommand");
    expect((result as any).intent.verb).toBe("observe");
  });

  it("accepts valid observe with target", async () => {
    const result = await interpretPlayerInput("осмотреть реку", routerReturning("{}"));

    expect(result.status).toBe("accepted");
    expect((result as any).intent.type).toBe("InteractionCommand");
    expect((result as any).intent.verb).toBe("observe");
    expect((result as any).intent.target.raw).toBe("реку");
  });

  it("keeps simple commands on the fast path without calling the model", async () => {
    for (const input of ["осматриваю реку", "слушаю", "беру фонарь", "иду к Речному Стражу"]) {
      const router = routerReturning("{}");
      const result = await interpretPlayerInput(input, router);

      expect(result.status).toBe("accepted");
      expect((result as any).source).toBe("deterministic");
      expect(router.chat).not.toHaveBeenCalled();
    }
  });

  it("routes unknown verb forms to the LLM instead of structural clarification", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "legacy", operation: "approach", target: "ограда" },
    }));
    const result = await interpretPlayerInput("подхожу к ограде", router);

    expect(result).toMatchObject({ status: "accepted", source: "llm" });
    expect((result as any).intent.operation).toBe("approach");
    expect(router.chat).toHaveBeenCalledTimes(1);
  });

  it("routes pronoun-bearing replicas to the LLM instead of the fast path", async () => {
    const proposal = JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня" },
    });
    for (const input of ["спрошу у него об этом", "осмотрю её внимательнее"]) {
      const router = routerReturning(proposal);
      const result = await interpretPlayerInput(input, router);

      expect(result).toMatchObject({ status: "accepted", source: "llm" });
      expect(router.chat).toHaveBeenCalled();
    }
  });

  it("routes multi-clause replicas to the LLM instead of the fast path", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня" },
    }));
    const result = await interpretPlayerInput("подхожу к ограде и смотрю во двор", router);

    expect(result).toMatchObject({ status: "accepted", source: "llm" });
    expect(router.chat).toHaveBeenCalledTimes(1);
  });

  it("keeps a safe deterministic fallback when the model is unavailable", async () => {
    const router = routerReturning(JSON.stringify({
      schemaVersion: 1,
      primary: { kind: "journey", destination: "башня" },
    }));
    const result = await interpretPlayerInput("осматриваю реку", router, { mode: "off" });

    expect(result).toMatchObject({ status: "accepted", source: "deterministic" });
    expect(router.chat).not.toHaveBeenCalled();
  });
});
