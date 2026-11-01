import { describe, expect, it } from "vitest";
import {
  LLM_CONFIG,
  OLLAMA_CLOUD_BACKUP_MODEL,
  OLLAMA_CLOUD_PREFERRED_MODELS,
  OPENROUTER_PREFERRED_MODELS,
  llmConfigFingerprint,
  providersWithKeys,
} from "../../src/llm/config.js";

describe("LLM provider registry", () => {
  it("declares OpenRouter as an OpenAI-compatible provider with its own key env", () => {
    expect(LLM_CONFIG.providers.openrouter).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "SKALD_OPENROUTER_API_KEY",
      usageScope: "remote",
      protocol: "openai_chat",
    });
  });

  it("pins only free OpenRouter models in preference order", () => {
    expect(OPENROUTER_PREFERRED_MODELS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(OPENROUTER_PREFERRED_MODELS)).toBe(true);
    for (const model of OPENROUTER_PREFERRED_MODELS) {
      expect(model.endsWith(":free")).toBe(true);
    }
    expect(OPENROUTER_PREFERRED_MODELS[0]).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });
  it("pins a verified ordered Ollama Cloud preference list with a legacy primary alias", () => {
    expect(OLLAMA_CLOUD_PREFERRED_MODELS).toEqual([
      "gemma4:31b-cloud",
      "nemotron-3-nano:30b",
      "gemma4:31b",
      "nemotron-3-super",
      "nemotron-3-ultra",
      "beam",
    ]);
    expect(Object.isFrozen(OLLAMA_CLOUD_PREFERRED_MODELS)).toBe(true);
    expect(OLLAMA_CLOUD_BACKUP_MODEL).toBe(OLLAMA_CLOUD_PREFERRED_MODELS[0]);
  });

  it("detects the OpenRouter key without exposing its value", () => {
    expect(providersWithKeys({ SKALD_OPENROUTER_API_KEY: "or-secret" })).toContain("openrouter");
    expect(providersWithKeys({})).not.toContain("openrouter");
  });

  it("fingerprints provider endpoints stably and secret-free", () => {
    expect(llmConfigFingerprint()).toBe(llmConfigFingerprint());
    expect(typeof llmConfigFingerprint()).toBe("string");
  });
});
