/**
 * Load provider settings the way systemd does (full-master Stage 1e).
 *
 * systemd `EnvironmentFile` rules differ from Bash (see env-policy.ts): values
 * with an inline `#`, quoting and whitespace are data, not shell syntax.
 * Sourcing a production env file as a shell script is therefore unsafe and can
 * silently change the measured provider configuration.
 *
 * Fail-closed: a malformed file, duplicate keys, or an ambient variable that
 * conflicts with the service file all REJECT the load, so the corpus never
 * measures a configuration other than `skald.service`. Values are never
 * printed; only key names appear in a rejection reason.
 */

import { parseEnvFile } from "../../deploy/env-policy.js";

/** Outcome of applying a service env file. */
export type ServiceEnvResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Applies parsed systemd-style env text to `target`. On success the FILE wins
 * (so the measurement matches the service). Rejects malformed input, duplicate
 * keys and conflicting ambient values. Pure and total: never throws.
 */
export function applyServiceEnv(target: NodeJS.ProcessEnv, text: string): ServiceEnvResult {
  let parsed: ReturnType<typeof parseEnvFile>;
  try {
    parsed = parseEnvFile(text);
  } catch {
    return { ok: false, reason: "env file could not be parsed" };
  }
  if (parsed.malformed) return { ok: false, reason: "env file has a malformed line" };
  if (parsed.duplicates.length > 0) return { ok: false, reason: `env file has duplicate keys: ${parsed.duplicates.join(",")}` };

  const conflicts: string[] = [];
  for (const [key, value] of parsed.vars) {
    const existing = target[key];
    if (existing !== undefined && existing !== value) conflicts.push(key);
  }
  if (conflicts.length > 0) {
    return { ok: false, reason: `ambient environment conflicts with the service file: ${conflicts.join(",")}` };
  }
  for (const [key, value] of parsed.vars) target[key] = value;
  return { ok: true };
}
