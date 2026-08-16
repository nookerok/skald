import { describe, expect, it, vi } from "vitest";
import { interpretPlayerInput } from "../src/runtime/intent-gateway.js";

function routerReturning(text: string) {
  return { chat: vi.fn().mockResolvedValue({ text }) } as any;
}

describe("inquiry gateway", () => {
  it("answers direct questions deterministically without calling the model", async () => {
    const router = routerReturning("not used");
    const result = await interpretPlayerInput("где я?", router);
    expect(result).toMatchObject({ status: "inquiry", inquiry: { queryId: "current_location", source: "deterministic" } });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("maps an unknown free-form question through InquiryProposalV1", async () => {
    const router = routerReturning(JSON.stringify({ schemaVersion: 1, kind: "inquiry", queryId: "visible_scene" }));
    const result = await interpretPlayerInput("что это за след?", router);
    expect(result).toMatchObject({ status: "inquiry", inquiry: { queryId: "visible_scene", source: "llm" } });
    expect(router.chat).toHaveBeenCalledWith("interpret", expect.anything(), expect.anything());
  });

  it("rejects an unknown query id without executing speech", async () => {
    const router = routerReturning(JSON.stringify({ schemaVersion: 1, kind: "inquiry", queryId: "hidden_truth" }));
    const result = await interpretPlayerInput("что это за след?", router);
    expect(result.status).toBe("clarification");
    expect((result as any).question).not.toContain("назвать одну цель");
  });

  it("keeps inquiry useful when the model is unavailable", async () => {
    const result = await interpretPlayerInput("где я?", null);
    expect(result).toMatchObject({ status: "inquiry", inquiry: { queryId: "current_location" } });
  });
});
