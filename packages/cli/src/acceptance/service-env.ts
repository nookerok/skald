/**
 * Load provider settings the way systemd does (full-master Stage 1e).
 *
 * systemd `EnvironmentFile` rules differ from Bash (see env-policy.ts): values
 * with an inline `#`, quoting and whitespace are data, not shell syntax.
 * Sourcing a production env file as a shell script is therefore unsafe and can
 * silently change the measured provider configuration. This helper parses the
 * file with the project's systemd-subset parser and adds the keys as data.
 *
 * Pure and total: never throws, never prints, existing keys win.
 */

import { parseEnvFile } from "../../deploy/env-policy.js";

/** Merges parsed systemd-style env text into `target`; existing keys win. */
export function mergeServiceEnv(target: NodeJS.ProcessEnv, text: string): void {
  let parsed;
  try {
    parsed = parseEnvFile(text);
  } catch {
    return;
  }
  for (const [key, value] of parsed.vars) {
    if (target[key] === undefined) target[key] = value;
  }
}
