import type { ProviderId } from "./types.js";

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-or-v1-/,
  /OPENROUTER_API_KEY\s*=\s*\S+/,
  /SKALD_OPENCODE_ZEN_API_KEY\s*=\s*\S+/,
  /SKALD_OLLAMA_CLOUD_API_KEY\s*=\s*\S+/,
  /sk-[a-zA-Z0-9]{20,}/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN [A-Z]+ PRIVATE KEY-----/,
];

export type DataClass = "public_docs" | "project_context" | "player_input" | "secrets";

export function classifyPayload(text: string, explicitClass?: string): { class: DataClass; confidence: "explicit" | "high" | "default" } {
  if (explicitClass) {
    return { class: explicitClass as DataClass, confidence: "explicit" };
  }
  const secrets = scanForSecrets(text);
  if (secrets.length > 0) {
    return { class: "secrets", confidence: "high" };
  }
  return { class: "project_context", confidence: "default" };
}

export function scanForSecrets(text: string): readonly string[] {
  const found: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      found.push(match[0]!.substring(0, 40));
      if (found.length >= 3) break;
    }
  }
  return found;
}

export function enforceDataPolicy(text: string, _dataClass: DataClass, _provider: ProviderId): { ok: boolean; reason: string } {
  const secrets = scanForSecrets(text);
  if (secrets.length > 0) {
    return { ok: false, reason: `secret detected: ${secrets[0]}` };
  }
  return { ok: true, reason: "" };
}
