import { describe, expect, it, vi } from "vitest";
import { discoverOpenCodeRoutes, fetchOpenCodeCatalog } from "../../src/llm/catalog.js";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const preferred = ["big-pickle", "muse-spark-1.3-contributor-free", "mimo-v2.5-free"];

describe("OpenCode Zen live catalogue selection", () => {
  it("fetches model ids through the authenticated catalogue endpoint", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://opencode.ai/zen/v1/models");
      return response({ data: [{ id: "big-pickle" }, { id: "mimo-v2.5-free" }, { id: "big-pickle" }] });
    });
    const report = await fetchOpenCodeCatalog({ apiKey: "zen-key", fetchImpl });
    expect(report).toMatchObject({ provider: "opencode_zen", status: "ok", phase: "response_shape", modelIds: ["big-pickle", "mimo-v2.5-free"] });
    expect(fetchImpl).toHaveBeenCalledWith("https://opencode.ai/zen/v1/models", expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer zen-key", Accept: "application/json" } }));
  });

  it("fails closed on catalogue auth failure without probing models", async () => {
    const fetchImpl = vi.fn(async () => response({ error: { code: "invalid_api_key" } }, 401));
    const probe = vi.fn();
    const report = await discoverOpenCodeRoutes({ apiKey: "bad-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(report.status).toBe("misconfigured");
    expect(report.catalog).toMatchObject({ status: "auth_failure", httpStatus: 401, providerCode: "invalid_api_key" });
    expect(report.activeModel).toBeUndefined();
    expect(report.excluded).toEqual(preferred.map((model) => ({ model, reason: "catalog_auth_failure" })));
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports a missing credential without attempting catalogue or model probes", async () => {
    const fetchImpl = vi.fn();
    const probe = vi.fn();
    const report = await discoverOpenCodeRoutes({ preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(report.status).toBe("misconfigured");
    expect(report.catalog).toMatchObject({ status: "auth_failure", phase: "configuration" });
    expect(report.excluded).toEqual(preferred.map((model) => ({ model, reason: "missing_credential" })));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes every catalog-present preferred model for both routes and activates only complete pairs", async () => {
    const fetchImpl = vi.fn(async () => response({ data: preferred.map((id) => ({ id })) }));
    const probe = vi.fn(async (category: "interpret" | "narrate", model: string) => {
      if (model === "mimo-v2.5-free" && category === "narrate") return { status: "model_unavailable", phase: "response_status", httpStatus: 404 };
      return { status: "ok", phase: "schema_validation" };
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(probe).toHaveBeenCalledTimes(6);
    expect(report.status).toBe("ready");
    expect(report.activeModel).toBe("big-pickle");
    expect(report.backupModel).toBe("muse-spark-1.3-contributor-free");
    expect(report.routes.interpret.map((candidate) => candidate.model)).toEqual(["big-pickle", "muse-spark-1.3-contributor-free"]);
    expect(report.routes.narrate.map((candidate) => candidate.model)).toEqual(["big-pickle", "muse-spark-1.3-contributor-free"]);
    expect(report.excluded).toEqual([{ model: "mimo-v2.5-free", reason: "model_unavailable" }]);
  });

  it("uses the real no-world transport for both probe routes without retrying", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return response({ data: [{ id: "big-pickle" }] });
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return body.messages?.[0]?.content?.includes("marker")
        ? response({ choices: [{ message: { content: "SKALD_PROBE_OK" } }], model: "big-pickle" })
        : response({ choices: [{ message: { content: '{"schemaVersion":1,"probe":true}' } }], model: "big-pickle" });
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: ["big-pickle"], fetchImpl });
    expect(report.status).toBe("degraded");
    expect(report.activeModel).toBe("big-pickle");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.slice(1).map((call) => String(call[0]))).toEqual([
      "https://opencode.ai/zen/v1/chat/completions",
      "https://opencode.ai/zen/v1/chat/completions",
    ]);
    expect(fetchImpl.mock.calls.slice(1).every((call) => (call[1] as RequestInit).method === "POST")).toBe(true);
  });

  it("classifies a transport-backed HTTP 400 model refusal as unavailable", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return response({ data: [{ id: "big-pickle" }] });
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (body.messages?.[0]?.content?.includes("schemaVersion")) {
        return response({ error: { message: "Model unavailable" } }, 400);
      }
      return response({ choices: [{ message: { content: "SKALD_PROBE_OK" } }], model: "big-pickle" });
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: ["big-pickle"], fetchImpl });
    expect(report.status).toBe("unavailable");
    expect(report.candidates[0]).toMatchObject({ active: false, exclusionReason: "model_unavailable", interpret: { status: "model_unavailable", httpStatus: 400 } });
    expect(report.excluded).toEqual([{ model: "big-pickle", reason: "model_unavailable" }]);
  });

  it("excludes preferred ids absent from live catalog without probing them", async () => {
    const fetchImpl = vi.fn(async () => response({ data: [{ id: "big-pickle" }] }));
    const probe = vi.fn(async () => ({ status: "ok", phase: "schema_validation" }));
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(report.status).toBe("degraded");
    expect(report.excluded).toEqual([
      { model: "muse-spark-1.3-contributor-free", reason: "not_in_catalog" },
      { model: "mimo-v2.5-free", reason: "not_in_catalog" },
    ]);
  });

  it("does not retry an unavailable model and records auth/model reasons", async () => {
    const fetchImpl = vi.fn(async () => response({ data: preferred }));
    const probe = vi.fn(async (_category: "interpret" | "narrate", model: string) => {
      if (model === "big-pickle") return { status: "auth_failure", phase: "response_status", httpStatus: 401 };
      if (model === "muse-spark-1.3-contributor-free") return { status: "model_unavailable", phase: "response_status", httpStatus: 400, providerCode: "model_unavailable" };
      return { status: "failed", phase: "response_shape" };
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(probe).toHaveBeenCalledTimes(6);
    expect(report.status).toBe("misconfigured");
    expect(report.excluded).toEqual([
      { model: "big-pickle", reason: "auth_failure" },
      { model: "muse-spark-1.3-contributor-free", reason: "model_unavailable" },
      { model: "mimo-v2.5-free", reason: "interpret_probe_failed" },
    ]);
  });
});
