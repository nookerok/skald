import { describe, it, expect } from "vitest";
import { ModelRouter } from "../../src/llm/router.js";
import type { ChatMessage } from "../../src/llm/types.js";

function msg(content: string): ChatMessage[] {
  return [{ role: "user", content }];
}

describe("ModelRouter", () => {
  it("constructor does not throw without api key", () => {
    const router = new ModelRouter({ apiKey: "" });
    expect(router.apiKey).toBe("");
  });

  it("diagnostics returns entries", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    const diag = router.diagnostics();
    expect(diag.length).toBeGreaterThan(0);
  });

  it("diagnostics warns on empty key", () => {
    const router = new ModelRouter({ apiKey: "" });
    const diag = router.diagnostics();
    expect(diag.some((d) => d.level === "WARN")).toBe(true);
  });

  it("decideModel throws on unknown category", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    expect(() => (router as any).decideModel("unknown" as any, msg("hello"))).toThrow();
  });

  it("decideModel selects first model when health is unknown", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    const decision = router.decideModel("narrate", msg("hello"));
    expect(decision.selectedModel).toBe("deepseek-v4-flash-free");
    expect(decision.category).toBe("narrate");
    expect(decision.healthStatus).toBe("unknown");
  });

  it("decideModel blocks secrets", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    expect(() => router.decideModel("narrate", msg("my key is sk-or-v1-abc123"))).toThrow("Data policy blocked");
  });
});
